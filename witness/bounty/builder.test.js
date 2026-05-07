// node --test ./witness/bounty/builder.test.js
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';

import { buildPoseidon, buildEddsa, buildBabyjub } from 'circomlibjs';

import { buildInput } from './builder.js';

const RECIPIENT = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const OTHER     = '5T2VVxXk4P6dpqkR7K9HfJYqnRpWLHkD8RbT3wKjPnXY';
const ATTESTOR_PRIV = '11'.repeat(32);

const VALID = () => ({
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
    attestor_priv_hex: ATTESTOR_PRIV,
    wallet_pda: ['11111111111111111111', '22222222222222222222'],
    recipient_token_account: ['33333333333333333333', '44444444444444444444'],
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

describe('bounty builder — happy path', () => {
    test('produces input with attestor pubkey + signature', () => {
        const out = buildInput(VALID(), DEPS);
        assert.equal(typeof out.input.attestor_Ax, 'string');
        assert.equal(typeof out.input.attestor_Ay, 'string');
        assert.equal(typeof out.input.sig_R8x, 'string');
        assert.equal(typeof out.input.sig_R8y, 'string');
        assert.equal(typeof out.input.sig_S, 'string');
        assert.equal(out.public_inputs.attestor_Ax, out.input.attestor_Ax);
        assert.equal(out.public_inputs.attestor_Ay, out.input.attestor_Ay);
    });

    test('claim subject + object_hash flow into the input verbatim', () => {
        const out = buildInput(VALID(), DEPS);
        assert.equal(out.input.claim_subject, '583231');
        assert.equal(typeof out.input.claim_object, 'string');
        // claim_object is a Poseidon-hashed field, not the original string.
        assert.notEqual(out.input.claim_object, 'octocat/Hello-World');
    });

    test('object vs object_hash produce the same field when consistent', () => {
        const a = buildInput(VALID(), DEPS).input.claim_object;
        const params = VALID();
        const preHashed = a;
        delete params.claim.object;
        params.claim.object_hash = preHashed;
        const b = buildInput(params, DEPS).input.claim_object;
        assert.equal(a, b);
    });
});

describe('bounty builder — validation', () => {
    test('rejects missing claim.subject', () => {
        const params = VALID();
        delete params.claim.subject;
        assert.throws(() => buildInput(params, DEPS), /missing subject/);
    });

    test('rejects missing both claim.object and claim.object_hash', () => {
        const params = VALID();
        delete params.claim.object;
        assert.throws(() => buildInput(params, DEPS), /missing object/);
    });

    test('rejects bad attestor_priv_hex length', () => {
        const params = VALID();
        params.attestor_priv_hex = '00';
        assert.throws(() => buildInput(params, DEPS), /must decode to 32 bytes/);
    });

    test('rejects `now` outside [window_start, expiry)', () => {
        const params = VALID();
        params.now = String(Number(params.intent.expiry) + 1);
        assert.throws(() => buildInput(params, DEPS), /not in \[window_start/);
    });

    test('rejects recipient not in allowlist', () => {
        const params = VALID();
        params.intent.allowlist = [OTHER];
        assert.throws(() => buildInput(params, DEPS), /not in allowlist/);
    });
});
