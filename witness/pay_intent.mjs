// Build witness-ready input for pay_intent.circom.
//
// Pure function — caller passes pre-initialized circomlibjs primitives so the
// HTTP service can amortize the (~1s) buildPoseidon() cost across requests.

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

export function buildInput(params, deps) {
    const { recipient_b58, amount } = params;
    const { H } = deps;

    if (!recipient_b58 || !amount) {
        throw new Error('pay_intent: recipient_b58 and amount required');
    }
    const rb = b58decode(recipient_b58);
    if (rb.length !== 32) throw new Error(`recipient must decode to 32 bytes, got ${rb.length}`);

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

    const amountCap = '100000000';
    const maxPerRecipient = '10000000';
    const expiry = '1778648989';
    const asset = ['24197857200151252728969465429440056815', '338769989521388930494245921488005055265'];
    const salt = '16045690984503098046';
    const minValidNonce = '0';
    const clusterId = '1';

    // Intent commitment: vk_id = 0 baked into Poseidon(8), then bound with cluster + nonce floor.
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

    const walletPda = ['22685491128062564230891640495451214097', '45370982256125128461783280990902428194'];
    const recipientAta = ['68056473384187692692674921486353642291', '90741964512250256923566561981804856388'];
    const now = '1778044189';

    const input = {
        intent_root_pub: intentRootPub,
        recipient: [recipientHi, recipientLo],
        amount: String(amount),
        now,
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

    return {
        input,
        public_inputs: {
            intent_root_pub: intentRootPub,
            recipient: [recipientHi, recipientLo],
            amount: String(amount),
            now,
        },
    };
}
