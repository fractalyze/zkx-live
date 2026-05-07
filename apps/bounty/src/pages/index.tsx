import { useState } from 'react';
import { BountyCard } from '@/components/BountyCard';
import { ClaimForm } from '@/components/ClaimForm';
import {
    ClaimModal,
    ClaimResult,
    StepKey,
    StepStatus,
} from '@/components/ClaimModal';

// Hardcoded for now — wire to env (NEXT_PUBLIC_GITHUB_REPO etc.) in a later phase.
const REPO = 'octocat/Hello-World';
const AMOUNT_HUMAN = '5 USDC';

const initialSteps: Record<StepKey, StepStatus> = {
    star:    { state: 'pending' },
    witness: { state: 'pending' },
    prove:   { state: 'pending' },
    submit:  { state: 'pending' },
};

export default function Home() {
    const [modalOpen, setModalOpen] = useState(false);
    const [waitingForStar, setWaitingForStar] = useState(true);
    const [steps, setSteps] = useState<Record<StepKey, StepStatus>>(initialSteps);
    const [result, setResult] = useState<ClaimResult | undefined>(undefined);
    const [error, setError] = useState<string | undefined>(undefined);

    function handleClaim(_input: { username: string; recipient: string }) {
        // Phase 1 mock: open modal + leave Step 1 hanging.
        // Phase 2+: wire to /api/claim SSE for real progress.
        setSteps(initialSteps);
        setResult(undefined);
        setError(undefined);
        setWaitingForStar(true);
        setModalOpen(true);
    }

    function handleOpenRepo() {
        window.open(`https://github.com/${REPO}`, '_blank', 'noopener');
    }

    function handleClose() {
        setModalOpen(false);
    }

    return (
        <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-8 px-4 py-12">
            <header className="flex items-baseline justify-between">
                <div className="font-mono text-sm text-muted">🛡️ zkx-snap</div>
                <a
                    href="https://github.com/fractalyze/zkx-snap"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-muted hover:text-fg"
                >
                    How it works ↗
                </a>
            </header>

            <BountyCard repo={REPO} amount={AMOUNT_HUMAN} />

            <ClaimForm onSubmit={handleClaim} />

            <footer className="mt-auto pt-8 text-center text-xs text-muted">
                ZK proof in ~140 ms warm — accelerated by zkX.
            </footer>

            <ClaimModal
                open={modalOpen}
                repo={REPO}
                onClose={handleClose}
                onOpenRepo={handleOpenRepo}
                waitingForStar={waitingForStar}
                steps={steps}
                result={result}
                error={error}
            />
        </main>
    );
}
