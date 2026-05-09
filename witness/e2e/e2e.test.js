// node --test ./witness/e2e/e2e.test.js
//
// End-to-end test: spawns the witness service, hits /health, /circuits, and the
// per-circuit POST /<circuit> endpoints. Asserts response shape + that a real
// .wtns file gets produced. Runs the full pipeline (Express → builder → C++
// witness gen).
//
// A circuit's test is skipped if its C++ binary hasn't been built yet — the
// service can't synthesize a witness without it. Build with:
//   cd circuits && circom <circuit>/<circuit>.circom --r1cs --c -l node_modules \
//     -o build/ && ( cd build/<circuit>_cpp && make )

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const WITNESS_DIR = resolve(HERE, '..');
const CIRCUITS_DIR = resolve(WITNESS_DIR, '..', 'circuits');

const PORT = 17_001;          // distinct from prod 7001 to avoid clashes
const BASE = `http://127.0.0.1:${PORT}`;
const WORK = '/tmp/zkx-live-e2e';

const RECIPIENT = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const OTHER     = '5T2VVxXk4P6dpqkR7K9HfJYqnRpWLHkD8RbT3wKjPnXY';

const INTENT_BODY = {
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
};

const BOUNTY_BODY = {
    recipient_b58: RECIPIENT,
    amount: '5000000',
    now: 1778044189,
    intent: {
        amount_cap: '100000000',
        max_per_recipient: '10000000',
        window_start: '1',
        expiry: '1778648989',
        asset: INTENT_BODY.intent.asset,
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
};

function binBuilt(circuit) {
    return existsSync(join(CIRCUITS_DIR, 'build', `${circuit}_cpp`, circuit));
}

let server;

before(async () => {
    server = spawn('node', ['app.js'], {
        cwd: WITNESS_DIR,
        env: {
            ...process.env,
            WITNESS_PORT: String(PORT),
            WITNESS_WORK_DIR: WORK,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Wait for the "ready" log line, with a hard timeout.
    await new Promise((res, rej) => {
        const timeout = setTimeout(() => rej(new Error('server did not become ready in 10s')), 10_000);
        server.stdout.on('data', (d) => {
            if (d.toString().includes('[witness] ready')) {
                clearTimeout(timeout);
                res();
            }
        });
        server.on('exit', (code) => {
            clearTimeout(timeout);
            rej(new Error(`server exited early with code ${code}`));
        });
    });
});

after(() => {
    if (server && !server.killed) server.kill('SIGTERM');
});

async function post(path, body) {
    const r = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
}

describe('GET /health', () => {
    test('returns ok', async () => {
        const r = await fetch(`${BASE}/health`);
        assert.equal(r.status, 200);
        const body = await r.json();
        assert.deepEqual(body, { ok: true });
    });
});

describe('GET /circuits', () => {
    test('lists registered circuits', async () => {
        const r = await fetch(`${BASE}/circuits`);
        assert.equal(r.status, 200);
        const body = await r.json();
        assert.deepEqual([...body.circuits].sort(), ['bounty', 'intent']);
    });
});

describe('POST /intent', { skip: !binBuilt('intent') && 'intent C++ binary not built' }, () => {
    test('returns wtns_path + public_inputs + timing', async () => {
        const { status, body } = await post('/intent', INTENT_BODY);
        assert.equal(status, 200);

        assert.ok(body.wtns_path?.endsWith('.wtns'), `bad wtns_path: ${body.wtns_path}`);
        assert.ok(existsSync(body.wtns_path), 'wtns file should exist on disk');
        assert.ok(statSync(body.wtns_path).size > 1024, 'wtns file should be non-trivial');

        assert.equal(body.public_inputs.amount, '5000000');
        assert.equal(body.public_inputs.now, '1778044189');
        // Stable hash for the fixed test fixture.
        assert.equal(
            body.public_inputs.intent_root_pub,
            '17927509081158779445313010978330844710362385710766564512446711422547791512067',
        );

        assert.ok(typeof body.timing_ms.build_input === 'number');
        assert.ok(typeof body.timing_ms.witness_gen === 'number');

        unlinkSync(body.wtns_path);
        unlinkSync(body.input_path);
    });

    test('returns 500 with friendly error for missing nonce', async () => {
        const bad = { ...INTENT_BODY };
        delete bad.nonce;
        const { status, body } = await post('/intent', bad);
        assert.equal(status, 500);
        assert.match(body.error, /missing nonce/);
    });
});

describe('POST /bounty', { skip: !binBuilt('bounty') && 'bounty C++ binary not built' }, () => {
    test('returns wtns_path + public_inputs with attestor pubkey', async () => {
        const { status, body } = await post('/bounty', BOUNTY_BODY);
        assert.equal(status, 200);

        assert.ok(body.wtns_path?.endsWith('.wtns'));
        assert.ok(existsSync(body.wtns_path));
        assert.equal(body.public_inputs.amount, '5000000');
        assert.ok(body.public_inputs.attestor_Ax);
        assert.ok(body.public_inputs.attestor_Ay);

        unlinkSync(body.wtns_path);
        unlinkSync(body.input_path);
    });
});

describe('unknown endpoints', () => {
    test('GET /nope is 404', async () => {
        const r = await fetch(`${BASE}/nope`);
        assert.equal(r.status, 404);
    });
});
