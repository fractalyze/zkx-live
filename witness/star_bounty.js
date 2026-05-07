// Build witness-ready input for star_bounty.circom.
//
// API:
//   buildInput({
//     recipient_b58,                       // required — must be in intent.allowlist
//     amount,                              // required — string or number (u64)
//     now,                                 // optional — unix sec; default = floor(Date.now()/1000)
//
//     intent: {                            // signed permit (same shape as pay_intent
//       amount_cap,                        // but with window_start instead of nonce/cluster fields)
//       max_per_recipient,
//       window_start,
//       expiry,
//       asset: [hiField, loField],
//       salt,
//       allowlist: [b58, ...],
//     },
//
//     claim: {                             // attested off-chain claim
//       user_id,                           // numeric or numeric-string
//       repo_full,                         // "owner/repo"
//       timestamp,                         // optional, default = now
//     },
//     attestor_priv_hex,                   // 32-byte BabyJubjub private key (hex)
//
//     wallet_pda: [hi, lo],
//     recipient_token_account: [hi, lo],
//   }, deps)
//
// Returns { input, public_inputs }.

import { pubkeyToFields, buildPaddedMerkle, merkleProof } from './util.js';

const MERKLE_DEPTH = 8;
const VK_ID = '4';

function need(obj, keys, scope = 'star_bounty') {
    for (const k of keys) {
        if (obj[k] === undefined || obj[k] === null) throw new Error(`${scope}: missing ${k}`);
    }
}

// Fold a UTF-8 repo full_name into a single field via two 16-byte halves
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
    need(params, [
        'recipient_b58', 'amount', 'intent', 'claim',
        'attestor_priv_hex', 'wallet_pda', 'recipient_token_account',
    ]);
    need(params.intent, [
        'amount_cap', 'max_per_recipient', 'window_start', 'expiry',
        'asset', 'salt', 'allowlist',
    ], 'star_bounty.intent');
    need(params.claim, ['user_id', 'repo_full'], 'star_bounty.claim');

    const { F, H, eddsa } = deps;

    const recipient = pubkeyToFields(params.recipient_b58);
    const amount = String(params.amount);
    const now = String(params.now ?? Math.floor(Date.now() / 1000));

    const intent = params.intent;
    const intentAmountCap = String(intent.amount_cap);
    const intentMaxPer = String(intent.max_per_recipient);
    const intentWindowStart = String(intent.window_start);
    const intentExpiry = String(intent.expiry);
    const intentAsset = intent.asset.map(String);
    const intentSalt = String(intent.salt);

    if (BigInt(amount) > BigInt(intentAmountCap)) {
        throw new Error(`amount ${amount} > intent.amount_cap ${intentAmountCap}`);
    }
    if (BigInt(amount) > BigInt(intentMaxPer)) {
        throw new Error(`amount ${amount} > intent.max_per_recipient ${intentMaxPer}`);
    }
    if (BigInt(now) < BigInt(intentWindowStart) || BigInt(now) >= BigInt(intentExpiry)) {
        throw new Error(`now ${now} not in [window_start=${intentWindowStart}, expiry=${intentExpiry})`);
    }

    // Self-attestor key from given private key.
    const attestorPriv = Buffer.from(params.attestor_priv_hex, 'hex');
    if (attestorPriv.length !== 32) {
        throw new Error(`attestor_priv_hex must decode to 32 bytes, got ${attestorPriv.length}`);
    }
    const attestorPub = eddsa.prv2pub(attestorPriv);
    const Ax = F.toString(attestorPub[0]);
    const Ay = F.toString(attestorPub[1]);

    // Build claim and sign Poseidon(user_id, repo_hash, timestamp).
    const claim_user_id = String(params.claim.user_id);
    const claim_repo_hash = repoNameToHash(params.claim.repo_full, H);
    const claim_timestamp = String(params.claim.timestamp ?? now);

    const msg = F.e(H([claim_user_id, claim_repo_hash, claim_timestamp]));
    const sig = eddsa.signPoseidon(attestorPriv, msg);
    if (!eddsa.verifyPoseidon(msg, sig, attestorPub)) {
        throw new Error('eddsa self-verify failed');
    }
    const sig_R8x = F.toString(sig.R8[0]);
    const sig_R8y = F.toString(sig.R8[1]);
    const sig_S = sig.S.toString();

    // Merkle over allowlist.
    const leaves = intent.allowlist.map((b58) => {
        const [hi, lo] = pubkeyToFields(b58);
        return H([hi, lo]);
    });
    const recipientLeaf = H(recipient);
    const recipientIdx = leaves.indexOf(recipientLeaf);
    if (recipientIdx < 0) {
        throw new Error(`recipient ${params.recipient_b58} not in allowlist`);
    }
    const levels = buildPaddedMerkle(leaves, MERKLE_DEPTH, H);
    const intentRecipientsRoot = levels[MERKLE_DEPTH][0];
    const { path, indices } = merkleProof(levels, recipientIdx, MERKLE_DEPTH);

    // Intent commitment: Poseidon(9) including vk_id=4.
    const intentRootPub = H([
        intentRecipientsRoot, intentAmountCap, intentMaxPer,
        intentWindowStart, intentExpiry,
        intentAsset[0], intentAsset[1], intentSalt, VK_ID,
    ]);

    const wallet_pda = params.wallet_pda.map(String);
    const recipient_token_account = params.recipient_token_account.map(String);

    const input = {
        intent_root_pub: intentRootPub,
        recipient,
        amount,
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
        intent_max_per_recipient: intentMaxPer,
        intent_window_start: intentWindowStart,
        intent_expiry: intentExpiry,
        intent_asset: intentAsset,
        intent_salt: intentSalt,
        merkle_path: path,
        merkle_path_indices: indices,
        wallet_pda,
        recipient_token_account,
    };

    return {
        input,
        public_inputs: {
            intent_root_pub: intentRootPub,
            recipient,
            amount,
            now,
            attestor_Ax: Ax,
            attestor_Ay: Ay,
        },
    };
}
