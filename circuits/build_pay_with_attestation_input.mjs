// Witness-ready input.json for pay_with_attestation.circom.
//
// Self-attestor signs (user_id, repo_hash, timestamp) compressed via Poseidon
// using EdDSA over BabyJubjub — SNARK-native ~3.5k constraints.
//
// Usage: node build_v5_input.mjs <recipient_b58> <amount> <out.json>

import { buildPoseidon, buildEddsa, buildBabyjub } from 'circomlibjs';
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const MERKLE_DEPTH = 8;
const [, , RECIPIENT_B58, AMOUNT_STR, OUT_PATH_ARG, USER_ID_ARG, REPO_NAME_ARG, ATTESTOR_PRIV_HEX] = process.argv;

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

const poseidon = await buildPoseidon();
const eddsa = await buildEddsa();
const babyjub = await buildBabyjub();
const F = poseidon.F;
const Fr = babyjub.F;
const H = (xs) => F.toString(poseidon(xs));

// === 1. Self-attestor key (BabyJubjub) — fixed if ATTESTOR_PRIV_HEX is given ===
const attestorPriv = ATTESTOR_PRIV_HEX
    ? Buffer.from(ATTESTOR_PRIV_HEX, 'hex')
    : randomBytes(32);
const attestorPub = eddsa.prv2pub(attestorPriv);
const Ax = F.toString(attestorPub[0]);
const Ay = F.toString(attestorPub[1]);

// === 2. Build claim (user_id, repo_hash, timestamp) ===
const claim_user_id = USER_ID_ARG ?? '424242';      // GitHub user id (numeric)
// repo_hash = Poseidon over the repo full_name's first/last halves as fields
function repoNameToHash(name) {
    const bytes = Buffer.from(name, 'utf8');
    // pad to 32 bytes, split into two 16-byte halves; if longer, fold
    let n = 0n;
    for (const b of bytes) n = (n * 256n + BigInt(b)) % (1n << 248n); // keep within field
    const lo = n & ((1n << 124n) - 1n);
    const hi = n >> 124n;
    return H([hi.toString(), lo.toString()]);
}
const claim_repo_hash = REPO_NAME_ARG
    ? repoNameToHash(REPO_NAME_ARG)
    : H(['10001', '10002']);
const claim_timestamp = String(Math.floor(Date.now() / 1000));

// Message that EdDSA signs = Poseidon(user_id, repo_hash, timestamp)
const msg = F.e(H([claim_user_id, claim_repo_hash, claim_timestamp]));
const sig = eddsa.signPoseidon(attestorPriv, msg);
const sig_R8x = F.toString(sig.R8[0]);
const sig_R8y = F.toString(sig.R8[1]);
const sig_S = sig.S.toString();

// Sanity verify
if (!eddsa.verifyPoseidon(msg, sig, attestorPub)) {
    throw new Error('eddsa self-verify failed');
}

// === 3. Intent fields ===
let recipientHigh = '43562';
let recipientLow = '47914';
if (RECIPIENT_B58) {
    const rb = b58decode(RECIPIENT_B58);
    if (rb.length !== 32) throw new Error('recipient must be 32 bytes');
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
const intentWindowStart = '1';
const intentExpiry = '1778648989';
const intentAsset = ['24197857200151252728969465429440056815', '338769989521388930494245921488005055265'];
const intentSalt = '16045690984503098046';

// V5: vk_id = 4
const intentRootPub = H([
    intentRecipientsRoot,
    intentAmountCap,
    intentMaxPerRecipient,
    intentWindowStart,
    intentExpiry,
    intentAsset[0],
    intentAsset[1],
    intentSalt,
    '4',
]);

const input = {
    intent_root_pub: intentRootPub,
    recipient: [recipientHigh, recipientLow],
    amount: AMOUNT_STR ?? '5000000',
    now: '1778044189',
    attestor_Ax: Ax,
    attestor_Ay: Ay,

    claim_user_id,
    claim_repo_hash,
    claim_timestamp,
    sig_R8x,
    sig_R8y,
    sig_S,

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

const out = OUT_PATH_ARG ?? 'build/v5_input.json';
writeFileSync(out, JSON.stringify(input, null, 2));
console.log(`Wrote ${out}`);
console.log(`  attestor BabyJubjub Ax = ${Ax}`);
console.log(`  attestor BabyJubjub Ay = ${Ay}`);
console.log(`  claim user_id          = ${claim_user_id}`);
console.log(`  claim repo_hash        = ${claim_repo_hash}`);
console.log(`  claim timestamp        = ${claim_timestamp}`);
console.log(`  msg (Poseidon)         = ${F.toString(msg)}`);
