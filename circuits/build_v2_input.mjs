// Build a witness-ready input.json for pay_with_reclaim.circom.
//
// Generates a fresh secp256k1 attestor keypair, signs a random 256-byte
// claim payload, and packages the witness alongside V1-style intent
// fields (Merkle depth-8, single-recipient tree).
//
// Endianness conventions (circom-ecdsa / 4x64 limbs):
//   limb[0] = low 64 bits, limb[3] = high 64 bits
//   within each limb: standard uint64

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { buildPoseidon } from 'circomlibjs';

const CLAIM_BYTES = 256;
const MERKLE_DEPTH = 8;

// Optional CLI args: <recipient_b58> <amount> <out_path>
// If omitted, falls back to placeholder values (for benchmarking).
const [, , RECIPIENT_B58, AMOUNT_STR, OUT_PATH_ARG] = process.argv;

function b58decode(s) {
    const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
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

function bigintToLimbs(n) {
    const mask = (1n << 64n) - 1n;
    const limbs = [];
    for (let i = 0; i < 4; i++) {
        limbs.push(((n >> BigInt(i * 64)) & mask).toString());
    }
    return limbs;
}

function bytesToBigInt(bytes) {
    return BigInt('0x' + Buffer.from(bytes).toString('hex'));
}

function pubkeyToHalves(pubkeyBigInt) {
    // Solana pubkey-style: split 32-byte BE into two 16-byte big-endian halves
    const high = pubkeyBigInt >> 128n;
    const low = pubkeyBigInt & ((1n << 128n) - 1n);
    return [high.toString(), low.toString()];
}

const poseidon = await buildPoseidon();
const F = poseidon.F;
const H = (xs) => F.toString(poseidon(xs));

// === 1. Attestor keypair + claim signing ===
const privKey = secp256k1.utils.randomSecretKey();
const pubKey = secp256k1.getPublicKey(privKey, false); // uncompressed: 0x04 || X(32) || Y(32)
const px = bytesToBigInt(pubKey.slice(1, 33));
const py = bytesToBigInt(pubKey.slice(33, 65));

const claimBytes = randomBytes(CLAIM_BYTES);
const claimHash = sha256(claimBytes);

// noble v2: sign() returns 64 bytes (r||s) in compact format. Default behavior
// is to re-hash the input ('prehash: true'); we already have the SHA-256 digest,
// so we pass prehash:false to sign over claimHash directly. circom-ecdsa
// verifies the signature against the same raw msghash.
const sigBytes = secp256k1.sign(claimHash, privKey, { lowS: false, prehash: false });
const r = bytesToBigInt(sigBytes.slice(0, 32));
const s = bytesToBigInt(sigBytes.slice(32, 64));

// === 2. Intent fields ===
let recipientHigh = '43562';        // placeholder
let recipientLow = '47914';
if (RECIPIENT_B58) {
    const rbytes = b58decode(RECIPIENT_B58);
    if (rbytes.length !== 32) {
        console.error(`recipient must decode to 32 bytes, got ${rbytes.length}`);
        process.exit(2);
    }
    recipientHigh = BigInt('0x' + rbytes.slice(0, 16).toString('hex')).toString();
    recipientLow = BigInt('0x' + rbytes.slice(16, 32).toString('hex')).toString();
}
const recipientLeaf = H([recipientHigh, recipientLow]);

const ZERO = '0';
let path = [];
let pathIdx = [];
let cur = recipientLeaf;
for (let d = 0; d < MERKLE_DEPTH; d++) {
    path.push(ZERO);
    pathIdx.push(0); // always left
    cur = H([cur, ZERO]);
}
const intentRecipientsRoot = cur;

const intentAmountCap = '100000000';
const intentMaxPerRecipient = '10000000';
const intentExpiry = '1778648989';
const intentAsset = ['24197857200151252728969465429440056815', '338769989521388930494245921488005055265'];
const intentSalt = '16045690984503098046';

// V2 intent commitment: Poseidon(8) of all fields with vk_id=1
const intentRootPub = H([
    intentRecipientsRoot,
    intentAmountCap,
    intentMaxPerRecipient,
    intentExpiry,
    intentAsset[0],
    intentAsset[1],
    intentSalt,
    '1', // vk_id = 1
]);

// === 3. Build witness JSON ===
const input = {
    // public
    intent_root_pub: intentRootPub,
    recipient: [recipientHigh, recipientLow],
    amount: AMOUNT_STR ?? '5000000',
    now: '1778044189',
    attestor_pubkey: [bigintToLimbs(px), bigintToLimbs(py)],

    // private — Reclaim
    claim_bytes: Array.from(claimBytes).map(String),
    sig_r: bigintToLimbs(r),
    sig_s: bigintToLimbs(s),
    github_user_id: '424242',
    repo_hash: H(['10001', '10002']),

    // private — intent
    intent_recipients_root: intentRecipientsRoot,
    intent_amount_cap: intentAmountCap,
    intent_max_per_recipient: intentMaxPerRecipient,
    intent_expiry: intentExpiry,
    intent_asset: intentAsset,
    intent_salt: intentSalt,
    merkle_path: path,
    merkle_path_indices: pathIdx,
    wallet_pda: ['11111111111111111111', '22222222222222222222'],
    recipient_token_account: ['33333333333333333333', '44444444444444444444'],
};

const out = OUT_PATH_ARG ?? 'build/v2_input.json';
writeFileSync(out, JSON.stringify(input, null, 2));
console.log(`Wrote ${out}`);
console.log(`  attestor pubkey x = ${px.toString(16).padStart(64, '0')}`);
console.log(`  attestor pubkey y = ${py.toString(16).padStart(64, '0')}`);
console.log(`  claim sha256      = ${Buffer.from(claimHash).toString('hex')}`);
console.log(`  intent_root_pub   = ${intentRootPub}`);
