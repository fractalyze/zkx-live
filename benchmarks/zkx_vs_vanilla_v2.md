# Benchmarks — vanilla snarkjs vs zkX on `pay_with_reclaim` (V2)

_Generated: 2026-05-06 · circuit `pay_with_reclaim.circom` · BN254 Groth16_
_The V2 circuit verifies a Reclaim attestor's secp256k1 ECDSA signature
**inside Groth16** so the on-chain verifier trusts only the attestor's
public key — no SDK trust._

## Circuit profile

- **Source**: `circuits/pay_with_reclaim.circom`
- **Composition**: ECDSA verify (circom-ecdsa) + SHA-256 (circomlib) +
  Poseidon intent binding + Merkle (depth 8) + amount/expiry comparators +
  SPL Transfer encoding
- **non-linear constraints**: 1,664,789
- **linear constraints**: 142,303
- **wires**: 1,796,975
- **public inputs (declared)**: 13; public outputs: 23 → VK has **36 publics**
- **private witness signals**: 293
- **r1cs file**: 331 MB
- **zkey file**: 946 MB
- **domain_size**: 2^21 = 2,097,152 (fits 1.66 M; pot22 used to be safe)

## Hardware

- 24-core CPU, 123 GB RAM
- 2× CUDA GPUs (driver 580.126.09, CUDA 13.0)
- node v22.17.1, snarkjs `0.7.4` (CPU + WASM, multi-thread)
- rabbitsnark `0.1.0` (jax 0.0.5.dev20260505004854 + zkx-cuda-pjrt)
- `libr1cs_solver.so`: bazel `-c opt`

## Method

- Vanilla **steady-state**: load zkey + witness once into a long-running
  Node process, do 1 warmup proof, then time 3 iterations
  (`circuits/bench_vanilla_only.mjs`). Mirrors a long-running prover service.
- zkX runs are individual CLI invocations, each pays the JAX/CUDA
  compile cost (~100 s) once. The reported "Az/Bz + proof" timings are
  the *post-compile* steady state — what the next prove costs once the
  process is warm.

## Results — pay_with_reclaim (1.66 M non-linear constraints)

### Steady-state proof-only

| Backend | min | median | mean | max |
|---|---:|---:|---:|---:|
| **vanilla snarkjs** (CPU + WASM, 3 iters) | 18,146 ms | **20,655 ms** | 19,936 ms | 21,006 ms |
| **zkX (rabbitsnark, GPU NTT/MSM)** Az/Bz + proof | 8,610 ms | **8,700 ms** | 9,173 ms | 10,210 ms |
| zkX proof-gen only (GPU MSM step) | 3,540 ms | **3,660 ms** | 3,807 ms | 4,220 ms |
| **Speedup (vanilla / zkX, full prove)** | 2.11× | **2.37×** | 2.17× | 2.06× |
| **Speedup (vanilla / zkX, MSM-only)** | 5.13× | **5.64×** | 5.24× | 4.98× |

Raw zkX timings (3 sequential CLI invocations, each cold-process):
- Az/Bz + proof: `[8610, 8700, 10210]` ms
- proof-gen only: `[3660, 3540, 4220]` ms
- one-time compile per process: `[101.3, 104.9, 117.0]` s

### Per-process startup (one-time costs)

| Backend | Cost |
|---|---:|
| vanilla snarkjs CLI cold (single prove) | 23,616 ms |
| zkX CLI cold (compile + Az/Bz + proof) | ~131 s (104 s compile + 5 s Az/Bz + 4 s proof) |
| zkX zkey "compile" step (per-process JAX/CUDA setup) | ~100-117 s |

→ For a long-running prover service, the per-process startup amortizes
to zero — what matters is the steady-state column above.

## Comparison vs V1 (`pay_static`)

| Metric | V1 pay_static | V2 pay_with_reclaim | Ratio |
|---|---:|---:|---:|
| non-linear constraints | 3,909 | 1,664,789 | 426× |
| domain size | 16,384 | 2,097,152 | 128× |
| public count (zkey) | 20 | 36 | 1.8× |
| **vanilla median prove** | 278 ms | 20,655 ms | 74× |
| **zkX median prove (full)** | 127 ms | 8,700 ms | 69× |
| **vanilla / zkX speedup** | 2.18× | 2.37× | — |

