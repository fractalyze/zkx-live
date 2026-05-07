import { BountyCard } from '@/components/BountyCard';
import { ClaimForm } from '@/components/ClaimForm';
import { ClaimModal } from '@/components/ClaimModal';
import { useClaim } from '@/lib/useClaim';

// In a future phase these come from /api/config (or NEXT_PUBLIC_*).
const REPO = 'octocat/Hello-World';
const AMOUNT_HUMAN = '5 USDC';

export default function Home() {
    const { state, start, close } = useClaim();

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

            <ClaimForm onSubmit={start} />

            <footer className="mt-auto pt-8 text-center text-xs text-muted">
                ZK proof in ~140 ms warm — accelerated by zkX.
            </footer>

            <ClaimModal
                open={state.open}
                repo={REPO}
                onClose={close}
                onOpenRepo={() => window.open(`https://github.com/${REPO}`, '_blank', 'noopener')}
                waitingForStar={state.waitingForStar}
                lastPolledAgoSec={state.lastPolledAgoSec}
                steps={state.steps}
                result={state.result}
                error={state.error}
            />
        </main>
    );
}
