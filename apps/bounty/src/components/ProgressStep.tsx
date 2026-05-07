export type StepState = 'pending' | 'running' | 'done' | 'error';

type Props = {
    label: string;
    state: StepState;
    timing_ms?: number;
};

export function ProgressStep({ label, state, timing_ms }: Props) {
    return (
        <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
                <Icon state={state} />
                <span
                    className={
                        state === 'pending'
                            ? 'text-muted'
                            : state === 'running'
                              ? 'text-fg'
                              : state === 'error'
                                ? 'text-err'
                                : 'text-fg'
                    }
                >
                    {label}
                </span>
            </div>
            {timing_ms !== undefined && (
                <span className="font-mono text-sm text-muted tabular-nums">
                    {formatMs(timing_ms)}
                </span>
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

function formatMs(ms: number): string {
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
    return `${ms} ms`;
}
