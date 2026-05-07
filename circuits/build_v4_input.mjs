// Build a witness-ready input.json for pay_with_reclaim_real.circom (V4).
//
// Mimics Reclaim's signing format:
//   identifier = keccak256(provider + "\n" + parameters + "\n" + canonicalContext)
//   dataStr    = identifier + "\n" + owner + "\n" + timestampS + "\n" + epoch
//   sig        = secp256k1.sign(keccak256(dataStr), attestor_priv)
//
// V4 uses plain keccak (no EIP-191 prefix yet) so the simulated attestor
// signs the same way the circuit verifies. To swap in a real Reclaim
// attestation, prepend "\x19Ethereum Signed Message:\n{len}" to the
// keccak input and re-sign.
//
// dataStr is padded with NUL bytes to exactly 128 bytes (matching
// `PayWithReclaimReal(8, 128)` in the circuit). Real Reclaim dataStr is
// shorter (~125 bytes); the demo accepts any 128-byte input that the
// attestor signed over.

import { keccak_256 } from '@noble/hashes/sha3.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { writeFileSync } from 'node:fs';
import { buildPoseidon } from 'circomlibjs';

const CLAIM_BYTES = 128;
const MERKLE_DEPTH = 8;

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
    for (let i = 0; i < 4; i++) limbs.push(((n >> BigInt(i * 64)) & mask).toString());
    return limbs;
}

function bytesToBigInt(bytes) {
    return BigInt('0x' + Buffer.from(bytes).toString('hex'));
}

const poseidon = await buildPoseidon();
const F = poseidon.F;
const H = (xs) => F.toString(poseidon(xs));

// === 1. Build a Reclaim-shaped claim ===
//
// provider, parameters, context can be anything for this fixture; the demo
// just exercises the cryptographic path. In a real Reclaim integration the
// SDK supplies these and the attestor signs the resulting dataStr.
const provider = 'github-stargazer';
const parameters = JSON.stringify({ username: 'demo-user', repo: 'yourzk/guardrail' });
const context = '';
const canonicalContext = context;
const innerStr = `${provider}\n${parameters}\n${canonicalContext}`;
const identifier = '0x' + Buffer.from(keccak_256(Buffer.from(innerStr, 'utf8'))).toString('hex');

const owner = '0x' + 'aa'.repeat(20);   // 42-char ETH-style address
const timestampS = '1714992000';
const epoch = '1';
const dataStr = `${identifier}\n${owner}\n${timestampS}\n${epoch}`;

// Pad dataStr to exactly CLAIM_BYTES (128) bytes with NUL — circuit signs
// over this padded form, so the simulated attestor must too.
const dataStrBytes = Buffer.from(dataStr, 'utf8');
if (dataStrBytes.length > CLAIM_BYTES) {
    console.error(`dataStr (${dataStrBytes.length}B) exceeds CLAIM_BYTES=${CLAIM_BYTES}`);
    process.exit(2);
}
const claimBytes = Buffer.concat([dataStrBytes, Buffer.alloc(CLAIM_BYTES - dataStrBytes.length)]);

// === 2. Simulated attestor signs keccak256(claimBytes) ===
const attestorPriv = secp256k1.utils.randomSecretKey();
const attestorPub = secp256k1.getPublicKey(attestorPriv, false); // 0x04 || X || Y
const px = bytesToBigInt(attestorPub.slice(1, 33));
const py = bytesToBigInt(attestorPub.slice(33, 65));

const msghash = keccak_256(claimBytes);    // 32 bytes
const m = bytesToBigInt(msghash);

const sigBytes = secp256k1.sign(msghash, attestorPriv, { lowS: false, prehash: false });
const r = bytesToBigInt(sigBytes.slice(0, 32));
const s = bytesToBigInt(sigBytes.slice(32, 64));

// Sanity: noble verify
if (!secp256k1.verify(sigBytes, msghash, attestorPub, { prehash: false, lowS: false })) {
    throw new Error('noble self-verify failed');
}

// === 3. Intent fields (V4 uses vk_id=3) ===
let recipientHigh = '43562';
let recipientLow = '47914';
if (RECIPIENT_B58) {
    const rb = b58decode(RECIPIENT_B58);
    if (rb.length !== 32) {
        console.error(`recipient must decode to 32 bytes, got ${rb.length}`);
        process.exit(2);
    }
    recipientHigh = BigInt('0x' + rb.slice(0, 16).toString('hex')).toString();
    recipientLow = BigInt('0x' + rb.slice(16, 32).toString('hex')).toString();
}

const recipientLeaf = H([recipientHigh, recipientLow]);
const path = [];
const pathIdx = [];
let cur = recipientLeaf;
for (let d = 0; d < MERKLE_DEPTH; d++) {
    path.push('0');
    pathIdx.push(0);
    cur = H([cur, '0']);
}
const intentRecipientsRoot = cur;

const intentAmountCap = '100000000';
const intentMaxPerRecipient = '10000000';
const intentWindowStart = '1';            // V4 step-3: bounty window opens
const intentExpiry = '1778648989';
const intentAsset = ['24197857200151252728969465429440056815', '338769989521388930494245921488005055265'];
const intentSalt = '16045690984503098046';

// V4: vk_id = 3, includes window_start
const intentRootPub = H([
    intentRecipientsRoot,
    intentAmountCap,
    intentMaxPerRecipient,
    intentWindowStart,
    intentExpiry,
    intentAsset[0],
    intentAsset[1],
    intentSalt,
    '3',
]);

const input = {
    intent_root_pub: intentRootPub,
    recipient: [recipientHigh, recipientLow],
    amount: AMOUNT_STR ?? '5000000',
    now: '1778044189',
    attestor_pubkey: [bigintToLimbs(px), bigintToLimbs(py)],

    claim_bytes: Array.from(claimBytes).map(String),
    sig_r: bigintToLimbs(r),
    sig_s: bigintToLimbs(s),
    github_user_id: '424242',
    repo_hash: H(['10001', '10002']),

    intent_recipients_root: intentRecipientsRoot,
    intent_amount_cap: intentAmountCap,
    intent_max_per_recipient: intentMaxPerRecipient,
    intent_window_start: intentWindowStart,
    intent_expiry: intentExpiry,
    intent_asset: intentAsset,
    intent_salt: intentSalt,
    merkle_path: path,
    merkle_path_indices: pathIdx,
    wallet_pda: ['11111111111111111111', '22222222222222222222'],
    recipient_token_account: ['33333333333333333333', '44444444444444444444'],
};

const out = OUT_PATH_ARG ?? 'build/v4_input.json';
writeFileSync(out, JSON.stringify(input, null, 2));
console.log(`Wrote ${out}`);
console.log(`  Reclaim-format dataStr (${dataStrBytes.length} → padded to ${CLAIM_BYTES} bytes):`);
console.log(`    ${dataStr.replace(/\n/g, '\\n')}`);
console.log(`  identifier        = ${identifier}`);
console.log(`  attestor pubkey x = ${px.toString(16).padStart(64, '0')}`);
console.log(`  msghash (keccak256) = 0x${Buffer.from(msghash).toString('hex')}`);
