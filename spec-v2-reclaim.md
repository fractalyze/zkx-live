# V2 Spec — In-circuit Reclaim ECDSA verification (`pay_with_reclaim`)

_Status: V2 — full in-circuit Reclaim attestor signature verification_
_Approach: Option C — secp256k1 ECDSA verified inside Groth16 circuit_
_Demo subject: GitHub-star bounty claim_

---

## Goal

User stars `yourzk/guardrail` on GitHub → Reclaim Protocol attests via signed
claim → user submits ZK proof → on-chain guardrail releases bounty USDC.

Trust assumption: ONLY Reclaim's attestor public key (hardcoded in the verifier
context). Forging a claim requires either (a) breaking secp256k1 ECDSA or
(b) compromising the attestor's private key.

## Success criteria

1. Circuit `pay_with_reclaim.circom` compiles with circom 2.x
2. Constraint count documented (target: ≤ 2M; realistic: 1.5M with circom-ecdsa)
3. zkX prove time measured (target: ≤ 10 s with zkX, vs vanilla ≥ 30 s)
4. snarkjs verify on rabbitsnark-generated proof: PASS
5. On-chain Light Protocol verifier accepts our proof + public_inputs
6. End-to-end demo: real Reclaim attestation → real claim USDC tx
7. Replay protection: per-GitHub-user nullifier in circuit (not per-wallet)
8. Spec doc + benchmark doc updated

## Stack

| Component | Choice |
|---|---|
| ECDSA-in-circuit | `0xparc/circom-ecdsa` (or efficient variant) |
| sha256-in-circuit | `circomlib/sha256` |
| Composition | New `pay_with_reclaim.circom` reuses pay_static helpers |
| Powers of Tau | `pot22_final.ptau` (~4 GB) — enough for ~2M constraints |
| Prover | zkX (Groth16 BN254) |
| On-chain verify | Light Protocol `groth16-solana` (no program change — new VK only) |
| Reclaim source | `@reclaimprotocol/js-sdk` (Node) — get attestation, extract sig+claim |

## Circuit composition

```
pay_with_reclaim.circom
├── lib (reused from V1):
│   ├── poseidon
│   ├── merkle (depth 8)
│   └── instruction_encode
├── lib (new):
│   ├── circom-ecdsa (secp256k1 ECDSA verify)
│   ├── circomlib sha256
│   └── reclaim_claim_parse (custom — extract user_id + repo)
│
└── PayWithReclaim() template:
    inputs:
      public:
        attestor_pubkey [4 limbs]    # Reclaim attestor secp256k1 pubkey
        claim_hash [4 limbs]          # sha256(claim_data) reduced to BN254 field
        recipient [2 limbs]            # claimer wallet pubkey
        amount                         # bounty amount
        now                            # timestamp
        nullifier                      # Hash(github_user_id, repo)
      private:
        sig_r, sig_s [secp256k1]
        claim_data_bytes [variable]
        github_user_id
        repo_name
        intent fields (recipients_root, cap, expiry, ...)
    constraints:
      1. SHA-256 (claim_data_bytes) == claim_hash
      2. ECDSA secp256k1 verify(attestor_pubkey, claim_hash, sig) == 1
      3. Parse claim_data_bytes → extract github_user_id + repo_name
      4. Nullifier == Poseidon(github_user_id, repo_name)
      5. Intent integrity (Poseidon hash, same as pay_static)
      6. Recipient ∈ allowlist (Merkle membership)
      7. Amount ≤ intent.amount_cap
      8. now < intent.expiry
      9. Instruction encoding (SPL Transfer to recipient)
```

## Public-input layout (fixed schema, same as V1 + extensions)

| Slot | Field | Notes |
|---|---|---|
| [0] | vk_id (= 1 for pay_with_reclaim) | dispatch hint |
| [1] | intent_root | Poseidon hash of intent bundle |
| [2] | nullifier | Hash(github_user_id, repo) — V2 trustless dedup |
| [3..7] | attestor_pubkey | secp256k1 pubkey (~4 BN254 limbs) |
| [7..11] | claim_hash | sha256 of Reclaim claim data |
| [11..14] | reserved (instruction encoding for sibling) | unchanged |
| [14] | repo_name_hash | binding to expected repo |
| [15] | intent_root echo | |
| [16..18] | recipient pubkey | |
| [18] | amount | |
| [19] | now | |

## On-chain integration — minimal change

