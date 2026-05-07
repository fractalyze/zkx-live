# benchmarks

Vanilla snarkjs / rapidsnark / zkX latency comparison.

## W0 measurement (run before W1 starts)

Test circuit: 12k-constraint Merkle membership + Poseidon hashes.

```bash
# Vanilla snarkjs (browser/Node)
node bench_snarkjs.js

# Vanilla rapidsnark (native Rust prover)
./bench_rapidsnark

# zkX (your platform)
node bench_zkx.js
```

Record:
- Single-proof p50 latency
- Throughput (proofs/sec at sustained load)
- Memory footprint

These numbers anchor the pitch deck. **If zkX delta < 1.7x at 12k constraints, lean on V2 narrative (~50k constraints with Reclaim) where zkX shines more dramatically.**
