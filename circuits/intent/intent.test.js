// node --test ./circuits/intent/intent.test.js
//
// Circuit-level tests via circom_tester (WASM witness gen + constraint check).
// These exercise *cryptographic* invariants the JS builder can't catch:
// the circuit must reject tampered intent commitments, broken Merkle paths,
// etc. Builder-level validation (amount caps, allowlist membership) lives in
// witness/intent/builder.test.js.

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { wasm } from 'circom_tester';
import { buildPoseidon, buildEddsa, buildBabyjub } from 'circomlibjs';

import { buildInput } from '../../witness/intent/builder.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CIRCUITS_DIR = path.dirname(HERE);
const NODE_MODULES = path.join(CIRCUITS_DIR, 'node_modules');

const RECIPIENT = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const OTHER     = '5T2VVxXk4P6dpqkR7K9HfJYqnRpWLHkD8RbT3wKjPnXY';

const VALID_PARAMS = () => ({
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

let circuit, DEPS;

before(async () => {
    circuit = await wasm(path.join(HERE, 'intent.circom'), {
        include: [NODE_MODULES],
    });
    const poseidon = await buildPoseidon();
    const eddsa = await buildEddsa();
    const babyjub = await buildBabyjub();
    const F = poseidon.F;
    const H = (xs) => F.toString(poseidon(xs));
    DEPS = { poseidon, F, H, eddsa, babyjub };
});

describe('intent circuit', () => {
    test('happy path: valid input satisfies constraints', async () => {
        const { input } = buildInput(VALID_PARAMS(), DEPS);
        const witness = await circuit.calculateWitness(input);
        await circuit.checkConstraints(witness);
    });

    test('tampering intent_root_pub fails the commitment check', async () => {
        const { input } = buildInput(VALID_PARAMS(), DEPS);
        // Flip a single hex digit on the public input — circuit's
        // `intent_root_pub === intent_hash.out` constraint must reject.
        input.intent_root_pub = String(BigInt(input.intent_root_pub) + 1n);
        await assert.rejects(circuit.calculateWitness(input));
    });

    test('tampering a Merkle sibling fails the root match', async () => {
        const { input } = buildInput(VALID_PARAMS(), DEPS);
        input.merkle_path[0] = '1';   // bogus sibling
        await assert.rejects(circuit.calculateWitness(input));
    });

    test('tampering recipients_root (without re-deriving the commitment) fails', async () => {
        const { input } = buildInput(VALID_PARAMS(), DEPS);
        input.intent_recipients_root = '0';
        await assert.rejects(circuit.calculateWitness(input));
    });

    test('amount > cap fails (bypassing builder validation)', async () => {
        // Build a valid witness, then increase amount past the cap before
        // handing it to the circuit. The circuit's LessEqThan must catch it.
        const params = VALID_PARAMS();
        const { input } = buildInput(params, DEPS);
        input.amount = '999999999999';
        await assert.rejects(circuit.calculateWitness(input));
    });

    test('expired intent (now ≥ expiry) fails', async () => {
        const params = VALID_PARAMS();
        const { input } = buildInput(params, DEPS);
        input.now = String(Number(input.intent_expiry) + 1);
        await assert.rejects(circuit.calculateWitness(input));
    });

    test('nonce below min_valid_nonce fails', async () => {
        const { input } = buildInput(VALID_PARAMS(), DEPS);
        input.min_valid_nonce = '999';   // higher than nonce=1
        await assert.rejects(circuit.calculateWitness(input));
    });
});
