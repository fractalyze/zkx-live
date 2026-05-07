// Generate a test witness for pay_static.circom.
// Builds a Merkle allowlist with 256 leaves (depth 8), picks one as recipient,
// computes Poseidon hashes for the intent commitment + nullifier, and writes
// build/input.json ready for snarkjs prove.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPoseidon } from 'circomlibjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../build/input.json');
mkdirSync(dirname(OUT), { recursive: true });

const MERKLE_DEPTH = 8;
const LEAVES = 1 << MERKLE_DEPTH;          // 256

const poseidon = await buildPoseidon();
const F = poseidon.F;                       // BN254 field
const toStr = (x) => F.toString(F.e(x));    // Field element → decimal string for JSON

// -----------------------------------------------------------------------------
// 1. Build a 256-leaf Merkle tree (Poseidon)
// -----------------------------------------------------------------------------

// Each leaf is Poseidon(pubkey_hi, pubkey_lo). Use deterministic toy pubkeys.
function fakePubkey(i) {
  return [BigInt(0xAA00 + i), BigInt(0xBB00 + i)];
}

const leaves = [];
for (let i = 0; i < LEAVES; i++) {
  const [hi, lo] = fakePubkey(i);
  leaves.push(F.toObject(poseidon([hi, lo])));
}

// Build tree level-by-level
let level = leaves.slice();
const tree = [level];                       // tree[0] = leaves, tree[depth] = [root]
while (level.length > 1) {
  const next = [];
  for (let i = 0; i < level.length; i += 2) {
    next.push(F.toObject(poseidon([level[i], level[i + 1]])));
  }
  tree.push(next);
  level = next;
}
const root = tree[MERKLE_DEPTH][0];

// Pick recipient at index 42 (arbitrary)
const RECIPIENT_INDEX = 42;
const recipient = fakePubkey(RECIPIENT_INDEX);

// Build Merkle path for recipient
const path = [];
const indices = [];
let idx = RECIPIENT_INDEX;
for (let lvl = 0; lvl < MERKLE_DEPTH; lvl++) {
  const sib = idx ^ 1;                      // sibling at this level
  path.push(tree[lvl][sib]);
  indices.push(idx & 1);                    // 0 if we're left, 1 if right
  idx >>= 1;
}

// -----------------------------------------------------------------------------
// 2. Build IntentBundle commitment
// -----------------------------------------------------------------------------
const intent = {
  recipients_root: root,
  amount_cap: 100n * 1_000_000n,           // 100 USDC (6 decimals)
  max_per_recipient: 10n * 1_000_000n,     // 10 USDC
  expiry: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600),
  asset: [BigInt('0x1234567890abcdef1234567890abcdef'), BigInt('0xfedcba0987654321fedcba0987654321')],
  salt: BigInt('0xdeadbeefcafebabe'),
  cluster_id: 1n,                           // devnet
  min_valid_nonce: 0n,
};

// Two-stage Poseidon (matches circuit)
const left = F.toObject(poseidon([
  intent.recipients_root,
  intent.amount_cap,
  intent.max_per_recipient,
  intent.expiry,
  intent.asset[0],
  intent.asset[1],
  intent.salt,
  0n,                                       // vk_id = 0
]));
const intent_root = F.toObject(poseidon([left, intent.cluster_id, intent.min_valid_nonce]));

// -----------------------------------------------------------------------------
// 3. Compute nullifier = Poseidon(intent_root, nonce, recipient[0], recipient[1])
// -----------------------------------------------------------------------------
const nonce = 1n;
const nullifier = F.toObject(poseidon([intent_root, nonce, recipient[0], recipient[1]]));

// -----------------------------------------------------------------------------
// 4. Spend amount + tx context
// -----------------------------------------------------------------------------
const amount = 5n * 1_000_000n;             // 5 USDC
const now = BigInt(Math.floor(Date.now() / 1000));

const wallet_pda = [
  BigInt('0x11111111111111111111111111111111'),
  BigInt('0x22222222222222222222222222222222'),
];
const recipient_token_account = [
  BigInt('0x33333333333333333333333333333333'),
  BigInt('0x44444444444444444444444444444444'),
];

// -----------------------------------------------------------------------------
// 5. Emit input.json
// -----------------------------------------------------------------------------
const input = {
  // public
  intent_root_pub: toStr(intent_root),
  recipient: recipient.map(toStr),
  amount: toStr(amount),
  now: toStr(now),
  // private
  nonce: toStr(nonce),
  min_valid_nonce: toStr(intent.min_valid_nonce),
  cluster_id: toStr(intent.cluster_id),
  intent_recipients_root: toStr(intent.recipients_root),
  intent_amount_cap: toStr(intent.amount_cap),
  intent_max_per_recipient: toStr(intent.max_per_recipient),
  intent_expiry: toStr(intent.expiry),
  intent_asset: intent.asset.map(toStr),
  intent_salt: toStr(intent.salt),
  merkle_path: path.map(toStr),
  merkle_path_indices: indices.map((b) => b.toString()),
  wallet_pda: wallet_pda.map(toStr),
  recipient_token_account: recipient_token_account.map(toStr),
};

writeFileSync(OUT, JSON.stringify(input, null, 2));
console.log('wrote', OUT);
console.log('  recipient idx       :', RECIPIENT_INDEX);
console.log('  recipients_root     :', intent.recipients_root.toString(16).slice(0, 16) + '...');
console.log('  intent_root         :', intent_root.toString(16).slice(0, 16) + '...');
console.log('  nullifier           :', nullifier.toString(16).slice(0, 16) + '...');
console.log('  amount (cap = 100M) :', amount.toString());
