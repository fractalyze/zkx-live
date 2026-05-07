// node --test ./witness/lib/util.test.js
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';

import { buildPoseidon } from 'circomlibjs';

import {
    b58decode, pubkeyToFields, buildPaddedMerkle, merkleProof,
} from './util.js';

let H;

before(async () => {
    const poseidon = await buildPoseidon();
    H = (xs) => poseidon.F.toString(poseidon(xs));
});

const PUBKEY_B58 = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const PUBKEY_HI  = '168209822014115559183616271165824211842';
const PUBKEY_LO  = '88966491075157172564320846656771393266';

describe('b58decode', () => {
    test('decodes a 32-byte Solana pubkey', () => {
        const b = b58decode(PUBKEY_B58);
        assert.equal(b.length, 32);
    });

    test('throws on invalid base58 char', () => {
        assert.throws(() => b58decode('0OIl'), /bad base58 char/);
    });
});

describe('pubkeyToFields', () => {
    test('splits a known pubkey into expected hi/lo halves', () => {
        const [hi, lo] = pubkeyToFields(PUBKEY_B58);
        assert.equal(hi, PUBKEY_HI);
        assert.equal(lo, PUBKEY_LO);
    });

    test('rejects non-32-byte payloads', () => {
        // 'abc' decodes to 2 bytes, not 32
        assert.throws(() => pubkeyToFields('abc'), /must be 32 bytes/);
    });
});

describe('Merkle build + proof', () => {
    test('depth-8 build produces single root', () => {
        const leaves = ['1', '2', '3'];
        const levels = buildPaddedMerkle(leaves, 8, H);
        assert.equal(levels.length, 9);          // depth + 1
        assert.equal(levels[0].length, 256);     // 2^8 padded leaves
        assert.equal(levels[8].length, 1);       // root
    });

    test('proof for each leaf recomputes to root', () => {
        const leaves = ['10', '20', '30', '40', '50'];
        const depth = 8;
        const levels = buildPaddedMerkle(leaves, depth, H);
        const root = levels[depth][0];

        for (let i = 0; i < leaves.length; i++) {
            const { path, indices } = merkleProof(levels, i, depth);
            // Recompute root from leaf + path
            let cur = leaves[i];
            for (let d = 0; d < depth; d++) {
                cur = indices[d] === 0
                    ? H([cur, path[d]])
                    : H([path[d], cur]);
            }
            assert.equal(cur, root, `proof for leaf index ${i} did not recompute root`);
        }
    });

    test('rejects allowlist exceeding capacity', () => {
        const tooMany = new Array(257).fill('1');
        assert.throws(() => buildPaddedMerkle(tooMany, 8, H), /exceeds capacity/);
    });
});
