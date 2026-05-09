# `circuits/` — circom circuits

Two demo circuits sharing a common library, plus benchmarks.

## Circuits

### `intent/intent.circom` — intent-bound payment
**vk_id = 0**, ~8.7k constraints.

ERC-8150-style intent: owner signs `IntentBundle` (allowlist Merkle
root, amount cap, max-per-recipient, expiry, asset, salt, nonce
floor). A proof shows that a specific transfer satisfies the bundle —
recipient ∈ allowlist, amount within caps, not expired, nonce ≥ floor,
not replayed.

Use case: AI-agent wallets, automated payment policies, cron-bot
spending guardrails — wherever you want cryptographic enforcement of
"agent X may spend up to Y to recipients in set Z".

### `bounty/bounty.circom` — intent + attested claim
**vk_id = 1**, ~14k constraints (with EdDSA-BabyJubjub).

Same intent layer as above, plus binds the proof to a generic
`(subject, object, timestamp)` claim signed by an attestor's
BabyJubjub key. EdDSA-BabyJubjub + Poseidon is SNARK-native (~3.5k
constraints) vs. ~1.5M for in-circuit secp256k1.

Use case: "user U starred repo R at time T" claim → on-chain bounty
payout. Attestor here is the bounty operator; for production swap
to Reclaim MPC or Opacity TEE.

## Library — `lib/`

Shared helpers used by both circuits:
- `merkle.circom` — Poseidon Merkle inclusion proof.
- `instruction_encode.circom` — encodes an SPL Transfer (or System
  Transfer) ix into the public-output schema the gateway program
  expects.
- Other utility templates.

## Benchmarks — `benchmarks/`

- `bench_zkx_warm.py` — warm-prover benchmark (zkX prover service).
- `bench_vanilla_only.js` — snarkjs baseline benchmark.

The numbers in the site's perf charts (`apps/site/PerfCharts.tsx`)
come from running these locally on the same RTX 5090 the prover
service uses.

## Build artifacts

`build/` (gitignored) holds the per-circuit:
- `<c>.r1cs`, `<c>_cpp/<c>` — circom + C++ witness binary
- `<c>_final.zkey` — Groth16 proving key (post-contribute)
- `<c>_vk.json` — verifying key (uploaded to the verifier program)

Run `bash setup.sh` from the repo root to rebuild the full pipeline.