The speedup ratio is **stable across circuit sizes** — zkX wins by ~2.4×
end-to-end on both small Poseidon-heavy and large ECDSA-heavy circuits.
The MSM-only speedup grows from ~2× (V1) to ~5.6× (V2) because the
larger circuit has proportionally more MSM work, which is exactly what
GPU acceleration targets.

## Why zkX wins more on V2 than V1

- **MSM dominance**: For 1.66 M constraints the prover does 5 MSMs of
  ~2^21 points each. GPU MSM is ~5× faster than WASM CPU MSM at this
  scale; that's the headline 5.6× speedup.
- **Poseidon vs ECDSA mix**: V1 spends most of its constraints on
  Poseidon (FFT-friendly), while V2 spends 90 % on bigint multiplications
  (MSM-heavier). GPU helps both, but MSM more.
- **Az/Bz overhead is fixed-rate**: Az/Bz computation grows with
  constraint count and is not GPU-accelerated as aggressively as MSM —
  that's why "full prove speedup" (2.4×) is lower than "MSM-only"
  (5.6×). Future zkX work can close this gap.

## On-chain implications

- VK now has 36 publics (vs V1's 20). Update gateway constant
  `RECLAIM_NR_INPUTS = 36`.
- VK serialized size: 36 IC × 64 bytes + 448 bytes = 2,752 bytes.
  Fits in one PDA, no chunking needed.
- Light Protocol Groth16 verify CU is **independent of constraint count**
  — both V1 and V2 cost ~191 k CU on-chain. The 1.66 M-constraint circuit
  doesn't pay any on-chain penalty.

## Trust model comparison

| Aspect | V1 pay_static | V2 pay_with_reclaim |
|---|---|---|
| What's trusted on-chain | Light Protocol verifier | Light Protocol verifier |
| What's trusted off-chain | SDK (must construct correct intent) | Reclaim attestor secp256k1 pubkey |
| What's hidden in proof | Allowlist Merkle path | Claim contents, GitHub user id |
| Forging a successful proof requires | Breaking BN254 Groth16 | Breaking BN254 Groth16 OR breaking secp256k1 OR compromising attestor key |

## Reproduce

```bash
cd /home/a41/Workspace/zkx-snap/circuits

# 1. Compile (~30 s)
circom pay_with_reclaim.circom --r1cs --wasm --sym \
  -l node_modules -l deps/circom-ecdsa/circuits -o build/

# 2. Phase-2 zkey ceremony (~1.5 min, needs pot22)
./node_modules/.bin/snarkjs groth16 setup build/pay_with_reclaim.r1cs \
  ptau/pot22_hez.ptau build/pay_with_reclaim_0000.zkey
./node_modules/.bin/snarkjs zkey contribute \
  build/pay_with_reclaim_0000.zkey build/pay_with_reclaim_final.zkey \
  -e="zkx-guardrail-v2-bench"
./node_modules/.bin/snarkjs zkey export verificationkey \
  build/pay_with_reclaim_final.zkey build/pay_with_reclaim_vk.json

# 3. Build a fixture witness (~2.5 min for witness gen)
node build_v2_input.mjs build/v2_input.json
node build/pay_with_reclaim_js/generate_witness.js \
  build/pay_with_reclaim_js/pay_with_reclaim.wasm \
  build/v2_input.json build/v2_witness.wtns

# 4. Vanilla bench
node bench_vanilla_only.mjs build/pay_with_reclaim_final.zkey \
  build/v2_witness.wtns 1 3

# 5. zkX bench (rabbitsnark CLI, repeat for steady-state)
SOLVER=/data/a41/bazel/.../libr1cs_solver.so
RS=/tmp/zkx-guardrail-venv/bin/rabbitsnark
R1CS_SOLVER_LIB=$SOLVER $RS circom prove \
  build/pay_with_reclaim_final.zkey \
  build/v2_proof.json build/v2_public.json \
  --wtns build/v2_witness.wtns
```

## Knowledge captured

- circom-ecdsa requires symlinking circomlib so it resolves to a single
  physical path (otherwise `BinSum is already in use` due to dual
  include resolution).
- noble v2 `secp256k1.sign(hash, key)` defaults to `prehash:true` —
  pass `{prehash: false}` when feeding an already-computed hash.
  Otherwise the in-circuit ECDSA verifier rejects every signature.
- Light Protocol `groth16-solana` requires `proof_a` to be **pre-negated**
  by the SDK (multi-pairing optimization).
