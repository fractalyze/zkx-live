# Benchmarks — vanilla snarkjs vs zkx (rabbitsnark) on `pay_static`

_Generated: 2026-05-06 · circuit `pay_static.circom` · BN254 Groth16_

## Circuit profile

- **Source**: `circuits/pay_static.circom`
- **non-linear constraints**: 3,909
- **linear constraints**: 4,817
- **wires**: 8,743
- **public inputs**: 5; public outputs: 15
- **num_public_inputs (zkey)**: 20
- **domain_size**: 16,384

## Hardware

- **GPU**: 2× CUDA devices (driver 580.126.09, CUDA 13.0)
- **JAX backend**: `gpu` (CudaDevice — confirmed: `IFFT n=16384` runs in 0.43 ms on GPU)
- **node**: v22.17.1, snarkjs `0.7.4` (CPU + WASM, multi-thread)
- **rabbitsnark**: `0.1.0` (jax 0.0.5.dev20260505004854 + zkx-cuda-pjrt)
- **libr1cs_solver.so**: bazel-built, `-c opt`

## Method (the FAIR comparison — steady-state proof-only)

Both benchmarks: load zkey + witness ONCE into memory, run 2 warmup
proofs (triggers JIT trace and CUDA kernel cache for zkX, JIT for V8 +
WASM in vanilla), then time 10 proof iterations and report stats.

This mirrors a long-running prover service: zkey is loaded once at
startup, JIT/setup cost amortizes to zero, each request is a single
prove call.

Bench scripts: `circuits/bench_vanilla_only.mjs` and `/tmp/bench_prove_only.py`.

## Results — pay_static (3,909 non-linear constraints, dom=16,384)

### Steady-state proof-only

| Backend | min | median | mean | max |
|---------|----:|-------:|-----:|----:|
| **vanilla snarkjs** (CPU + WASM, multi-thread) | 228 ms | **278 ms** | 277 ms | 344 ms |
| **zkx (rabbitsnark)** (GPU NTT/MSM + CPU EC) | 113 ms | **127 ms** | 134 ms | 178 ms |
| **Speedup (vanilla / zkx)** | 2.02× | **2.18×** | 2.07× | 1.93× |

Raw timings (10 iters each):
- vanilla: `[295, 243, 278, 290, 290, 277, 262, 228, 344, 259]` ms
- zkx:     `[126, 125, 124, 113, 127, 129, 178, 116, 133, 174]` ms

### Cold-start (single CLI invocation, includes Python/Node startup + load + JIT + first prove)

| Backend | Wall-clock |
|---------|-----------:|
| vanilla snarkjs CLI | ~1,084 ms |
| rabbitsnark CLI (cold) | ~6,636 ms (3.7 s compile + 2.3 s first prove + 0.6 s overhead) |

→ Cold start zkX is much slower because of one-time JAX import + JIT
trace + CUDA context setup. **Not relevant to production prover
service** which keeps state across many proofs.

## Why zkX is faster steady-state at this circuit size

- **GPU FFT/IFFT**: `IFFT n=16384` measured at 0.43 ms on CUDA. Vanilla
  CPU FFT for the same size is ~10-30 ms. 6 FFT/IFFT calls per proof
  → ~50-150 ms saved.
- **GPU MSM**: `lax.msm` runs on GPU; vanilla snarkjs uses WASM
  multi-thread CPU. For 5 MSMs at this scale, ~50-100 ms saved.
- **Per-tx fresh proof becomes viable**: 127 ms median means 5 sequential
  proofs take ~635 ms — feels native in agent UX.

## Critical bug fix that made this measurement possible

Before the fix in `/home/a41/Workspace/zkx-snap/rabbitsnark-fix.patch`,
zkx generated **invalid Groth16 proofs** for any circuit with
`domain_size >= 32`. snarkjs verify reported "Invalid proof" on every
zkx output. Root cause: `CIRCOM_GENERATOR = 7` instead of `5`. snarkjs's
ffjavascript pins `Fr.shift = 5` for BN254. Both 5 and 7 happen to
give the same coset shift `g^((p-1)/(2n))` for n ≤ 16 (lucky coincidence
in the cyclic subgroup), but diverge for n ≥ 32 — the H polynomial was
being evaluated on coset 7H while the H1 points in the zkey were
generated assuming coset 5H, breaking the MSM result.

After the 1-line fix (CIRCOM_GENERATOR = 5), proofs verify via both
rabbitsnark's own verifier and snarkjs. See the patch for the diff +
expanded rationale comment.

## Note on GPU utilization sampling

`nvidia-smi dmon -d 1` reports SM utilization at 0% throughout — but
this is a sampling-rate artifact (1 Hz can't capture sub-millisecond
GPU bursts). Confirmed via direct `lax.fft.block_until_ready()` timing
that GPU runs the FFT in 0.43 ms. GPU memory peak: 24 GB on device 0
(JAX + zkx-cuda-pjrt allocations).
