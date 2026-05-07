import { ProgressStep, StepState } from './ProgressStep';

export type StepKey = 'star' | 'witness' | 'prove' | 'submit';

export const STEP_LABELS: Record<StepKey, string> = {
    star:    'Star detected',
    witness: 'Building witness',
    prove:   'Generating ZK proof',
    submit:  'Submitting on Solana',
};

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
    onOpenRepo: () => void;
    waitingForStar: boolean;
    lastPolledAgoSec?: number;
    steps: Record<StepKey, StepStatus>;
    result?: ClaimResult;
    error?: string;
};

export function ClaimModal({
    open,
    repo,
    onClose,
    onOpenRepo,
    waitingForStar,
    lastPolledAgoSec,
    steps,
    result,
    error,
}: Props) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-bg p-8 shadow-2xl">
                {result ? (
                    <SuccessView result={result} onClose={onClose} />
                ) : error ? (
                    <ErrorView error={error} onClose={onClose} />
                ) : (
                    <ProgressView
                        repo={repo}
                        waitingForStar={waitingForStar}
                        lastPolledAgoSec={lastPolledAgoSec}
                        onOpenRepo={onOpenRepo}
                        steps={steps}
                        onClose={onClose}
                    />
                )}
            </div>
        </div>
    );
}

function ProgressView({
    repo,
    waitingForStar,
    lastPolledAgoSec,
    onOpenRepo,
    steps,
    onClose,
}: {
    repo: string;
    waitingForStar: boolean;
    lastPolledAgoSec?: number;
    onOpenRepo: () => void;
    steps: Record<StepKey, StepStatus>;
    onClose: () => void;
}) {
    return (
        <>
            <div className="text-sm uppercase tracking-widest text-muted">
                Claiming your bounty
            </div>

            {waitingForStar && (
                <div className="mt-5 rounded-xl border border-accent/30 bg-accent/[0.04] p-4">
                    <div className="text-sm font-semibold">⭐ Step 1: Star the repo</div>
                    <button
                        onClick={onOpenRepo}
                        className="mt-3 w-full rounded-lg border border-accent px-4 py-2 text-sm font-medium text-accent hover:bg-accent/10"
                    >
                        🔗 Open {repo} ↗
                    </button>
                    <div className="mt-3 text-xs text-muted">
                        ⏳ Waiting for your star
                        {lastPolledAgoSec !== undefined &&
                            ` — checked ${lastPolledAgoSec}s ago`}
                    </div>
                </div>
            )}

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
                />
                <ProgressStep
                    label={STEP_LABELS.submit}
                    state={steps.submit.state}
                    timing_ms={steps.submit.timing_ms}
                />
            </div>

            <button
                onClick={onClose}
                className="mt-6 w-full rounded-lg border border-white/10 px-4 py-2 text-sm text-muted hover:text-fg"
            >
                Cancel
            </button>
        </>
    );
}

function SuccessView({ result, onClose }: { result: ClaimResult; onClose: () => void }) {
    return (
        <div className="text-center">
            <div className="text-5xl">✅</div>
            <div className="mt-3 text-2xl font-semibold">Paid!</div>
            <div className="mt-1 text-sm text-muted">
                {result.amount_human} sent to your wallet
            </div>

            <div className="mt-5 break-all rounded-lg border border-white/10 bg-white/[0.03] p-3 font-mono text-xs">
                tx {result.tx_sig}
            </div>

            <div className="mt-4 flex justify-center gap-6 text-xs text-muted tabular-nums">
                <span>
                    Total{' '}
                    <span className="font-semibold text-fg">
                        {(result.total_ms / 1000).toFixed(1)} s
                    </span>
                </span>
                <span>
                    ZK proof{' '}
                    <span className="font-semibold text-accent">{result.proof_ms} ms</span>
                </span>
            </div>

            <div className="mt-6 flex flex-col gap-2">
                <a
                    href={result.explorer_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full rounded-lg border border-accent px-4 py-2 text-sm font-medium text-accent hover:bg-accent/10"
                >
                    View on Solana Explorer ↗
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

function ErrorView({ error, onClose }: { error: string; onClose: () => void }) {
    return (
        <div>
            <div className="text-2xl">❌</div>
            <div className="mt-3 text-lg font-semibold">Couldn&apos;t claim</div>
            <div className="mt-2 break-words text-sm text-err">{error}</div>
            <button
                onClick={onClose}
                className="mt-6 w-full rounded-lg border border-white/10 px-4 py-2 text-sm hover:bg-white/5"
            >
                Close
            </button>
        </div>
    );
}
