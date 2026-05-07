# V3 Spec — Universal proof-verified intent gateway for Solana

_Status: V3 — pivot from single-purpose ZK guardrail to verifier-agnostic gateway_
_Intent shape: ERC-8150-style (signed bundle + monotonic nonce + cluster id)_
_Verifier model: any Solana program implementing the gateway's verify CPI_

---

## Goal

Build a Solana program that:

1. **Stores user-signed intents** in the ERC-8150 bundle shape.
2. **Delegates proof verification** to ANY Solana program registered in
   the intent — Groth16, SP1, Risc0, secp256k1, ed25519, TEE, …
3. **Enforces atomic execution** of an intent-bound action set
   (existing V1.7 modular verifiers/ stays).
4. **Prevents replay** with per-intent nullifier set + monotonic nonce.

The gateway is **verifier-agnostic**. Reclaim-in-Groth16 (V2 work) and
Reclaim-via-secp256k1 (native precompile) become two competing
*verifier program* deployments — same intent shape, different
trust/cost profile.

## Why this architecture

Solana programs are accounts. CPI dispatch by pubkey is the native
shape. ERC-8150 already separates **intent commitment** from **proof
verification**, so the same bundle structure ports cleanly.

| Layer | EVM (ERC-8150) | Solana (V3) |
|---|---|---|
| Intent | EIP-712 signed bundle | Anchor PDA derived from `(owner, salt)` |
| Verifier | `IIntentVerifier` contract | Anchor program with `verify` CPI handler |
| Executor | relayer / 4337 bundler | any signer, pays tx fee |
| Replay | nonce + (sometimes) nullifier | nullifier-set PDA + monotonic nonce |
| Cluster | chainId | `cluster_id` field in commitment |

## Non-goals (V3)

- General-purpose dynamic dispatch (Solana account-list constraint)
- arbitrary tx execution after verify (we keep modular sibling-policy)
- in-program proof aggregation / recursion
- Cross-cluster intent (cluster_id binds intent to one network)

---

## Account model

```
IntentPda                         # one per (owner, salt)
├── owner               Pubkey
├── verifier_program    Pubkey    # which deployed program verifies proofs for this intent
├── verifier_config     [u8; 32]  # opaque to gateway — meaning is verifier-defined
│                                 # e.g., Groth16: hash(VK); SP1: program_id; secp256k1: signer pubkey hash
├── intent_root         [u8; 32]  # Poseidon-8 hash of ERC-8150 bundle
├── nullifier_seed      [u8; 32]  # binds nullifiers to this intent
├── min_valid_nonce     u64       # ERC-8150 monotonic floor
├── cluster_id          u8        # 0=localnet, 1=devnet, 2=mainnet
├── expiry              i64       # unix seconds
└── action_policy       enum      # which sibling-ix verifier set is allowed
                                  # PaymentPolicy { recipient_root, amount_cap, max_per }
                                  # SwapPolicy { ... }
                                  # GovernancePolicy { ... }

NullifierSetPda                   # one per IntentPda
└── used: BTreeSet<[u8; 32]>      # or sharded — per-proof unique nullifier

VerifierRegistryPda               # global, optional governance — can be empty
└── allowed: BTreeSet<Pubkey>     # if non-empty, gateway only dispatches to listed verifiers
                                  # if empty, gateway accepts any verifier the user signs over
```

The intent commitment binds the verifier to the bundle:

```
intent_root = Poseidon(
    verifier_program,              # binds proof system choice
    verifier_config,               # binds VK / signer / circuit version
    action_policy_root,            # binds sibling-ix shape
    nullifier_seed,
    min_valid_nonce,
    cluster_id,
    expiry,
    salt,
)
```

→ Substituting a different verifier requires re-signing the intent.

---

## Verifier program interface (the contract anyone implements)

A verifier is any Anchor program that exposes one instruction:

