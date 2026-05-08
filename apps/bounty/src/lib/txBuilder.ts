// Tiny client for the local Python tx_builder service. The Python side
// reuses apps/lib.py to encode + stage + execute a gateway-routed tx (see
// scripts/tx_builder.py); this just hands it the proof + public_signals
// the prover already produced and gets back a confirmed devnet tx_sig.

const TX_BUILDER_URL = process.env.TX_BUILDER_URL || 'http://127.0.0.1:7100';

export type SubmitResponse = {
    tx_sig: string;
    explorer_url: string;
    stage_ms: number;
    execute_ms: number;
};

export async function submitClaimTx(args: {
    recipient_b58: string;
    proof: unknown;
    public_signals: string[];
}): Promise<SubmitResponse> {
    const r = await fetch(`${TX_BUILDER_URL}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
    });
    if (!r.ok) {
        const text = await r.text();
        throw new Error(`tx_builder ${r.status}: ${text}`);
    }
    return (await r.json()) as SubmitResponse;
}
