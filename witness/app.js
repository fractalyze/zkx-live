// HTTP service: build input fixture (Poseidon/Merkle/EdDSA) + spawn the C++
// witness generator that circom emits with --c. One combined endpoint per
// circuit so the orchestrator only sees one HTTP roundtrip per witness.
//
// Endpoints:
//   GET  /health             → {ok: true}
//   GET  /circuits           → {circuits: ["intent", "bounty"]}
//   POST /intent             → witness for the intent circuit
//   POST /bounty             → witness for the bounty circuit
//
// The service host already implies "this is the witness service" — no need
// for a /witness/ prefix on every URL. Adding a circuit means: drop a builder
// in BUILDERS below, the route is registered automatically.
//
// Request bodies are documented in intent/builder.js / bounty/builder.js JSDoc.
//
// Response:
//   {wtns_path, input_path, public_inputs,
//    timing_ms: {build_input, witness_gen, total}}
//
// Env:
//   WITNESS_PORT     (default 7001)
//   CIRCUITS_DIR     (default ../circuits, resolved relative to this file)
//   WITNESS_WORK_DIR (default /tmp/zkx-live)

import express from 'express';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { buildPoseidon, buildEddsa, buildBabyjub } from 'circomlibjs';

import { buildInput as buildIntent } from './intent/builder.js';
import { buildInput as buildBounty } from './bounty/builder.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.WITNESS_PORT ?? 7001);
const CIRCUITS_DIR = resolve(process.env.CIRCUITS_DIR ?? join(HERE, '..', 'circuits'));
const WORK_DIR = process.env.WITNESS_WORK_DIR ?? '/tmp/zkx-live';

const BIN = {
    intent: join(CIRCUITS_DIR, 'build', 'intent_cpp', 'intent'),
    bounty: join(CIRCUITS_DIR, 'build', 'bounty_cpp', 'bounty'),
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
    intent: buildIntent,
    bounty: buildBounty,
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

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/circuits', (_req, res) => res.json({ circuits: Object.keys(BUILDERS) }));

for (const circuit of Object.keys(BUILDERS)) {
    app.post(`/${circuit}`, async (req, res) => {
        try {
            const out = await handleWitness(circuit, req.body);
            console.log(
                `[witness] /${circuit} build=${out.timing_ms.build_input}ms` +
                ` witness=${out.timing_ms.witness_gen}ms`,
            );
            res.json(out);
        } catch (e) {
            console.error(`[witness] error: ${e.stack ?? e.message}`);
            res.status(500).json({ error: e.message });
        }
    });
}

app.use((_req, res) => res.status(404).json({ error: 'not found' }));

// Default 127.0.0.1 so plain `node app.js` on a dev host stays
// loopback-only. Override to 0.0.0.0 in containers (compose sets
// WITNESS_HOST=0.0.0.0) so peers on the network can reach us.
const HOST = process.env.WITNESS_HOST ?? '127.0.0.1';
app.listen(PORT, HOST, () => {
    console.log(`[witness] ready  http://${HOST}:${PORT}`);
    console.log(`           CIRCUITS_DIR = ${CIRCUITS_DIR}`);
    console.log(`           WORK_DIR     = ${WORK_DIR}`);
});
