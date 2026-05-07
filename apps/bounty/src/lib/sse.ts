// SSE-over-POST helpers used by /api/claim. EventSource only does GET, so the
// frontend uses fetch + a stream reader instead (see useClaim hook).

import type { NextApiResponse } from 'next';

export type StepKey = 'star' | 'witness' | 'prove' | 'submit';

export type StepEvent = {
    key: StepKey;
    state: 'running' | 'done' | 'error';
    timing_ms?: number;
};

export type DoneEvent = {
    tx_sig: string;
    explorer_url: string;
    total_ms: number;
    proof_ms: number;
    recipient: string;
    amount_human: string;
};

export type ErrorEvent = { message: string };

export type StarPollingEvent = { last_check_ago_ms: number };

export type ServerEvent =
    | { type: 'step'; data: StepEvent }
    | { type: 'star_polling'; data: StarPollingEvent }
    | { type: 'done'; data: DoneEvent }
    | { type: 'error'; data: ErrorEvent };

export function writeSse(res: NextApiResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Setup Next.js API response for streaming. Disable nagle / proxying.
export function startSseResponse(res: NextApiResponse): void {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',  // disable nginx buffering
    });
    // Flush headers immediately so the client sees the connection open.
    if (typeof (res as any).flushHeaders === 'function') {
        (res as any).flushHeaders();
    }
}
