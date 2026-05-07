// Steady-state proof-only benchmark for vanilla snarkjs.
// Loads zkey + witness once, warmup + iterations, reports median.

import * as snarkjs from 'snarkjs';
import { readFileSync } from 'node:fs';

const ZKEY = process.argv[2];
const WTNS = process.argv[3];
const WARMUP = parseInt(process.argv[4] ?? '2');
const ITERS = parseInt(process.argv[5] ?? '10');

console.log(`zkey: ${ZKEY}\nwtns: ${WTNS}\nwarmup: ${WARMUP}, iters: ${ITERS}`);

// snarkjs.groth16.prove takes file paths or buffers.  Pass buffers for fairness
// (no fs read each iteration).
const t0 = performance.now();
const zkeyBuf = readFileSync(ZKEY);
const wtnsBuf = readFileSync(WTNS);
console.log(`  setup (load buffers): ${(performance.now() - t0).toFixed(0)} ms`);

async function oneProof() {
  return await snarkjs.groth16.prove(zkeyBuf, wtnsBuf);
}

for (let i = 0; i < WARMUP; i++) {
  const t = performance.now();
  await oneProof();
  console.log(`  warmup ${i + 1}: ${(performance.now() - t).toFixed(0)} ms`);
}

const times = [];
for (let i = 0; i < ITERS; i++) {
  const t = performance.now();
  await oneProof();
  times.push(performance.now() - t);
}

const sorted = [...times].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
const mean = times.reduce((a, b) => a + b) / times.length;
console.log(`\nProof-only timings (ms): min=${Math.min(...times).toFixed(0)}, median=${median.toFixed(0)}, mean=${mean.toFixed(1)}, max=${Math.max(...times).toFixed(0)}`);
console.log(`All: [${times.map(t => t.toFixed(0)).join(', ')}]`);
