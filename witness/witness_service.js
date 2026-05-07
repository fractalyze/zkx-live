// HTTP service: build input fixture (Poseidon/Merkle/EdDSA) + spawn the C++
// witness generator that circom emits with --c. Single combined endpoint per
// circuit so the Python orchestrator only sees one HTTP roundtrip per witness.
//
// Endpoints:
//   GET  /health                        → {ok: true}
//   POST /witness/pay_intent
//   POST /witness/star_bounty
//
// Body shapes are defined by each builder — see pay_intent.mjs / star_bounty.mjs
// JSDoc. Both take a signed `intent` bundle (with `allowlist`), per-request
// fields (recipient_b58, amount, ...), and Solana account refs (wallet_pda,
// recipient_token_account). star_bounty additionally takes a `claim` and
// `attestor_priv_hex`.
//
// Response:
//   {wtns_path, input_path, public_inputs, timing_ms: {build_input, witness_gen, total}}
//
// Env:
//   WITNESS_PORT     (default 7001)
//   CIRCUITS_DIR     (default ../circuits, resolved relative to this file)
//   WITNESS_WORK_DIR (default /tmp/zkx-snap)

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { buildPoseidon, buildEddsa, buildBabyjub } from 'circomlibjs';

import { buildInput as buildPayIntent } from './pay_intent.js';
import { buildInput as buildStarBounty } from './star_bounty.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.WITNESS_PORT ?? 7001);
const CIRCUITS_DIR = resolve(process.env.CIRCUITS_DIR ?? join(HERE, '..', 'circuits'));
const WORK_DIR = process.env.WITNESS_WORK_DIR ?? '/tmp/zkx-snap';

const BIN = {
    pay_intent:  join(CIRCUITS_DIR, 'build', 'pay_intent_cpp', 'pay_intent'),
    star_bounty: join(CIRCUITS_DIR, 'build', 'star_bounty_cpp', 'star_bounty'),
};

console.log('[witness] init circomlibjs ...');
const t0 = Date.now();
const poseidon = await buildPoseidon();
const eddsa = await buildEddsa();
const babyjub = await buildBabyjub();
console.log(`[witness] circomlibjs ready (${Date.now() - t0} ms)`);

const F = poseidon.F;
const H = (xs) => F.toString(poseidon(xs));
const DEPS = { poseidon, F, H, eddsa, babyjub };

await mkdir(WORK_DIR, { recursive: true });

const BUILDERS = {
    pay_intent:  buildPayIntent,
    star_bounty: buildStarBounty,
};

function runWitnessGen(circuit, inputPath, wtnsPath) {
    return new Promise((res, rej) => {
        const bin = BIN[circuit];
        if (!existsSync(bin)) {
            rej(new Error(`witness binary missing: ${bin} — run circom --c and make first`));
            return;
        }
        const proc = spawn(bin, [inputPath, wtnsPath]);
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d; });
        proc.on('error', rej);
        proc.on('close', (code) => {
            if (code === 0) res();
            else rej(new Error(`${circuit} witness gen exit ${code}: ${stderr}`));
        });
    });
}

async function handleWitness(circuit, body) {
    const builder = BUILDERS[circuit];
    if (!builder) throw new Error(`unknown circuit: ${circuit}`);

    const id = randomUUID();
    const inputPath = join(WORK_DIR, `${circuit}_${id}.input.json`);
    const wtnsPath = join(WORK_DIR, `${circuit}_${id}.wtns`);

    const tBuild0 = Date.now();
    const { input, public_inputs } = builder(body, DEPS);
    await writeFile(inputPath, JSON.stringify(input));
    const tBuild = Date.now() - tBuild0;

    const tWit0 = Date.now();
    await runWitnessGen(circuit, inputPath, wtnsPath);
    const tWit = Date.now() - tWit0;

    return {
        wtns_path: wtnsPath,
        input_path: inputPath,
        public_inputs,
        timing_ms: { build_input: tBuild, witness_gen: tWit, total: tBuild + tWit },
    };
}

function readJsonBody(req) {
    return new Promise((res, rej) => {
        let buf = '';
        req.on('data', (c) => { buf += c; });
        req.on('end', () => {
            try { res(buf ? JSON.parse(buf) : {}); }
            catch (e) { rej(new Error('invalid JSON body')); }
        });
        req.on('error', rej);
    });
}

function send(res, status, body) {
    const b = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(b),
    });
    res.end(b);
}

const server = createServer(async (req, res) => {
    try {
        if (req.method === 'GET' && req.url === '/health') {
            send(res, 200, { ok: true });
            return;
        }
        const m = req.method === 'POST' && req.url?.match(/^\/witness\/([a-z_]+)$/);
        if (m) {
            const body = await readJsonBody(req);
            const out = await handleWitness(m[1], body);
            console.log(`[witness] /${m[1]} build=${out.timing_ms.build_input}ms witness=${out.timing_ms.witness_gen}ms`);
            send(res, 200, out);
            return;
        }
        send(res, 404, { error: 'not found' });
    } catch (e) {
        console.error(`[witness] error: ${e.stack ?? e.message}`);
        send(res, 500, { error: e.message });
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[witness] ready  http://127.0.0.1:${PORT}`);
    console.log(`           CIRCUITS_DIR = ${CIRCUITS_DIR}`);
    console.log(`           WORK_DIR     = ${WORK_DIR}`);
});
