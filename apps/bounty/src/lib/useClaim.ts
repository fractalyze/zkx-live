// React hook that drives a /api/claim request and surfaces the SSE stream as
// component state. EventSource is GET-only, so we use fetch + a stream reader
// to consume the SSE response body.

import { useCallback, useRef, useState } from 'react';
import {
    ClaimResult,
    StepKey,
    StepStatus,
} from '@/components/ClaimModal';

const initialSteps: Record<StepKey, StepStatus> = {
    star:    { state: 'pending' },
    witness: { state: 'pending' },
    prove:   { state: 'pending' },
    submit:  { state: 'pending' },
};

export type ClaimState = {
    open: boolean;
    steps: Record<StepKey, StepStatus>;
    result?: ClaimResult;
    error?: string;
};

export function useClaim() {
    const [state, setState] = useState<ClaimState>({
        open: false,
        steps: initialSteps,
    });
    const abortRef = useRef<AbortController | null>(null);

    const close = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setState({ open: false, steps: initialSteps });
    }, []);

    const start = useCallback(async (input: { recipient: string }) => {
        // Reset + open modal.
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        setState({
            open: true,
            steps: { ...initialSteps, star: { state: 'running' } },
        });

        let response: Response;
        try {
            response = await fetch('/api/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
                signal: ctrl.signal,
            });
        } catch (e: unknown) {
            if ((e as { name?: string })?.name === 'AbortError') return;
            setState((s) => ({ ...s, error: String((e as Error)?.message ?? e) }));
            return;
        }

        if (!response.ok || !response.body) {
            // 4xx pre-stream errors come back as JSON {error}.
            let msg = `claim API ${response.status}`;
            try {
                const body = (await response.json()) as { error?: string };
                if (body.error) msg = body.error;
            } catch {
                /* not JSON, keep the generic message */
            }
            setState((s) => ({ ...s, error: msg }));
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let sep;
                while ((sep = buffer.indexOf('\n\n')) >= 0) {
                    const block = buffer.slice(0, sep);
                    buffer = buffer.slice(sep + 2);
                    const evt = parseSseBlock(block);
                    if (evt) handleEvent(evt, setState);
                }
            }
        } catch (e: unknown) {
            if ((e as { name?: string })?.name !== 'AbortError') {
                setState((s) => ({ ...s, error: String((e as Error)?.message ?? e) }));
            }
        }
    }, []);

    return { state, start, close };
}

type ParsedSseEvent = { event: string; data: unknown };

function parseSseBlock(block: string): ParsedSseEvent | null {
    let event = 'message';
    let dataLine = '';
    for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
    }
    if (!dataLine) return null;
    try {
        return { event, data: JSON.parse(dataLine) };
    } catch {
        return null;
    }
}

function handleEvent(
    evt: ParsedSseEvent,
    setState: React.Dispatch<React.SetStateAction<ClaimState>>,
): void {
    switch (evt.event) {
        case 'step': {
            const { key, state, timing_ms } = evt.data as {
                key: StepKey;
                state: 'running' | 'done' | 'error';
                timing_ms?: number;
            };
            setState((s) => ({
                ...s,
                steps: { ...s.steps, [key]: { state, timing_ms } },
            }));
            break;
        }
        case 'done': {
            setState((s) => ({ ...s, result: evt.data as ClaimResult }));
            break;
        }
        case 'error': {
            const { message } = evt.data as { message: string };
            setState((s) => ({ ...s, error: message }));
            break;
        }
    }
}
