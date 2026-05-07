// Build witness-ready input for star_bounty.circom.
//
// Self-attestor signs Poseidon(user_id, repo_hash, timestamp) with EdDSA-BabyJubjub
// (SNARK-native, ~3.5 k constraints in-circuit).

import { randomBytes } from 'node:crypto';

const MERKLE_DEPTH = 8;

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

// Fold a UTF-8 repo name into a single field element via two 16-byte halves
// hashed with Poseidon. Matches the in-circuit binding.
function repoNameToHash(name, H) {
    const bytes = Buffer.from(name, 'utf8');
    let n = 0n;
    for (const b of bytes) n = (n * 256n + BigInt(b)) % (1n << 248n);
    const lo = n & ((1n << 124n) - 1n);
    const hi = n >> 124n;
    return H([hi.toString(), lo.toString()]);
}

export function buildInput(params, deps) {
    const {
        recipient_b58,
        amount,
        user_id,
        repo_full,
        attestor_priv_hex,
    } = params;
    const { F, H, eddsa } = deps;

    if (!recipient_b58 || !amount) {
        throw new Error('star_bounty: recipient_b58 and amount required');
    }
    if (!user_id || !repo_full) {
        throw new Error('star_bounty: user_id and repo_full required');
    }

    // 1. Self-attestor key (BabyJubjub). Fixed if attestor_priv_hex given.
    const attestorPriv = attestor_priv_hex
        ? Buffer.from(attestor_priv_hex, 'hex')
        : randomBytes(32);
    const attestorPub = eddsa.prv2pub(attestorPriv);
    const Ax = F.toString(attestorPub[0]);
    const Ay = F.toString(attestorPub[1]);

    // 2. Build claim (user_id, repo_hash, timestamp) and sign.
    const claim_user_id = String(user_id);
    const claim_repo_hash = repoNameToHash(repo_full, H);
    const claim_timestamp = String(Math.floor(Date.now() / 1000));

    const msg = F.e(H([claim_user_id, claim_repo_hash, claim_timestamp]));
    const sig = eddsa.signPoseidon(attestorPriv, msg);
    if (!eddsa.verifyPoseidon(msg, sig, attestorPub)) {
        throw new Error('eddsa self-verify failed');
    }
    const sig_R8x = F.toString(sig.R8[0]);
    const sig_R8y = F.toString(sig.R8[1]);
    const sig_S = sig.S.toString();

    // 3. Recipient → 2× field; build single-leaf padded Merkle.
    const rb = b58decode(recipient_b58);
    if (rb.length !== 32) throw new Error(`recipient must be 32 bytes, got ${rb.length}`);
    const recipientHi = BigInt('0x' + rb.slice(0, 16).toString('hex')).toString();
    const recipientLo = BigInt('0x' + rb.slice(16, 32).toString('hex')).toString();

    const recipientLeaf = H([recipientHi, recipientLo]);
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

    // vk_id = 4 (star_bounty)
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

    const now = '1778044189';

    const input = {
        intent_root_pub: intentRootPub,
        recipient: [recipientHi, recipientLo],
        amount: String(amount),
        now,
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

    return {
        input,
        public_inputs: {
            intent_root_pub: intentRootPub,
            recipient: [recipientHi, recipientLo],
            amount: String(amount),
            now,
            attestor_Ax: Ax,
            attestor_Ay: Ay,
        },
    };
}
