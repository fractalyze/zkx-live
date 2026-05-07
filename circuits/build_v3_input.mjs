// Build a witness-ready input.json for pay_with_reclaim_efficient.circom (V3).
//
// V3 uses personaelabs's "efficient ECDSA" — instead of (r, s, m) the circuit
// takes (s, T, U, TPreComputes) where:
//   T = r^-1 * R         (R is the curve point with R.x == r)
//   U = -(m * r^-1 * G)
//   TPreComputes = stride-8 cached multiples of T (32×256×2×4 field elements)
//
// Same trust model as standard ECDSA — just pre-computes the heavy parts off-chain.

import elliptic from 'elliptic';
import BN from 'bn.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { buildPoseidon } from 'circomlibjs';

const ec = new elliptic.ec('secp256k1');
const SECP256K1_N = new BN(
    'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141',
    16,
);
const STRIDE = 8n;
const NUM_STRIDES = 256n / STRIDE; // 32
const REGISTERS = 4n;

const CLAIM_BYTES = 256;
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

function splitToRegisters(value) {
    const hex = (value ?? 0n).toString(16).padStart(64, '0');
    const out = [];
    for (let k = 0; k < REGISTERS; k++) {
        const slice = hex.slice(k * 16, (k + 1) * 16);
        out.unshift(BigInt('0x' + slice).toString());
    }
    return out;
}

function bnToBigint(bn) {
    return BigInt('0x' + bn.toString(16));
}

function bytesToBigInt(bytes) {
    return BigInt('0x' + Buffer.from(bytes).toString('hex'));
}

// Match the ECDSAVerify circuit's expected pubKey output: x-coord then y-coord,
// each as 4×64-bit limbs (low-first standard).
function pointToLimbs(point) {
    return [
        splitToRegisters(point.x ? bnToBigint(point.x) : 0n),
        splitToRegisters(point.y ? bnToBigint(point.y) : 0n),
    ];
}

function getPointPreComputes(point) {
    const keyPoint = ec.keyFromPublic({
        x: Buffer.from(point.x.toString(16).padStart(64, '0'), 'hex'),
        y: Buffer.from(point.y.toString(16).padStart(64, '0'), 'hex'),
    });
    const gPowers = [];
    for (let i = 0n; i < NUM_STRIDES; i++) {
        const stride = [];
        const power = 2n ** (i * STRIDE);
        for (let j = 0n; j < 2n ** STRIDE; j++) {
            const l = j * power;
            const gPower = keyPoint.getPublic().mul(new BN(l.toString()));
            // l == 0 → point at infinity; elliptic returns it with null x/y.
            // splitToRegisters maps null/undefined to [0,0,0,0] which matches
            // what the circuit expects for the zero-multiple slot.
            stride.push([
                splitToRegisters(gPower.x ? bnToBigint(gPower.x) : 0n),
                splitToRegisters(gPower.y ? bnToBigint(gPower.y) : 0n),
            ]);
        }
        gPowers.push(stride);
    }
    return gPowers;
}

const poseidon = await buildPoseidon();
const F = poseidon.F;
const H = (xs) => F.toString(poseidon(xs));

// === 1. Generate / sign / convert to efficient form ===
const privBytes = secp256k1.utils.randomSecretKey();
const noblePub = secp256k1.getPublicKey(privBytes, false); // 0x04 || X || Y
const px = bytesToBigInt(noblePub.slice(1, 33));
const py = bytesToBigInt(noblePub.slice(33, 65));

const claimBytes = randomBytes(CLAIM_BYTES);
const claimHash = sha256(claimBytes);
const m = bytesToBigInt(claimHash);

// Sign with elliptic (we need (r, s, recovery) — noble's prehash:false form)
const ellipticKey = ec.keyFromPrivate(Buffer.from(privBytes).toString('hex'));
const sig = ellipticKey.sign(Buffer.from(claimHash), { canonical: false });
const r = sig.r;
const s = sig.s;
const recoveryParam = sig.recoveryParam ?? 0;

// Sanity: verify
if (!ellipticKey.verify(Buffer.from(claimHash), sig)) {
    throw new Error('elliptic self-verify failed');
}

// Recover R curve point: R has x == r, y based on recovery
const isYOdd = recoveryParam % 2;
const rPoint = ec.curve.pointFromX(new BN(r), isYOdd);

// T = r^-1 * R
const rInv = new BN(r).invm(SECP256K1_N);
const T = rPoint.mul(rInv);

// U = -(r^-1 * m * G)
const w = rInv.mul(new BN(m.toString())).neg().umod(SECP256K1_N);
const U = ec.curve.g.mul(w);

console.log('Computing TPreComputes (32×256×2×4 = 65,536 field elements)...');
const t0 = Date.now();
const TPreComputes = getPointPreComputes(T);
console.log(`  done in ${Date.now() - t0}ms`);

// Sanity-check the equation: pubKey == s * T + U
const sBN = new BN(s);
const sT = T.mul(sBN);
const recovered = sT.add(U);
if (!recovered.eq(ellipticKey.getPublic())) {
    throw new Error('efficient ECDSA equation failed self-check');
}
console.log('  pubKey == s*T + U ✓');

// === 2. Intent fields ===
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
const intentExpiry = '1778648989';
const intentAsset = ['24197857200151252728969465429440056815', '338769989521388930494245921488005055265'];
const intentSalt = '16045690984503098046';

// V3 intent commitment: vk_id = 2
const intentRootPub = H([
    intentRecipientsRoot,
    intentAmountCap,
    intentMaxPerRecipient,
    intentExpiry,
    intentAsset[0],
    intentAsset[1],
    intentSalt,
    '2', // vk_id = 2
]);

const input = {
    // public
    intent_root_pub: intentRootPub,
    recipient: [recipientHigh, recipientLow],
    amount: AMOUNT_STR ?? '5000000',
    now: '1778044189',
    attestor_pubkey: pointToLimbs(ellipticKey.getPublic()),

    // private — efficient ECDSA
    sig_s: splitToRegisters(bnToBigint(s)),
    ecdsa_TPreComputes: TPreComputes,
    ecdsa_U: pointToLimbs(U),

    // private — claim + intent
    claim_bytes: Array.from(claimBytes).map(String),
    github_user_id: '424242',
    repo_hash: H(['10001', '10002']),
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

const out = OUT_PATH_ARG ?? 'build/v3_input.json';
writeFileSync(out, JSON.stringify(input));
console.log(`Wrote ${out} (${(JSON.stringify(input).length / 1024).toFixed(0)} KB)`);
console.log(`  attestor pubkey x = ${px.toString(16).padStart(64, '0')}`);
console.log(`  attestor pubkey y = ${py.toString(16).padStart(64, '0')}`);
console.log(`  claim sha256      = ${Buffer.from(claimHash).toString('hex')}`);
console.log(`  intent_root_pub   = ${intentRootPub}`);
