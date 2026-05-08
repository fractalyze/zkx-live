export type StepState = 'pending' | 'running' | 'done' | 'error';

type Props = {
    label: string;
    state: StepState;
    timing_ms?: number;
    /** Highlight the timing in accent color — for the "wow" step (ZK proof). */
    emphasize?: boolean;
};

export function ProgressStep({ label, state, timing_ms, emphasize = false }: Props) {
    return (
        <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
                <Icon state={state} />
                <span
                    className={
                        state === 'pending'
                            ? 'text-muted'
                            : state === 'error'
                              ? 'text-err'
                              : 'text-fg'
                    }
                >
                    {label}
                </span>
            </div>
            {timing_ms !== undefined && state === 'done' && (
                <Timing ms={timing_ms} emphasize={emphasize} />
            )}
        </div>
    );
}

function Icon({ state }: { state: StepState }) {
    if (state === 'pending') {
        return <span className="block h-3 w-3 rounded-full border border-muted/40" />;
    }
    if (state === 'running') {
        return (
            <span className="block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        );
    }
    if (state === 'error') {
        return <span className="text-err">✗</span>;
    }
    return <span className="text-ok">✓</span>;
}

function Timing({ ms, emphasize }: { ms: number; emphasize: boolean }) {
    const fast = ms < 1000;
    const colorClass = emphasize
        ? 'text-accent font-semibold'
        : fast
          ? 'text-ok'
          : 'text-muted';
    return (
        <span className={`font-mono text-sm tabular-nums ${colorClass}`}>
            {formatMs(ms)}
            {emphasize && fast && ' ⚡'}
        </span>
    );
}

function formatMs(ms: number): string {
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
    return `${ms} ms`;
}
