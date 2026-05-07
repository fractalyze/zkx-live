// Shared helpers for witness fixture builders.

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function b58decode(s) {
    let n = 0n;
    for (const c of s) {
        const i = B58.indexOf(c);
        if (i < 0) throw new Error(`bad base58 char: ${c}`);
        n = n * 58n + BigInt(i);
    }
    let hex = n.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    let bytes = Buffer.from(hex, 'hex');
    let pad = 0;
    for (const c of s) { if (c === '1') pad++; else break; }
    return Buffer.concat([Buffer.alloc(pad), bytes]);
}

// Solana 32-byte pubkey → [hi16, lo16] as decimal strings (matches circuit's
// 16-byte big-endian halves convention).
export function pubkeyToFields(b58) {
    const b = b58decode(b58);
    if (b.length !== 32) throw new Error(`pubkey must be 32 bytes, got ${b.length}`);
    const hi = BigInt('0x' + b.slice(0, 16).toString('hex')).toString();
    const lo = BigInt('0x' + b.slice(16, 32).toString('hex')).toString();
    return [hi, lo];
}

// Build a Poseidon Merkle tree of fixed depth from a list of leaves.
// Pads empty slots with '0'. Returns the level arrays so callers can extract
// (root, path, indices) for any leaf index.
export function buildPaddedMerkle(leaves, depth, H) {
    const N = 1 << depth;
    if (leaves.length > N) {
        throw new Error(`allowlist size ${leaves.length} exceeds capacity ${N} (depth=${depth})`);
    }
    const padded = [...leaves];
    while (padded.length < N) padded.push('0');

    const levels = [padded];
    for (let d = 0; d < depth; d++) {
        const prev = levels[d];
        const next = [];
        for (let i = 0; i < prev.length; i += 2) {
            next.push(H([prev[i], prev[i + 1]]));
        }
        levels.push(next);
    }
    return levels;  // levels[0] = padded leaves, levels[depth] = [root]
}

// For a given leaf index, return the (path, indices) suitable for MerkleVerify.
// indices[i] == 0  → cur is left, sibling is right
// indices[i] == 1  → sibling is left, cur is right
export function merkleProof(levels, leafIndex, depth) {
    const path = [];
    const indices = [];
    let idx = leafIndex;
    for (let d = 0; d < depth; d++) {
        path.push(levels[d][idx ^ 1]);
        indices.push(idx & 1);
        idx >>= 1;
    }
    return { path, indices };
}
