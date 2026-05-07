// Verify the circuit actually rejects bad witnesses.
// Reads the valid input.json, mutates one field at a time, asserts prove fails.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as snarkjs from 'snarkjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const valid = JSON.parse(readFileSync(resolve(__dirname, '../build/input.json'), 'utf8'));
const wasmPath = resolve(__dirname, '../build/pay_static_js/pay_static.wasm');
const zkeyPath = resolve(__dirname, '../build/pay_static_final.zkey');

const cases = [
  {
    name: 'amount > intent_amount_cap',
    mut: { amount: '999000000' },              // 999 USDC > 100 USDC cap
  },
  {
    name: 'amount > intent_max_per_recipient',
    mut: { amount: '50000000' },               // 50 USDC > 10 USDC per-recipient
  },
  {
    name: 'now > intent_expiry',
    mut: { now: '99999999999' },               // far future
  },
  {
    name: 'nonce < min_valid_nonce',
    mut: { nonce: '0', min_valid_nonce: '5' }, // nonce below floor
  },
  {
    name: 'recipient not in allowlist (wrong leaf)',
    mut: { recipient: ['9999999999', '8888888888'] },
  },
  {
    name: 'wrong intent_root commitment',
    mut: { intent_root_pub: '12345' },
  },
];

let pass = 0, fail = 0;
for (const tc of cases) {
  const input = { ...valid, ...tc.mut };
  try {
    await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
    console.log(`✗ NOT REJECTED: ${tc.name}`);
    fail++;
  } catch (e) {
    const msg = (e?.message || String(e)).split('\n')[0].slice(0, 100);
    console.log(`✓ rejected: ${tc.name}  (${msg})`);
    pass++;
  }
}

console.log(`\n${pass}/${cases.length} tampered cases correctly rejected`);
process.exit(fail === 0 ? 0 : 1);