```rust
#[program]
pub mod my_verifier {
    pub fn verify(
        ctx: Context<Verify>,
        config:        [u8; 32],   // intent.verifier_config — verifier-specific
        proof:         Vec<u8>,    // raw proof blob (verifier-defined encoding)
        public_inputs: Vec<u8>,    // canonical bytes the gateway can hash
    ) -> Result<()> {
        // 1. parse proof + verify against config
        // 2. on success: set_return_data(VerifyOutcome { ... })
        // 3. on failure: return Err
    }
}

#[account]  // Returned via set_return_data, NOT a stored account
#[derive(BorshSerialize, BorshDeserialize)]
pub struct VerifyOutcome {
    pub schema_id:           u8,        // identifies how to interpret public_inputs
    pub public_inputs_hash:  [u8; 32],  // gateway hashes its own copy + compares
    pub pub_count:           u16,       // info-only
}
```

Required behavior:
- **Deterministic**: same (config, proof, public_inputs) → same accept/reject
- **No side effects**: don't write accounts (gateway controls state)
- **Returns via `set_return_data`** so gateway reads it after CPI
- **Bounded CU**: gateway logs and budgets per verifier, but doesn't enforce

Reference verifier we ship in V3:

| Program | Proof system | CU cost | Use case |
|---|---|---|---|
| `verifier-groth16-bn254` | Groth16 / BN254 (Light Protocol wrap) | ~190 k | every demo circuit (Intent + GitHub-star) |

The single verifier serves multiple **VK registrations** — each intent
binds to a `(verifier_program, vk_hash)` pair. Two demos, two VKs, one
verifier program.

Validated-but-deferred verifiers (interface ready, no shipping code):
- `verifier-secp256k1`  — raw ECDSA via Solana native precompile (~5 k CU)
- `verifier-ed25519`    — Solana-native signed claims (~3 k CU)
- `verifier-sp1`        — wrap upstream SP1 verifier program
- `verifier-risc0`      — same shape

---

## Execute flow (the gateway does this on every `execute_intent`)

```
1. Load IntentPda — assert: not expired, cluster matches, nonce >= min_valid_nonce.
2. Hash caller-provided public_inputs → pi_hash.
3. CPI to intent.verifier_program with (intent.verifier_config, proof, public_inputs).
   - On Err: bubble up as VerifyFailed.
   - On Ok: read return_data → VerifyOutcome.
4. Assert outcome.public_inputs_hash == pi_hash   # gateway-controlled binding.
5. Compute nullifier = Hash(intent.nullifier_seed, schema_id, pi_hash) and
   assert it's not in NullifierSetPda. Insert it.
6. Decode public_inputs by intent.action_policy.schema and run V1.7 modular
   sibling-ix policy:
   - PaymentPolicy: walk siblings, sum amounts to expected_recipient,
     compare to (cap, max_per) bounds.
   - SwapPolicy / etc: future.
7. Emit `ExecuteOk { intent_root, verifier_program, nullifier }`.
```

Atomicity: every assertion failure aborts the tx. The sibling actions
(transfer, swap, ...) only commit if all checks pass — same atomic
guarantee as V1.7.

---

## Migration from V1.7 (what changes vs what stays)

**Stays identical:**
- `verifiers/` modular dispatch (spl_token, system, ...) — re-used as the
  action-policy enforcement layer (step 6 above).
- `policy::enforce_sibling_policy` — re-used; just takes
  `expected_recipient` and `expected_amount` extracted by the schema decoder.
- The `stage_proof` + `assert_staged_proof` 2-tx pattern for size-bounded
  proofs.
- Anchor `close = rent_recipient` for replay PDA cleanup.

**Changes:**
- `proof.rs::verify_pay_static` → moved out of gateway entirely. Becomes
  the body of a separate `verifier-groth16-bn254` program.
