// Generate a witness-ready input.json for pay_static.circom (V1).
// Takes a Solana recipient pubkey (32 bytes) — splits it into the two 16-byte
// big-endian halves the circuit expects, builds a single-leaf-padded Merkle
// tree (depth 8) so this recipient is in the allowlist, recomputes the intent
// commitment, and writes a fresh input JSON.
//
// Usage:
//   node demo/build_v1_input.mjs <recipient_b58> <amount> <out.json>

import { buildPoseidon } from 'circomlibjs';
import { writeFileSync } from 'node:fs';

const [, , recipientB58, amountStr, outPath] = process.argv;
if (!recipientB58 || !amountStr || !outPath) {
    console.error('usage: build_v1_input.mjs <recipient_b58> <amount> <out.json>');
    process.exit(2);
}

// base58 → 32 bytes (no extra deps; tiny inline implementation)
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58decode(s) {
    let n = 0n;
    for (const c of s) {
        const i = B58.indexOf(c);
        if (i < 0) throw new Error('bad base58');
        n = n * 58n + BigInt(i);
    }
    let hex = n.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    let bytes = Buffer.from(hex, 'hex');
    let pad = 0;
    for (const c of s) { if (c === '1') pad++; else break; }
    return Buffer.concat([Buffer.alloc(pad), bytes]);
}

const recipientBytes = b58decode(recipientB58);
if (recipientBytes.length !== 32) {
    console.error(`recipient must decode to 32 bytes, got ${recipientBytes.length}`);
    process.exit(2);
}

const recipientHi = BigInt('0x' + recipientBytes.slice(0, 16).toString('hex')).toString();
const recipientLo = BigInt('0x' + recipientBytes.slice(16, 32).toString('hex')).toString();

const poseidon = await buildPoseidon();
const F = poseidon.F;
const H = (xs) => F.toString(poseidon(xs));

// Single-recipient tree at slot 0, padded right with zero hashes.
const recipientLeaf = H([recipientHi, recipientLo]);
const path = [];
const pathIdx = [];
let cur = recipientLeaf;
for (let d = 0; d < 8; d++) {
    path.push('0');
    pathIdx.push(0);
    cur = H([cur, '0']);
}
const intentRecipientsRoot = cur;

const amount = amountStr;
const amountCap = '100000000';
const maxPerRecipient = '10000000';
const expiry = '1778648989';
const asset = ['24197857200151252728969465429440056815', '338769989521388930494245921488005055265'];
const salt = '16045690984503098046';
const minValidNonce = '0';
const clusterId = '1';

// Intent integrity (V1 schema, vk_id=0):
//   left = Poseidon(recipients_root, cap, max_per, expiry, asset[0], asset[1], salt, 0)
//   intent_root_pub = Poseidon(left, cluster_id, min_valid_nonce)
const left = H([
    intentRecipientsRoot,
    amountCap,
    maxPerRecipient,
    expiry,
    asset[0],
    asset[1],
    salt,
    '0',
]);
const intentRootPub = H([left, clusterId, minValidNonce]);

// Wallet PDA + recipient ATA — placeholders are fine (only used in instruction encoding).
const walletPda = ['22685491128062564230891640495451214097', '45370982256125128461783280990902428194'];
const recipientAta = ['68056473384187692692674921486353642291', '90741964512250256923566561981804856388'];

const input = {
    intent_root_pub: intentRootPub,
    recipient: [recipientHi, recipientLo],
    amount,
    now: '1778044189',
    nonce: '1',
    min_valid_nonce: minValidNonce,
    cluster_id: clusterId,
    intent_recipients_root: intentRecipientsRoot,
    intent_amount_cap: amountCap,
    intent_max_per_recipient: maxPerRecipient,
    intent_expiry: expiry,
    intent_asset: asset,
    intent_salt: salt,
    merkle_path: path,
    merkle_path_indices: pathIdx,
    wallet_pda: walletPda,
    recipient_token_account: recipientAta,
};

writeFileSync(outPath, JSON.stringify(input, null, 2));
console.log(`Wrote ${outPath}`);
console.log(`  recipient bytes hi/lo: ${recipientHi} / ${recipientLo}`);
console.log(`  intent_root_pub:       ${intentRootPub}`);
