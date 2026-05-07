// HTTP clients for the witness and prover services.
//
// witness: takes the high-level intent + claim, returns a wtns_path (file on
// the local filesystem — assumes same machine as this api route).
// prover:  takes the wtns bytes (base64), returns proof + public_signals.

import { readFile } from 'node:fs/promises';

const WITNESS_URL = process.env.WITNESS_URL || 'http://127.0.0.1:7001';
const PROVER_URL = process.env.PROVER_URL || 'http://127.0.0.1:9090';

export type WitnessRequest = {
    recipient_b58: string;
    amount: string;
    now?: number;
    intent: {
        amount_cap: string;
        max_per_recipient: string;
        window_start: string;
        expiry: string;
        asset: [string, string];
        salt: string;
        allowlist: string[];
    };
    claim: {
        subject: string;
        object: string;
        timestamp?: number;
    };
    attestor_priv_hex: string;
    wallet_pda: [string, string];
    recipient_token_account: [string, string];
};

export type WitnessResponse = {
    wtns_path: string;
    input_path: string;
    public_inputs: Record<string, unknown>;
    timing_ms: { build_input: number; witness_gen: number; total: number };
};

export async function buildWitness(body: WitnessRequest): Promise<WitnessResponse> {
    const r = await fetch(`${WITNESS_URL}/bounty`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`witness service ${r.status}: ${await r.text()}`);
    return (await r.json()) as WitnessResponse;
}

export type ProveResponse = {
    proof: unknown;
    public_signals: string[];
    timing_ms: { parse: number; az_bz: number; proof: number; wall: number };
};

export async function generateProof(wtns_path: string): Promise<ProveResponse> {
    const wtnsBytes = await readFile(wtns_path);
    const witness_b64 = wtnsBytes.toString('base64');
    const r = await fetch(`${PROVER_URL}/bounty`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ witness_b64 }),
    });
    if (!r.ok) throw new Error(`prover service ${r.status}: ${await r.text()}`);
    return (await r.json()) as ProveResponse;
}
