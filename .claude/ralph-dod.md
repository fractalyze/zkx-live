# Definition of Done — Ralph: fix rabbitsnark circom prover

Task: Debug rabbitsnark circom Groth16 prover (in `/tmp/rs-fresh/rabbitsnark/`,
editable install) until it generates a valid Groth16 proof for our pay_static
circuit. Currently produces invalid proofs whenever `domain_size >= 32` and
`num_public_inputs >= 9`. Boundary confirmed: N=7 (dom=16, num_public=8) ✓ vs
N=8 (dom=32, num_public=9) ✗. Multiplier_3 (dom=4, num_public=1) ✓.

The fix must live inside `/tmp/rs-fresh/rabbitsnark/` source (any of:
`groth16/prover.py`, `circom/zkey/*.py`, `circom/zkey_to_terms.py`,
`circom/wtns/*.py`, `r1cs_solver/solver.py`, OR a small helper module).
Do NOT touch the gnark path. Do NOT modify our circuit (`pay_static.circom`).

Reference: snarkjs source at https://github.com/iden3/snarkjs/blob/master/src/groth16_prove.js
(the canonical circom prover algorithm).

Environment (already set up — do not re-install):
  - venv: `/tmp/zkx-guardrail-venv/bin/python`
  - solver lib: `/data/a41/bazel/a2888a4cffa9ac602adfb78d336aa5fd/execroot/rabbitsnark/bazel-out/k8-opt/bin/external/r1cs_solver/solver/libr1cs_solver.so`
  - export `R1CS_SOLVER_LIB=<above>` before running rabbitsnark

Rabbitsnark CLI:
  ```bash
  R1CS_SOLVER_LIB=$SOLVER /tmp/zkx-guardrail-venv/bin/rabbitsnark circom prove \
    <zkey> <out_proof.json> <out_pub.json> --wtns <witness.wtns>
  ```

---

## Checklist (every item must be `- [x]` and verified by ralph-verifier)

- [x] `R1CS_SOLVER_LIB=/data/a41/bazel/a2888a4cffa9ac602adfb78d336aa5fd/execroot/rabbitsnark/bazel-out/k8-opt/bin/external/r1cs_solver/solver/libr1cs_solver.so /tmp/zkx-guardrail-venv/bin/rabbitsnark circom prove /home/a41/Workspace/zkx-snap/circuits/build/pay_static_final.zkey /tmp/dod_proof.json /tmp/dod_pub.json --wtns /home/a41/Workspace/zkx-snap/circuits/build/witness.wtns` exits 0 AND `cd /home/a41/Workspace/zkx-snap/circuits && npx snarkjs groth16 verify build/pay_static_vk.json /tmp/dod_pub.json /tmp/dod_proof.json` exits 0

- [x] `R1CS_SOLVER_LIB=/data/a41/bazel/a2888a4cffa9ac602adfb78d336aa5fd/execroot/rabbitsnark/bazel-out/k8-opt/bin/external/r1cs_solver/solver/libr1cs_solver.so /tmp/zkx-guardrail-venv/bin/rabbitsnark circom prove /home/a41/Workspace/zkx-snap/circuits/build/bisect/np8/f.zkey /tmp/dod_np8_proof.json /tmp/dod_np8_pub.json --wtns /home/a41/Workspace/zkx-snap/circuits/build/bisect/np8/w.wtns` exits 0 AND `cd /home/a41/Workspace/zkx-snap/circuits && npx snarkjs groth16 verify build/bisect/np8/vk.json /tmp/dod_np8_pub.json /tmp/dod_np8_proof.json` exits 0

- [x] `R1CS_SOLVER_LIB=/data/a41/bazel/a2888a4cffa9ac602adfb78d336aa5fd/execroot/rabbitsnark/bazel-out/k8-opt/bin/external/r1cs_solver/solver/libr1cs_solver.so cd /tmp/rs-fresh && /tmp/zkx-guardrail-venv/bin/python -m pytest tests/circom/e2e_test.py -v` exits 0 (3 tests, all PASS — multiplier_3 regression check)

- [x] `R1CS_SOLVER_LIB=/data/a41/bazel/a2888a4cffa9ac602adfb78d336aa5fd/execroot/rabbitsnark/bazel-out/k8-opt/bin/external/r1cs_solver/solver/libr1cs_solver.so cd /tmp/rs-fresh && /tmp/zkx-guardrail-venv/bin/python -m pytest tests/gnark/ -v` exits 0 (14 tests, all PASS — gnark path no regression)

- [x] File `/home/a41/Workspace/zkx-snap/benchmarks/zkx_vs_vanilla.md` exists, contains the strings `vanilla`, `zkx`, `pay_static`, AND at least 6 numeric latency measurements in `ms` or `s` units (3 vanilla + 3 zkx runs minimum; median or mean reported)

- [x] File `/home/a41/Workspace/zkx-snap/rabbitsnark-fix.patch` exists, is non-empty, and contains a unified diff (`---`/`+++`/`@@` markers) of the changes made to files under `/tmp/rs-fresh/rabbitsnark/`

---

## Hints / starting points (NOT requirements, just context)

1. `rabbitsnark/groth16/prover.py::CompiledProver._run_prove` (lines 162-197) is the proof assembly hot path.
2. CLI passes `domain_size` for both `num_constraints` and `domain_size` to `compute_abc` (cli.py line 104-110). Earlier debug showed setting actual num_constraints didn't change the output — but verify this independently.
3. Both rabbitsnark's OWN verifier and snarkjs verifier reject the wrong proof — math bug, not public_signals layout bug.
4. `private_start = num_public + 1` for circom (prover.py line 173). snarkjs convention is the same.
5. For circom path, `_prove_ntt` returns h_evals on coset directly (no IFFT back) — different from gnark. This may or may not match snarkjs's H1 point semantics.
6. snarkjs's groth16_prove.js does: `proofA = sum(witness[i] * polsA[i]) + alpha + r*delta`, similar for B. C uses only private signals + cross terms.
7. Use `--no-zk` or fix r=s=0 deterministically when comparing zkX vs snarkjs proofs to eliminate randomness. Add a test fixture that pins r,s.

## Failure modes to avoid
- Don't rebuild libr1cs_solver.so (takes 10 min and isn't the bug — already verified by binary swap tests).
- Don't modify our pay_static.circom (the bug is in the prover, not the circuit).
- Don't touch the gnark path (it's verified working — 14/14 tests pass).
- Don't claim DoD verified without running every command in the checklist literally.
