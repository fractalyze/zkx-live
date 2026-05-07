// Build witness-ready input for pay_intent.circom.
//
// API:
//   buildInput({
//     recipient_b58,                       // required — must be in intent.allowlist
//     amount,                              // required — string or number (u64)
//     nonce,                               // required — replay token; circuit checks ≥ intent.min_valid_nonce
//     now,                                 // optional — unix sec; default = floor(Date.now()/1000)
//
//     intent: {                            // the signed permit
//       amount_cap,
//       max_per_recipient,
//       expiry,
//       asset: [hiField, loField],         // 2× field for the 32-byte mint
//       salt,
//       min_valid_nonce,
//       cluster_id,
//       allowlist: [b58, b58, ...],        // ≤ 256 (depth-8 tree); recipient_b58 must be in here
//     },
//
//     wallet_pda: [hiField, loField],      // 32-byte PDA as 2× field
//     recipient_token_account: [hi, lo],   // 32-byte ATA as 2× field
//   }, deps)
//
// Returns { input, public_inputs }.

import { pubkeyToFields, buildPaddedMerkle, merkleProof } from './util.mjs';

const MERKLE_DEPTH = 8;
const VK_ID = '0';

function need(obj, keys) {
    for (const k of keys) {
        if (obj[k] === undefined || obj[k] === null) throw new Error(`pay_intent: missing ${k}`);
    }
}

export function buildInput(params, deps) {
    need(params, ['recipient_b58', 'amount', 'nonce', 'intent', 'wallet_pda', 'recipient_token_account']);
    need(params.intent, [
        'amount_cap', 'max_per_recipient', 'expiry', 'asset', 'salt',
        'min_valid_nonce', 'cluster_id', 'allowlist',
    ]);
    const { H } = deps;

    const recipient = pubkeyToFields(params.recipient_b58);
    const amount = String(params.amount);
    const nonce = String(params.nonce);
    const now = String(params.now ?? Math.floor(Date.now() / 1000));

    const intent = params.intent;
    const intentAmountCap = String(intent.amount_cap);
    const intentMaxPer = String(intent.max_per_recipient);
    const intentExpiry = String(intent.expiry);
    const intentAsset = intent.asset.map(String);
    const intentSalt = String(intent.salt);
    const minValidNonce = String(intent.min_valid_nonce);
    const clusterId = String(intent.cluster_id);

    // Light validation — circuit will catch these too, but error here is friendlier.
    if (BigInt(amount) > BigInt(intentAmountCap)) {
        throw new Error(`amount ${amount} exceeds intent.amount_cap ${intentAmountCap}`);
    }
    if (BigInt(amount) > BigInt(intentMaxPer)) {
        throw new Error(`amount ${amount} exceeds intent.max_per_recipient ${intentMaxPer}`);
    }
    if (BigInt(now) >= BigInt(intentExpiry)) {
        throw new Error(`now ${now} >= intent.expiry ${intentExpiry}`);
    }
    if (BigInt(nonce) < BigInt(minValidNonce)) {
        throw new Error(`nonce ${nonce} < intent.min_valid_nonce ${minValidNonce}`);
    }

    // Merkle tree over the allowlist. Each leaf = Poseidon(recipient_hi, recipient_lo).
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

    // Intent commitment: Poseidon(8) for the bundle, then Poseidon(3) binding
    // cluster_id + min_valid_nonce. vk_id = 0 baked into the inner hash.
    const left = H([
        intentRecipientsRoot, intentAmountCap, intentMaxPer, intentExpiry,
        intentAsset[0], intentAsset[1], intentSalt, VK_ID,
    ]);
    const intentRootPub = H([left, clusterId, minValidNonce]);

    const wallet_pda = params.wallet_pda.map(String);
    const recipient_token_account = params.recipient_token_account.map(String);

    const input = {
        intent_root_pub: intentRootPub,
        recipient,
        amount,
        now,
        nonce,
        min_valid_nonce: minValidNonce,
        cluster_id: clusterId,
        intent_recipients_root: intentRecipientsRoot,
        intent_amount_cap: intentAmountCap,
        intent_max_per_recipient: intentMaxPer,
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
        },
    };
}
