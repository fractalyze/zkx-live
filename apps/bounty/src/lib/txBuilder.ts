// Tiny client for the local Python tx_builder service. The Python side
// reuses apps/lib.py to encode + execute a gateway-routed tx (see
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
        // tx_builder returns structured JSON for both onchain_error
        // (e.g. NullifierUsed) and server_error (Python traceback) paths.
        // Pull the human message out so the modal shows one clean line
        // instead of a stack.
        let body: {
            kind?: string;
            error_name?: string;
            message?: string;
            error?: string;
        } | null = null;
        try {
            body = await r.json();
        } catch {
            /* non-JSON body — fall through to status-only message */
        }
        if (body?.kind === 'onchain_error' && body.message) {
            throw new Error(body.message);
        }
        if (body?.error) {
            // Server error path returns the full Python traceback in
            // `error`. Show only the last line so the modal stays readable.
            const last = body.error.trim().split('\n').pop() || body.error;
            throw new Error(last);
        }
        throw new Error(`tx_builder ${r.status}`);
    }
    return (await r.json()) as SubmitResponse;
}
