# zkx-snap

> *Snap a verifiable proof on Solana — in milliseconds.*

**Real-time ZK proofs on Solana, accelerated by zkX.**

The fundamental problem: real-world ZK apps need rich, composed
verification (sig verify + intent commitment + allowlist Merkle + amount
caps + replay protection + on-chain action binding — all atomic in one
proof). Vanilla provers (snarkjs WASM) take 20+ seconds for the resulting
1M+-constraint circuits. Users abandon. Devs stop trying.

**zkx-snap proves it doesn't have to be that way.** The same circuit,
proved on zkX's GPU-accelerated Groth16 prover, finishes in **~250 ms
warm steady state** — fast enough to hide behind ordinary UX (click,
wait briefly, paid).

## Demo: click → bounty paid

```
$ python server/click_to_paid.py octocat octocat/Hello-World

[1/5] GitHub starred check ✓ user_id=583231 (423 ms)
[2/5] Build fixture (EdDSA self-sign) ✓ (1085 ms)
[3/5] Witness gen (C++) ✓ (10 ms)
[4/5] zkX warm prove ✓ wall=247ms (internal: az/bz=35 ms, proof=119 ms)
[5/5] Solana tx submit ✓ sig=5uNQpFm3...

============================================================
BOUNTY PAID
============================================================
  github_check             423 ms     ← real api.github.com call
  build_input             1085 ms     ← node startup + EdDSA
  witness_gen               10 ms     ← C++ witness, 16k-constraint circuit
  zk_prove                 247 ms     ← zkX warm GPU prove
  solana_tx              ~5000 ms     ← per-claim chain ops (post-onboarding)
============================================================
Recipient … received 5,000,000 tokens
```

User journey: enter GitHub username → 1-7 s → on-chain bounty paid.
The ZK proof step itself is **250 ms**, indistinguishable from a regular
HTTPS round-trip.

## Architecture

Three-layer stack:

```
┌───────────────────────────────────────────────────────────────┐
│  Solana on-chain                                              │
│  ────────────────────────────────────────────────────────     │
│  gateway program        ── register intent / execute          │
│    └─ CPI ──→ verifier-groth16-bn254                          │
│       └─ Light Protocol Groth16 verify (~190 k CU)            │
│  Modular sibling-ix verifiers (SPL Transfer, System, …)       │
└───────────────────────────────────────────────────────────────┘
                              ▲
                              │ proof + public inputs
                              │
┌───────────────────────────────────────────────────────────────┐
│  zkX prover service (Python HTTP, GPU-warm)                   │
│  ────────────────────────────────────────────────────────     │
│  POST /prove → witness path → Groth16 proof                   │
│  Steady state: ~125 ms (V5 16k constraints) – ~240 ms (V4 1.66M) │
│  rabbitsnark + JAX/CUDA + zkx-cuda-pjrt                       │
└───────────────────────────────────────────────────────────────┘
                              ▲
                              │ witness
                              │
┌───────────────────────────────────────────────────────────────┐
│  Demo orchestrator (Python)                                   │
│  ────────────────────────────────────────────────────────     │
│  1. Verify GitHub starred via public API                      │
│  2. Self-attestor signs (EdDSA-BabyJubjub) — demo only        │
│  3. C++ witness gen (8 ms for V5)                             │
│  4. POST to zkX prover                                        │
│  5. Submit Solana tx                                          │
└───────────────────────────────────────────────────────────────┘
```

Trust boundaries:
- **Demo**: self-attestor (we own the BabyJubjub key) — minimum trust
  separation, fastest UX. Production swap with Reclaim (MPC of n) or
  Opacity (TEE) — circuit accepts secp256k1 too (V4 variant).
- **Solana runtime**: trust as usual.
- **zkX prover**: any prover producing valid Groth16 proofs works; zkX
  contributes speed, not trust.

## Circuits

| Circuit | Sig scheme | Constraints | Witness gen | zkX warm prove | Use case |
|---|---|---:|---:|---:|---|
| `pay_static` (V1) | none | 8.7 k | <1 s | 127 ms | basic intent payment |
| `pay_with_reclaim` (V2) | secp256k1 in-circuit | 1.66 M | 2.5 min (WASM) | 242 ms | trustless Reclaim verify |
| `pay_with_reclaim_efficient` (V3) | efficient ECDSA | 320 k | 10 s | 147 ms | smaller secp256k1 |
| `pay_with_reclaim_real` (V4) | secp256k1 + keccak | 1.66 M | 14.7 s (C++) | 259 ms | Reclaim format compatible |
| **`pay_with_self_attest` (V5)** | **EdDSA-BabyJubjub** | **16,655** | **8 ms** | **137 ms** | **real-time demo** |

V5 is the showcase. V2/V4 prove the architecture supports trustless
external attestors (Reclaim) at the cost of a bigger circuit and longer
witness gen.

## Verification logic in V5 (atomic in one ZK proof)

