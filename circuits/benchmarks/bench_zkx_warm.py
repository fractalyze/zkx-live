"""Warm-prover benchmark for zkX (rabbit-py).

Loads zkey + compiles ONCE, then does N warmup proofs + M timed iters.
Reports per-iteration breakdown for Az/Bz and proof generation. Mirrors
the methodology of `bench_vanilla_only.mjs` so the two are comparable.

Usage:
    python bench_zkx_warm.py <zkey> <wtns> <warmup> <iters>
"""
from __future__ import annotations

import os
import sys
import time

import numpy as np
from zk_dtypes import bn254_sf_mont

from rabbitsnark.circom.wtns import parse_wtns
from rabbitsnark.circom.zkey import parse_zkey
from rabbitsnark.circom.zkey_to_terms import zkey_to_terms
from rabbitsnark.groth16 import compile_circom, write_public_signals
from rabbitsnark.r1cs_solver import compute_abc

ZKEY = sys.argv[1]
WTNS = sys.argv[2]
WARMUP = int(sys.argv[3]) if len(sys.argv) > 3 else 1
ITERS = int(sys.argv[4]) if len(sys.argv) > 4 else 5

# Solver lib must be loadable for compute_abc; matches CLI behavior.
os.environ.setdefault(
    "R1CS_SOLVER_LIB",
    "/data/a41/bazel/a2888a4cffa9ac602adfb78d336aa5fd/execroot/rabbitsnark/"
    "bazel-out/k8-opt/bin/external/r1cs_solver/solver/libr1cs_solver.so",
)

print(f"zkey: {ZKEY}\nwtns: {WTNS}\nwarmup: {WARMUP}, iters: {ITERS}")

t0 = time.time()
zkey = parse_zkey(ZKEY)
print(f"  parse zkey: {time.time()-t0:.2f}s")

t0 = time.time()
compiled = compile_circom(zkey)
print(f"  compile (JAX/CUDA, ONE-TIME): {time.time()-t0:.2f}s")

t0 = time.time()
_terms, coefficients = zkey_to_terms(zkey)
print(f"  zkey_to_terms (ONE-TIME): {time.time()-t0:.2f}s")

t0 = time.time()
wtns = parse_wtns(WTNS)
witness_mont = wtns.data._witnesses.view(np.dtype(bn254_sf_mont))
z_std = wtns.data._witnesses
public_signals = write_public_signals(wtns.witnesses, compiled.config.num_public)
print(f"  parse wtns + public signals (per-witness): {time.time()-t0:.2f}s")


def one_iter():
    t = time.time()
    az_mont, bz_mont = compute_abc(
        witness_mont,
        compiled.terms,
        coefficients,
        compiled.domain_size,
        compiled.domain_size,
    )
    az_t = time.time() - t
    t = time.time()
    proof, _ = compiled.prove(z_std, az_mont, bz_mont, public_signals)
    proof_t = time.time() - t
    return az_t, proof_t


print()
print("Warmup:")
for i in range(WARMUP):
    az_t, proof_t = one_iter()
    print(f"  warmup {i+1}: Az/Bz={az_t*1000:.0f}ms, proof={proof_t*1000:.0f}ms (total {(az_t+proof_t)*1000:.0f}ms)")

print()
print("Timed iters:")
times = []
for i in range(ITERS):
    az_t, proof_t = one_iter()
    total = az_t + proof_t
    times.append(total)
    print(f"  iter {i+1}: Az/Bz={az_t*1000:.0f}ms, proof={proof_t*1000:.0f}ms (total {total*1000:.0f}ms)")

times_sorted = sorted(times)
median = times_sorted[len(times) // 2]
mean = sum(times) / len(times)
print()
print(
    f"Az/Bz + proof timings (ms): "
    f"min={min(times)*1000:.0f}, median={median*1000:.0f}, "
    f"mean={mean*1000:.1f}, max={max(times)*1000:.0f}"
)
print(f"All: {[f'{t*1000:.0f}' for t in times]}")
