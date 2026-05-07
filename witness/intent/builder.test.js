// node --test ./witness/intent/builder.test.js
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';

import { buildPoseidon, buildEddsa, buildBabyjub } from 'circomlibjs';

import { buildInput } from './builder.js';

const RECIPIENT = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const OTHER     = '5T2VVxXk4P6dpqkR7K9HfJYqnRpWLHkD8RbT3wKjPnXY';

const VALID = () => ({
    recipient_b58: RECIPIENT,
    amount: '5000000',
    nonce: 1,
    now: 1778044189,
    intent: {
        amount_cap: '100000000',
        max_per_recipient: '10000000',
        expiry: '1778648989',
        asset: ['24197857200151252728969465429440056815',
                '338769989521388930494245921488005055265'],
        salt: '16045690984503098046',
        min_valid_nonce: '0',
        cluster_id: '1',
        allowlist: [RECIPIENT, OTHER],
    },
    wallet_pda: ['22685491128062564230891640495451214097',
                 '45370982256125128461783280990902428194'],
    recipient_token_account: ['68056473384187692692674921486353642291',
                              '90741964512250256923566561981804856388'],
});

let DEPS;

before(async () => {
    const poseidon = await buildPoseidon();
    const eddsa = await buildEddsa();
    const babyjub = await buildBabyjub();
    const F = poseidon.F;
    const H = (xs) => F.toString(poseidon(xs));
    DEPS = { poseidon, F, H, eddsa, babyjub };
});

describe('intent builder — happy path', () => {
    test('produces full input + public_inputs with stable intent_root_pub', () => {
        const out = buildInput(VALID(), DEPS);
        assert.equal(typeof out.input.intent_root_pub, 'string');
        assert.equal(out.public_inputs.intent_root_pub, out.input.intent_root_pub);
        assert.equal(out.public_inputs.recipient.length, 2);
        assert.equal(out.public_inputs.amount, '5000000');
        assert.equal(out.public_inputs.now, '1778044189');

        // Stable hash for known fixed inputs (parity with the live service test).
        assert.equal(
            out.public_inputs.intent_root_pub,
            '17927509081158779445313010978330844710362385710766564512446711422547791512067',
        );
    });

    test('Merkle path has length matching circuit depth (8)', () => {
        const out = buildInput(VALID(), DEPS);
        assert.equal(out.input.merkle_path.length, 8);
        assert.equal(out.input.merkle_path_indices.length, 8);
    });

    test('default `now` falls back to floor(Date.now()/1000) when omitted', () => {
        const params = VALID();
        delete params.now;
        params.intent.expiry = String(Math.floor(Date.now() / 1000) + 3600);
        const out = buildInput(params, DEPS);
        const now = Number(out.input.now);
        assert.ok(Math.abs(now - Math.floor(Date.now() / 1000)) < 5);
    });
});

describe('intent builder — validation', () => {
    test('rejects missing nonce', () => {
        const params = VALID();
        delete params.nonce;
        assert.throws(() => buildInput(params, DEPS), /missing nonce/);
    });

    test('rejects missing intent.allowlist', () => {
        const params = VALID();
        delete params.intent.allowlist;
        assert.throws(() => buildInput(params, DEPS), /missing allowlist/);
    });

    test('rejects amount over intent.amount_cap', () => {
        const params = VALID();
        params.amount = '999999999999';
        assert.throws(() => buildInput(params, DEPS), /amount_cap/);
    });

    test('rejects amount over intent.max_per_recipient', () => {
        const params = VALID();
        params.amount = String(Number(params.intent.max_per_recipient) + 1);
        assert.throws(() => buildInput(params, DEPS), /max_per_recipient/);
    });

    test('rejects expired intent', () => {
        const params = VALID();
        params.now = String(Number(params.intent.expiry) + 1);
        assert.throws(() => buildInput(params, DEPS), /intent\.expiry/);
    });

    test('rejects nonce below min_valid_nonce', () => {
        const params = VALID();
        params.intent.min_valid_nonce = '100';
        params.nonce = 1;
        assert.throws(() => buildInput(params, DEPS), /min_valid_nonce/);
    });

    test('rejects recipient absent from allowlist', () => {
        const params = VALID();
        params.intent.allowlist = [OTHER];      // RECIPIENT not included
        assert.throws(() => buildInput(params, DEPS), /not in allowlist/);
    });
});
