import { ProgressStep, StepState } from './ProgressStep';

export type StepKey = 'star' | 'witness' | 'prove' | 'submit';

export const STEP_LABELS: Record<StepKey, string> = {
    star:    'Starring repo',
    witness: 'Building witness',
    prove:   'Generating ZK proof',
    submit:  'Submitting on Solana',
};

// Steps the user should perceive as instant. Sub-second steps get the
// accent color treatment in the timing column.
export const FAST_STEPS: ReadonlyArray<StepKey> = ['star', 'witness', 'prove'];

export type StepStatus = {
    state: StepState;
    timing_ms?: number;
};

export type ClaimResult = {
    tx_sig: string;
    explorer_url: string;
    total_ms: number;
    proof_ms: number;
    amount_human: string;
    recipient: string;
};

type Props = {
    open: boolean;
    repo: string;
    onClose: () => void;
    steps: Record<StepKey, StepStatus>;
    result?: ClaimResult;
    error?: string;
};

// One persistent layout: the per-step timings stay visible (the whole point
// of the demo is to show they're each sub-200 ms), and the success / error
// payload appends below — never replaces. Closing the modal is a separate
// explicit action.
export function ClaimModal({
    open,
    repo,
    onClose,
    steps,
    result,
    error,
}: Props) {
    if (!open) return null;

    const settled = result !== undefined || error !== undefined;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-bg p-8 shadow-2xl">
                <div className="text-sm uppercase tracking-widest text-muted">
                    {settled ? 'Bounty claimed' : 'Claiming bounty for'}{' '}
                    <span className="font-mono text-fg/70">{repo}</span>
                </div>

                <div className="mt-6 divide-y divide-white/5">
                    <ProgressStep
                        label={STEP_LABELS.star}
                        state={steps.star.state}
                        timing_ms={steps.star.timing_ms}
                    />
                    <ProgressStep
                        label={STEP_LABELS.witness}
                        state={steps.witness.state}
                        timing_ms={steps.witness.timing_ms}
                    />
                    <ProgressStep
                        label={STEP_LABELS.prove}
                        state={steps.prove.state}
                        timing_ms={steps.prove.timing_ms}
                        emphasize
                    />
                    <ProgressStep
                        label={STEP_LABELS.submit}
                        state={steps.submit.state}
                        timing_ms={steps.submit.timing_ms}
                    />
                </div>

                {result && <SuccessFooter result={result} onClose={onClose} />}
                {error && <ErrorFooter error={error} onClose={onClose} />}
                {!settled && (
                    <button
                        onClick={onClose}
                        className="mt-6 w-full rounded-lg border border-white/10 px-4 py-2 text-sm text-muted hover:text-fg"
                    >
                        Cancel
                    </button>
                )}
            </div>
        </div>
    );
}

function SuccessFooter({ result, onClose }: { result: ClaimResult; onClose: () => void }) {
    return (
        <div className="mt-6 border-t border-white/10 pt-6">
            <div className="text-center text-xl">
                ✅ <span className="font-semibold">Paid!</span>{' '}
                <span className="text-muted text-sm">
                    {result.amount_human} → {short(result.recipient)}
                </span>
            </div>

            <div className="mt-3 flex justify-center gap-6 text-xs tabular-nums">
                <span className="text-muted">
                    Total{' '}
                    <span className="font-semibold text-fg">
                        {(result.total_ms / 1000).toFixed(2)} s
                    </span>
                </span>
                <span className="text-muted">
                    ZK proof{' '}
                    <span className="font-semibold text-accent">{result.proof_ms} ms ⚡</span>
                </span>
            </div>

            <div className="mt-4 flex flex-col gap-2">
                <a
                    href={result.explorer_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full break-all rounded-lg border border-accent px-4 py-2 text-center font-mono text-xs text-accent hover:bg-accent/10"
                    title={result.tx_sig}
                >
                    {result.explorer_url} ↗
                </a>
                <button
                    onClick={onClose}
                    className="rounded-lg px-4 py-2 text-sm text-muted hover:text-fg"
                >
                    Done
                </button>
            </div>
        </div>
    );
}

function ErrorFooter({ error, onClose }: { error: string; onClose: () => void }) {
    // Long stack traces from Python tx_builder land here — keep the modal
    // narrow and let the message wrap, no horizontal scroll.
    return (
        <div className="mt-6 border-t border-white/10 pt-6">
            <div className="text-lg font-semibold">❌ Couldn&apos;t claim</div>
            <div className="mt-2 max-h-48 overflow-y-auto break-words rounded-lg border border-err/30 bg-err/[0.04] p-3 text-xs text-err">
                {error}
            </div>
            <button
                onClick={onClose}
                className="mt-4 w-full rounded-lg border border-white/10 px-4 py-2 text-sm hover:bg-white/5"
            >
                Close
            </button>
        </div>
    );
}

function short(s: string): string {
    return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}