1. **Attestor sig verify** (EdDSA-BabyJubjub, ~3.5 k constraints)
2. **Intent commitment match** (Poseidon-9 over recipients_root, caps,
   window, expiry, asset, salt, vk_id)
3. **Recipient ∈ allowlist** (Merkle depth-8)
4. **amount ≤ amount_cap**
5. **amount ≤ max_per_recipient**
6. **window_start ≤ now < expiry**
7. **Per-user-per-repo nullifier** (replay prevention)
8. **Solana SPL Transfer instruction encoding** (binds the proof to the
   exact on-chain action)

Reclaim native verifyProof (their on-chain Solana program) does only #1.
**The other 7 invariants are what zkx-snap adds** — composable real-app
verification logic on top of attested data, all enforced atomically.

## Why zkX matters

Most ZK proof systems advertise their warm-steady-state numbers
(snarkjs included). The real distinguishing axis is whether the speed
holds up under realistic constraint counts:

| Circuit | Vanilla snarkjs | zkX warm | Speedup |
|---|---:|---:|---:|
| V1 (8.7 k) | 280 ms | 127 ms | 2.2× |
| V5 (16 k) | ~1.3 s (cold CLI) | 137 ms | ~10× |
| V4 (1.66 M) | 21 s (long-running) | 242 ms | **~85×** |

zkX wins more as circuits grow — exactly the regime real-world composed
verification lives in.

## How to run

Tooling (already set up in this env):
- `solana-test-validator`, `solana`, `cargo-build-sbf` (Solana 1.18+ / Anchor 0.31)
- `circom 2.x`, `node` (for witness JS + EdDSA fixture)
- Python venv `/tmp/zkx-guardrail-venv` with `solders`, `solana`, `rabbitsnark`

Build the on-chain programs:
```bash
cargo-build-sbf --manifest-path programs/verifier-groth16-bn254/Cargo.toml
cargo-build-sbf --manifest-path programs/gateway/Cargo.toml
```

Build C++ witness binary (one-time per circuit, ~50 s):
```bash
cd circuits/build/pay_with_self_attest_cpp && make && cd -
```

Start the prover service (one-time per session, ~3.5 s startup):
```bash
PROVER_ZKEY=$PWD/circuits/build/pay_with_self_attest_final.zkey \
  python server/prover.py
```

Run the click → paid demo:
```bash
python server/click_to_paid.py <github_username> <owner/repo>
```

For the V2/V4 trustless-attestor variants, see `demo/demo_b.py` and
`demo/demo_c.py`.

## Repo layout

```
programs/
  gateway/                       Universal verify-and-execute gateway
  verifier-groth16-bn254/        BN254 Groth16 verifier (Light Protocol wrap)
  guardrail/                     V1.7 monolith — kept for reference

circuits/
  pay_static.circom              V1: 8.7 k constraints
  pay_with_reclaim.circom        V2: 1.66 M, in-circuit secp256k1 ECDSA
  pay_with_reclaim_efficient.circom  V3: 320 k, efficient ECDSA
  pay_with_reclaim_real.circom   V4: 1.66 M, keccak (Reclaim-compatible)
  pay_with_self_attest.circom    V5: 16 k, EdDSA-BabyJubjub (real-time)
  build_v{1..5}_input.mjs        Per-circuit fixture builders

server/
  prover.py                      Long-running zkX HTTP prover service
  click_to_paid.py               End-to-end demo orchestrator

demo/
  demo_a.py                      V1 (pay_static) e2e via gateway
  demo_b.py                      V2 (pay_with_reclaim) e2e
  demo_c.py                      V4 (pay_with_reclaim_real, keccak) e2e
  lib.py                         Shared SDK helpers

spec-v3-gateway.md               Architecture spec
benchmarks/zkx_vs_vanilla*.md    Prove-time benchmarks
```

## Status

- ✅ Five demo circuits built, all passing on-chain through the gateway
- ✅ zkX prover service (~125-250 ms warm steady-state)
- ✅ Click → bounty paid e2e in real time (V5)
- ✅ Reclaim-format compatible (V4 keccak, ready for Reclaim attestor pubkey swap)
- 🔜 Web frontend (current demo is CLI)
- 🔜 Production: replace self-attestor with Reclaim MPC or Opacity TEE

## Trust disclosure

This demo uses a **self-attestor** (we own the BabyJubjub signing key)
for the GitHub-starred check. That means trust currently centralizes on
the demo server. For production:

- Swap the V5 EdDSA attestor for a Reclaim MPC-attested secp256k1 sig
  (use V4 circuit) — trust shifts to Reclaim's attestor network
- Or use TEE-based attestation (Opacity, Polyhedra) — trust shifts to
  hardware vendor

In all cases the **on-chain gateway, verifier program, and circuit
verification logic are unchanged** — only the attestor key (and possibly
the sig scheme) differ. That's the verifier-registry pattern at work.