V1 program is **verifier-agnostic** — VK lookup by `circuit_id`. So V2:
1. Generate `pay_with_reclaim_vk.json`
2. SDK calls `initialize_vk(circuit_id=1, vk_size=...)` + chunks
3. SDK calls `stage_proof(circuit_id=1, proof, public_inputs)` and `assert_staged_proof()`
4. **Zero on-chain code changes** ✓ (this is the payoff of modular V1.7)

The only update: `assert_staged_proof` already binds to vk_pda.circuit_id, so dispatch is automatic.

## SDK changes

```typescript
// V2 IntentBuilder
export const IntentBuilder = {
  // ... V1 builders ...
  bountyForGitHubStar: (args: {
    repo: string,
    bountyAmount: bigint,
    expiry: number,
    attestorPubkey: PublicKey,    // Reclaim attestor (hardcoded mainnet)
  }) => IntentBundle,
};

// V2 prover wrapper
export class ReclaimProver {
  async generateProof(reclaimAttestation: ReclaimAttestation, claimerWallet: PublicKey)
    : Promise<{proof, publicInputs}> {
    // 1. Verify attestor sig off-chain (sanity)
    // 2. Extract github_user_id + repo from claim
    // 3. Compute claim_hash, nullifier, intent commitment
    // 4. Build witness
    // 5. Call zkX prover with pay_with_reclaim.zkey
    // 6. Return Groth16 proof + public_inputs
  }
}

// Demo flow
const reclaim = new Reclaim('GITHUB_STARRED_REPOS_TEMPLATE');
const attestation = await reclaim.requestProof({ githubAuth, repo: 'yourzk/guardrail' });
const { proof, publicInputs } = await ReclaimProver.generateProof(attestation, wallet.pubkey);
// Then standard stage_proof + assert_staged_proof + spl_transfer flow
```

## Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| circom-ecdsa lib has bug → invalid proof | High | Use audited 0xparc version, verify on-chain via known-good vector |
| Constraint count exceeds 2M → ptau22 not enough | Medium | Pre-flight measure with `circom --r1cs`; fall back to optimized ECDSA |
| zkX struggles with 1.5M-constraint circuit | Medium | Test early; if too slow, use optimized lookup-based ECDSA |
| Reclaim attestation format changes | Low | Pin attestation version in circuit; update on Reclaim spec change |
| Reclaim attestor key rotation | Low | New circuit version with new attestor pubkey hardcoded |
| Tx size still over 1232 bytes (V2 has more public inputs) | Medium | stage_proof PDA pattern handles this — already V1.7 path |

## Build sequence (numbered, sequential)

```
S1. Setup    : circom-ecdsa submodule, ptau22 download, env check     (~2-3h)
S2. Circuit  : pay_with_reclaim.circom skeleton + compile             (~4-6h)
S3. Fixtures : Reclaim test attestation (real or mock)                (~2-3h)
S4. Prove    : snarkjs prove + verify (vanilla baseline)              (~2-4h)
S5. zkX      : rabbitsnark integration + measure                      (~2-3h)
S6. SDK      : ReclaimProver class + intent builder                   (~3-4h)
S7. Onchain  : Register VK (circuit_id=1) + e2e tx test               (~2-3h)
S8. Demo     : claim CLI + 2 fake claimer wallets demo                (~2-3h)
S9. Pitch    : update benchmark doc + spec doc                         (~1-2h)
```

Total: 20-30 hours focused work. Realistic with breaks: 4-7 calendar days.

## V1 vs V2 comparison (for pitch)

| Metric | V1 (pay_static) | V2 (pay_with_reclaim) |
|---|---|---|
| Constraint count | 8,726 | ~1.5M (circom-ecdsa) |
| Public inputs | 20 | ~30 (more attestor binding) |
| zkX prove time | 127 ms | ~10-15 s (estimated) |
| On-chain verify CU | 191k | 191k (Light Protocol — same!) |
| Trust assumption | None on-chain (off-chain trusts SDK) | **Only Reclaim attestor pubkey** |
| Reclaim integration | Off-chain SDK | **In-circuit ECDSA verify** |
| Demo flexibility | Pre-canned recipient | **Dynamic from real GitHub action** |

V2 sells the **trustlessness** narrative: "ZK proof guarantees the claimer truly starred the repo, no SDK trust."

## Beyond V2 (V3+)

- **Multi-attestor**: support multiple Reclaim attestor keys (registry)
- **Multi-provider**: zkPass, Pluto, Primus same circuit pattern (different attestor key)
- **Aggregated claims**: prove starred N repos in one proof
- **Generic web2 attestation**: any HTTPS API → on-chain claim
