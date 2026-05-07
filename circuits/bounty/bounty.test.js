// node --test ./circuits/bounty/bounty.test.js
//
// Same idea as intent/intent.test.js — exercise the cryptographic invariants
// the JS builder can't catch. Bounty adds the EdDSA-attestor layer, so the
// extra sensitive points are signature tampering and claim/sig de-binding.

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { wasm } from 'circom_tester';
import { buildPoseidon, buildEddsa, buildBabyjub } from 'circomlibjs';

import { buildInput } from '../../witness/bounty/builder.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CIRCUITS_DIR = path.dirname(HERE);
const NODE_MODULES = path.join(CIRCUITS_DIR, 'node_modules');

const RECIPIENT = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const OTHER     = '5T2VVxXk4P6dpqkR7K9HfJYqnRpWLHkD8RbT3wKjPnXY';

const VALID_PARAMS = () => ({
    recipient_b58: RECIPIENT,
    amount: '5000000',
    now: 1778044189,
    intent: {
        amount_cap: '100000000',
        max_per_recipient: '10000000',
        window_start: '1',
        expiry: '1778648989',
        asset: ['24197857200151252728969465429440056815',
                '338769989521388930494245921488005055265'],
        salt: '16045690984503098046',
        allowlist: [RECIPIENT, OTHER],
    },
    claim: {
        subject: '583231',
        object: 'octocat/Hello-World',
        timestamp: 1778044100,
    },
    attestor_priv_hex: '11'.repeat(32),
    wallet_pda: ['11111111111111111111', '22222222222222222222'],
    recipient_token_account: ['33333333333333333333', '44444444444444444444'],
});

let circuit, DEPS;

before(async () => {
    circuit = await wasm(path.join(HERE, 'bounty.circom'), {
        include: [NODE_MODULES],
    });
    const poseidon = await buildPoseidon();
    const eddsa = await buildEddsa();
    const babyjub = await buildBabyjub();
    const F = poseidon.F;
    const H = (xs) => F.toString(poseidon(xs));
    DEPS = { poseidon, F, H, eddsa, babyjub };
});

describe('bounty circuit', () => {
    test('happy path: valid input satisfies constraints', async () => {
        const { input } = buildInput(VALID_PARAMS(), DEPS);
        const witness = await circuit.calculateWitness(input);
        await circuit.checkConstraints(witness);
    });

    test('tampering sig_S fails EdDSA verify', async () => {
        const { input } = buildInput(VALID_PARAMS(), DEPS);
        input.sig_S = String(BigInt(input.sig_S) + 1n);
        await assert.rejects(circuit.calculateWitness(input));
    });

    test('tampering sig_R8x fails EdDSA verify', async () => {
        const { input } = buildInput(VALID_PARAMS(), DEPS);
        input.sig_R8x = '0';
        await assert.rejects(circuit.calculateWitness(input));
    });

    test('tampering claim_subject without re-signing fails', async () => {
        // The signature was over (subject, object, timestamp) computed by the
        // builder. Changing the subject here without re-signing breaks EdDSA.
        const { input } = buildInput(VALID_PARAMS(), DEPS);
        input.claim_subject = '999';
        await assert.rejects(circuit.calculateWitness(input));
    });

    test('tampering claim_object without re-signing fails', async () => {
        const { input } = buildInput(VALID_PARAMS(), DEPS);
        input.claim_object = '0';
        await assert.rejects(circuit.calculateWitness(input));
    });

    test('tampering attestor pubkey fails — sig was for original key', async () => {
        const { input } = buildInput(VALID_PARAMS(), DEPS);
        input.attestor_Ax = '0';
        await assert.rejects(circuit.calculateWitness(input));
    });

    test('tampering intent_root_pub fails commitment check', async () => {
        const { input } = buildInput(VALID_PARAMS(), DEPS);
        input.intent_root_pub = String(BigInt(input.intent_root_pub) + 1n);
        await assert.rejects(circuit.calculateWitness(input));
    });

    test('now ≥ expiry fails', async () => {
        const { input } = buildInput(VALID_PARAMS(), DEPS);
        input.now = String(Number(input.intent_expiry) + 1);
        await assert.rejects(circuit.calculateWitness(input));
    });

    test('now < window_start fails', async () => {
        const { input } = buildInput(VALID_PARAMS(), DEPS);
        input.intent_window_start = String(Number(input.now) + 100);
        await assert.rejects(circuit.calculateWitness(input));
    });
});