- `VkPda` storage moves to the verifier program (each verifier owns its
  own VK / config storage, gateway doesn't care).
- `IntentPda` is **new** — V1.7 didn't have a separate intent
  registration step; it inferred intent from public_inputs slots.
  V3 makes intent registration explicit so the user signature anchors
  the verifier choice on-chain.
- `lib.rs::initialize_vk` / `write_vk_chunk` → moved to the verifier
  program. Gateway gets `register_intent` / `execute_intent` instead.

**Net effect:** ~60% of current code moves into a per-verifier program
(unchanged bytes, new home), gateway becomes thinner.

---

## ERC-8150 mapping

ERC-8150 fields → IntentPda fields:

| ERC-8150 | V3 IntentPda |
|---|---|
| `chainId` | `cluster_id` |
| `nonce` | `min_valid_nonce` (monotonic floor; per-execute nonce in nullifier) |
| `validUntil` | `expiry` |
| `verifier` (contract addr) | `verifier_program` (Pubkey) |
| `verifierData` | `verifier_config` |
| `executionPayload` | `action_policy` (typed enum) |
| user signature | enforced at `register_intent` via owner Signer |

Same mental model — Solana account model just makes each piece a
separate primitive (PDA / program / signer).

---

## Build sequence

```
G1. Refactor    : split current code → gateway crate + verifier-groth16 crate     (~3-4h)
G2. Verifier IF : define VerifyOutcome + CPI contract                             (~2-3h)
G3. Intent PDA  : register_intent + execute_intent + NullifierSetPda              (~3-4h)
G4. Demo A      : Intent payment (V1 pay_static circuit) e2e via gateway          (~2-3h)
G5. Demo B      : GitHub-star bounty (V2 pay_with_reclaim circuit) e2e via gateway (~3-4h)
G6. Doc + pitch : architecture diagram, README, pitch deck update                 (~1-2h)
```

Total: 14-20 hours focused. ~2-3 calendar days.

The two demos exercise the **same gateway** with the **same verifier
program** but **different VKs** — proving the registration pattern
works for unrelated circuits without code change.

## Demo specifications

### Demo A — Intent-based payment (V1 reuse)

- Circuit: `pay_static.circom` (V1, 8.7 k constraints, ~127 ms zkX prove)
- VK registered under `verifier-groth16-bn254` with `vk_hash_A`
- Intent: ERC-8150 bundle binding (allowlist Merkle root, amount cap, expiry)
- Execute: agent generates fresh proof per payment → CPI verify → SPL Transfer
- Story: "AI agent wallet with cryptographic spend policies"

### Demo B — GitHub-star bounty (V2 reuse)

- Circuit: `pay_with_reclaim.circom` (V2, 1.66 M constraints, ~8.6 s zkX prove)
- VK registered under `verifier-groth16-bn254` with `vk_hash_B`
- Intent: bounty bundle (Reclaim attestor pubkey, repo hash, per-claim amount, total budget)
- Execute: claimer presents Reclaim attestation → in-circuit ECDSA verify → SPL Transfer
- Story: "Trustless web2-attested airdrop with privacy"

Same gateway. Same verifier program. Different intent + different VK.
This is the proof of the "anyone plugs in their own verify logic"
claim — the gateway never recompiled between the two demos.

---

## Open questions (decide before G1)

1. **Verifier registry: open or curated?**
   - *Open*: any program is a valid verifier; user takes responsibility via signature.
   - *Curated*: gateway maintains an allowlist PDA; safer for retail users; needs governance.
   - Recommend: **open by default, optional curated mode** (registry PDA exists but empty = open).

2. **Public-inputs schema: gateway-typed or verifier-typed?**
   - *Gateway-typed*: gateway has fixed `action_policy` enum; verifier outputs match one of these.
   - *Verifier-typed*: each verifier defines its own schema; gateway just routes to the right action verifier.
   - Recommend: **gateway-typed** — keeps the action-policy shape stable so the modular V1.7 verifiers/ keep working unchanged.

3. **Nullifier storage: per-intent or global?**
   - *Per-intent*: one NullifierSetPda per IntentPda — bounded growth, easy cleanup.
   - *Global*: one giant set — simpler but unbounded.
   - Recommend: **per-intent**, sharded if needed.

4. **Verifier upgrade path?**
   - intent commits to `verifier_program` pubkey. If verifier program is
     upgraded under same pubkey, intent semantics could shift silently.
   - Mitigation: include verifier program's hash in `verifier_config`.
   - Or: require Solana frozen / non-upgradable verifier programs.
