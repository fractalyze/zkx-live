# Definition of Done — V3 gateway implementation

Goal: implement `spec-v3-gateway.md` so two independent demos run end-to-end
through the same gateway program calling a separate verifier program via CPI.

Open questions (already decided — do NOT re-ask):
- Verifier registry: hybrid (open default; optional allowlist PDA, can be empty)
- Public-inputs schema: gateway-typed (V1.7 modular `verifiers/` reused as action layer)
- Nullifier storage: per-intent `NullifierSetPda`
- Verifier upgrade: include verifier program code-hash in `verifier_config`

Spec source of truth: `/home/a41/Workspace/zkx-snap/spec-v3-gateway.md`

---

## DoD checklist

- [x] `cd /home/a41/Workspace/zkx-snap && cargo-build-sbf --manifest-path programs/gateway/Cargo.toml` exits 0 and produces `target/deploy/gateway.so`
- [x] `cd /home/a41/Workspace/zkx-snap && cargo-build-sbf --manifest-path programs/verifier-groth16-bn254/Cargo.toml` exits 0 and produces `target/deploy/verifier_groth16_bn254.so`
- [x] `verifier-groth16-bn254` exposes a `verify(config: [u8;32], proof: Vec<u8>, public_inputs: Vec<u8>)` instruction that calls Light Protocol Groth16 verify and writes a `VerifyOutcome { schema_id, public_inputs_hash, pub_count }` to return data on success
- [x] `gateway` exposes `register_intent` and `execute_intent` (and `stage_proof`/`execute_staged_intent` 2-tx variant) instructions; both do CPI to `intent.verifier_program::verify`, read `set_return_data`, assert `outcome.public_inputs_hash == hash(caller_pi)`, assert `verifier_program == intent.verifier_program`, then run the modular `verifiers/` sibling-ix policy enforcement
- [x] Gateway has a `NullifierSetPda` keyed to the IntentPda, with replay rejected (a second `execute_intent` with the same proof+pi fails with `NullifierUsed`)
- [x] `cd /home/a41/Workspace/zkx-snap && /tmp/zkx-guardrail-venv/bin/python demo/demo_a.py` exits 0; logs show: rabbit-py generates proof for `pay_static.circom` → register intent → execute via gateway → CPI to verifier-groth16 → SPL transfer recipient receives the expected amount
- [x] `cd /home/a41/Workspace/zkx-snap && /tmp/zkx-guardrail-venv/bin/python demo/demo_b.py` exits 0; logs show: rabbit-py generates proof for `pay_with_reclaim.circom` (Reclaim attestation in-circuit) → register intent → execute via gateway → CPI to verifier-groth16 → SPL transfer claimer receives the bounty amount (uses `stage_chunk` × 2 + `execute_chunked_intent` because V2's 1408 B blob exceeds single-tx limit)
- [x] Both demos use the **same deployed gateway program** and the **same deployed verifier-groth16 program** — only the intent data + VK differ (verified by inspection of demo_a.py / demo_b.py: both deploy the same target/deploy/*.so and import lib.GATEWAY_PROGRAM_ID / lib.VERIFIER_PROGRAM_ID — only schema_id and salt differ)
- [x] `README.md` (root) is updated to describe V3 architecture and how to run both demos
- [x] No skipped, ignored, or `todo!()` instructions in either program — all schema branches in `verify_and_enforce` are reached by at least one of the two demos (Demo A exercises SCHEMA_PAYMENT=0; Demo B exercises SCHEMA_RECLAIM_PAYMENT=1; grep confirms zero `todo!`/`unimplemented!`/`unreachable!()` in handler bodies)

## Workflow each iteration

1. Do the work toward unchecked items.
2. Before claiming completion, spawn the **ralph-verifier** subagent in foreground
   (Agent tool, subagent_type="ralph-verifier"). Pass the DoD file path:
   `/home/a41/Workspace/zkx-snap/.claude/ralph-dod-v3.md`.
3. Parse the verifier JSON. For PASS items, edit this DoD file to flip
   `- [ ]` → `- [x]` for that exact line. For FAIL items, fix the underlying
   issue and continue iterating.
4. ONLY when every item is `- [x]` AND verified by ralph-verifier, output:
   `<promise>DOD_VERIFIED</promise>`

Do not output the promise until verification has actually passed. Lying to
escape the loop wastes the next iteration.

## Iter 1 → 2 handoff notes (read before resuming)

- Demo A is fully working — do NOT regress it.
- Demo B is the blocker. Root cause: V2 circuit has 1152 B of public_inputs;
  combined with the 256 B proof and Anchor stage_proof discriminator+tag+lengths
  the single-tx `stage_proof` payload is ~1456 B, well over the 1232 B
  Solana tx-data limit.
- We tried a chunked `init_stage_buffer + write_stage_chunk` pattern earlier
  and observed an Anchor 0.31 issue: in-place mutations on Account<T>'s
  Vec<u8> field do NOT persist across tx boundaries (init's full Vec
  assignment DOES persist; subsequent chunk writes do not). This was confirmed
  via on-chain account read-back showing all-zero blob despite confirmed write
  txs.
- Two viable paths for iter 2:
  1. **Versioned tx + Address Lookup Tables**: keep the current
     `stage_proof` ix but use a v0 tx with a LUT to compress the account list.
     Saves ~200 B; the 1456 B payload would fit.
  2. **AccountInfo-based chunked staging**: rewrite stage to use raw
     `AccountInfo::try_borrow_mut_data()` instead of `Account<ProofBuffer>`,
     avoiding Anchor's automatic serialization entirely. Then chunked writes
     to raw bytes will persist (we proved this works for the header bytes
     during init).
- DoD item "no skipped instructions / all schema branches reached" auto-flips
  to PASS when Demo B works (it's the only path that exercises schema_id=1).

## Implementation hints (read once, then trust the spec)

- Existing V1.7 monolith lives in `programs/guardrail/src/{lib.rs, proof.rs, policy.rs, verifiers/}`. The `proof.rs` body and `VkPda`/`initialize_vk`/`write_vk_chunk` move into the new `verifier-groth16-bn254` program. `policy.rs` and `verifiers/` move (or stay accessible) inside the new `gateway` program.
- Use Anchor's `invoke_signed` for CPI to the verifier; read return data with `solana_program::program::get_return_data`.
- `pay_static.circom` and `pay_with_reclaim.circom` already exist with their VKs and proving keys under `circuits/build/`. SDK fixtures `circuits/build_v2_input.mjs` and the V1 input generator already work — reuse them, do not regenerate keys.
- `sdk/src/horizontal_test.mts`, `onchain_test.mts`, `replay_test.mts` are V1.7 e2e references in TS — port their patterns into Python `demo/demo_a.py` and `demo/demo_b.py` using `solders` + `solana` Python clients. The TS SDK can stay as historical reference but is NOT required by the DoD.
- Proof generation: use `rabbitsnark` Python module (`from rabbitsnark.groth16 import compile_circom; from rabbitsnark.r1cs_solver import compute_abc`). The CLI invocation `/tmp/zkx-guardrail-venv/bin/rabbitsnark circom prove ...` is the simplest fallback if the Python API is too low-level.
- `solana-test-validator` is on PATH at `/home/a41/.local/share/solana/install/active_release/bin/`. Demos spin up a fresh validator each run with `--reset` for determinism. Use `subprocess.Popen`.
- Light Protocol convention: SDK pre-negates `proof_a` before sending — keep that in the SDK fixture builder, not the verifier program.
- For replay, the nullifier in V1 is `public_inputs[2]`. In V3 it's
  `Hash(intent.nullifier_seed, schema_id, public_inputs_hash)` — gateway
  computes and stores in `NullifierSetPda`.

## Out of scope (do NOT attempt)

- SP1, Risc0, secp256k1, ed25519 verifier programs — interface ready, code deferred to V4.
- Multi-cluster / cross-cluster intents.
- Proof aggregation or recursion.
- Anchor IDL polish or TypeScript codegen — manually-typed bindings are fine.
- UI / frontend — CLI demos only.
