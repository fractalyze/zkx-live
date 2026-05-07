# zkx-snap

> *Snap a verifiable proof on Solana — in milliseconds.*

**Real-time ZK proofs on Solana, accelerated by zkX.**

Vanilla Groth16 provers (snarkjs) take seconds to tens of seconds for
real-world composed-verification circuits. That's the long pole between
"user clicks" and "on-chain action lands". zkX cuts the prove step to
**~140 ms warm steady state** — fast enough to hide behind ordinary
HTTPS roundtrips.

---

## Two demos, two purposes

These aren't versions of the same thing — they're **different use cases
sharing the same infrastructure** (gateway program, Groth16 verifier,
zkX prover service). The verifier-registry pattern lets us plug each
into the same on-chain stack with no code change, only a new VK.

### 1. `pay_intent` — intent-bound payment

> *ERC-8150-style intent-bound payment primitive on Solana, enforced by ZK.*

Owner signs an intent bundle (recipient allowlist Merkle root, amount
cap, max-per-recipient, expiry, asset, salt, nonce floor). Any agent
holding a fresh ZK proof against this intent can spend, but only within
the bounds. Replay-protected via per-proof nullifier. The intent
commitment shape mirrors [ERC-8150](https://eips.ethereum.org/EIPS/eip-8150)
(intent-bound transactions) — adapted to Solana's account model and
enforced cryptographically rather than by an EVM precompile.

- **Circuit**: `circuits/pay_intent.circom`
- **Constraints**: 8,726 (small)
- **Use case**: AI-agent wallets, automated payment policies, cron-bot
  spending guardrails — anywhere you want cryptographic enforcement of
  "agent X can spend up to Y to recipients in set Z".

### 2. `star_bounty` — attested-claim payment

> *Bounty pays out only when an attested off-chain event happened.*

Same intent layer, plus the proof binds to an attested off-chain claim
(e.g., "GitHub user X starred repo Y"). The attestor signs the claim
with EdDSA-BabyJubjub (SNARK-native, ~3.5k constraints in-circuit). For
the demo, **we** are the attestor (server-side check via the public
GitHub API + sign with our key). For production, swap with Reclaim's
MPC-attested secp256k1 — same circuit family, different attestor key.

- **Circuit**: `circuits/star_bounty.circom`
- **Constraints**: 16,655
- **Use case**: web2-attested bounties, sybil-resistant airdrops,
  reputation-gated grants, conditional payments based on external state.

Both circuits run through the same `gateway` program → CPI into the
same `verifier-groth16-bn254`. Difference: which VK is registered, and
what the attestation/intent layer commits to.

---

## Real-time pipeline (`star_bounty` demo)

```
$ python server/click_to_paid.py octocat octocat/Hello-World

[1/5] GitHub starred check ✓ user_id=583231 (423 ms)
[2/5] Build fixture (EdDSA self-sign) ✓ (1085 ms)
[3/5] Witness gen (C++) ✓ (10 ms)
[4/5] zkX warm prove ✓ wall=247ms (internal: az/bz=35 ms, proof=119 ms)
[5/5] Solana tx submit ✓ sig=5uNQpFm3...

  github_check             423 ms     ← real api.github.com call
  build_input             1085 ms     ← node startup + EdDSA sign
  witness_gen               10 ms     ← C++ witness, 16k-constraint circuit
  zk_prove                 247 ms     ← zkX warm GPU prove
  solana_tx              ~5000 ms     ← per-claim chain ops
                       ─────────
  TOTAL                  ~7  s        ← post-onboarding "click to paid"
```

The ZK proof step itself — the part this whole stack exists to make
fast — is **247 ms wall (137 ms internal)**, indistinguishable from a
regular HTTPS round-trip.

---

## Verification logic (`star_bounty`, atomic in one ZK proof)

1. **Attestor signature** (EdDSA-BabyJubjub, ~3.5 k constraints)
2. **Intent commitment match** (Poseidon-9 over recipients_root, caps,
   window_start, expiry, asset, salt, vk_id)
3. **Recipient ∈ allowlist** (Merkle depth-8)
4. `amount ≤ amount_cap`
5. `amount ≤ max_per_recipient`
6. `window_start ≤ now < expiry`
7. **Per-user-per-claim nullifier** (replay protection)
8. **SPL Transfer instruction encoding** (binds the proof to the exact
   on-chain action that will execute)

Reclaim's native `verifyProof` (their on-chain Solana program) does only
#1. Items 2–8 are what zkx-snap adds — composable real-app verification
logic on attested data, all enforced atomically.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Solana on-chain                                             │
│  ─────────────────────────────────────────────────────────   │
│   gateway program       — register / execute intent          │
│     └─ CPI ──→ verifier-groth16-bn254                        │
│        └─ Light Protocol Groth16 verify (~190 k CU)          │
│   Modular sibling-ix verifiers (SPL, System, …)              │
└──────────────────────────────────────────────────────────────┘
                              ▲
                              │ proof + public inputs
                              │
┌──────────────────────────────────────────────────────────────┐
│  zkX prover service — Python HTTP, GPU-warm                  │
│  ─────────────────────────────────────────────────────────   │
│   POST /prove → witness path → Groth16 proof                 │
│   Steady state: ~125 ms (16k circuit) — ~240 ms (1.6M)       │
│   rabbitsnark + JAX/CUDA + zkx-cuda-pjrt                     │
└──────────────────────────────────────────────────────────────┘
                              ▲
                              │ witness
                              │
┌──────────────────────────────────────────────────────────────┐
│  Demo orchestrator — Python                                  │
│  ─────────────────────────────────────────────────────────   │
│  pay_intent demo: load fixture → witness → /prove → tx       │
│  star_bounty demo:                                           │
│    1. Verify GitHub starred via public API                   │
│    2. Self-attestor signs (EdDSA-BabyJubjub)                 │
│    3. C++ witness gen (8 ms)                                 │
│    4. POST to zkX prover                                     │
│    5. Submit Solana tx                                       │
└──────────────────────────────────────────────────────────────┘
```

Trust boundaries:
- **Solana runtime**: trust as usual.
- **zkX prover**: any prover producing valid Groth16 proofs works.
  zkX contributes speed, not trust.
- **Demo attestor**: self-attested (we own the key) for demo simplicity.
  Production: swap with Reclaim MPC, Opacity TEE, or other distributed
  attestation network. **Circuit verification logic and on-chain code
  unchanged** — only the attestor public key changes.

---

## How to run

Tooling (already set up in this env):
- `solana-test-validator`, `solana`, `cargo-build-sbf` (Solana 1.18+ / Anchor 0.31)
- `circom 2.x`, `node`
- Python venv with `solders`, `solana`, `rabbitsnark`

One-time setup (clone deps, download pot22, install npm, copy keypairs):

```bash
./setup.sh
```

Build on-chain programs:

```bash
cargo-build-sbf --manifest-path programs/verifier-groth16-bn254/Cargo.toml
cargo-build-sbf --manifest-path programs/gateway/Cargo.toml
```

Compile circuits + zkey + C++ witness binary:

```bash
cd circuits
# pay_intent
circom pay_intent.circom --r1cs --wasm -l node_modules -o build/
./node_modules/.bin/snarkjs groth16 setup build/pay_intent.r1cs ptau/pot22_hez.ptau build/pay_intent_0000.zkey
./node_modules/.bin/snarkjs zkey contribute build/pay_intent_0000.zkey build/pay_intent_final.zkey -e='snap'
./node_modules/.bin/snarkjs zkey export verificationkey build/pay_intent_final.zkey build/pay_intent_vk.json
# star_bounty
circom star_bounty.circom --r1cs --c -l node_modules -o build/
./node_modules/.bin/snarkjs groth16 setup build/star_bounty.r1cs ptau/pot22_hez.ptau build/star_bounty_0000.zkey
./node_modules/.bin/snarkjs zkey contribute build/star_bounty_0000.zkey build/star_bounty_final.zkey -e='snap'
./node_modules/.bin/snarkjs zkey export verificationkey build/star_bounty_final.zkey build/star_bounty_vk.json
( cd build/star_bounty_cpp && make )
```

Start the prover service (warm GPU, ~3.5 s startup):

```bash
PROVER_ZKEY=$PWD/circuits/build/star_bounty_final.zkey \
  python server/prover.py
```

Run the demos:

```bash
# Intent-only demo
python demo/demo_pay_intent.py

# Click → bounty paid (attested)
python server/click_to_paid.py <github_username> <owner/repo>
```

---

## Repo layout

```
programs/
  gateway/                          On-chain verify-and-execute gateway
  verifier-groth16-bn254/           BN254 Groth16 verifier (Light Protocol wrap)

circuits/
  pay_intent.circom                 Demo 1: intent-bound payment
  star_bounty.circom                Demo 2: GitHub-star bounty (attested + intent)
  build_pay_intent_input.mjs        Fixture builder for demo 1
  build_star_bounty_input.mjs   Fixture builder for demo 2
  lib/                              Shared circom libs (merkle, ix encoding)
  bench_zkx_warm.py                 Warm-prover benchmark
  bench_vanilla_only.mjs            snarkjs baseline benchmark

server/
  prover.py                         Long-running zkX HTTP prover service
  click_to_paid.py                  End-to-end demo orchestrator (attested)

demo/
  demo_pay_intent.py                Intent-only e2e demo
  lib.py                            Shared SDK helpers (validator, deploy,
                                    VK upload, intent registration, tx submit)

keys/                               Program keypairs (deterministic deploy)
setup.sh                            Clone deps, download ptau, install npm
```

---

## Status

- ✅ Both demos passing on-chain
- ✅ Long-running zkX prover service (warm steady-state ~140 ms)
- ✅ Click → bounty paid e2e demo with real GitHub API check
- 🔜 Web frontend
- 🔜 Production: replace self-attestor with Reclaim MPC or Opacity TEE
