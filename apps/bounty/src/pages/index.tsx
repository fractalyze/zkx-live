import { useEffect, useState } from 'react';
import { BountyCard } from '@/components/BountyCard';
import { ClaimForm } from '@/components/ClaimForm';
import { ClaimModal } from '@/components/ClaimModal';
import { useClaim } from '@/lib/useClaim';

const REPO = 'fractalyze/zkx-snap';
const AMOUNT_HUMAN = '0.01 SOL';

type AuthState =
    | { status: 'loading' }
    | { status: 'out' }
    | { status: 'in'; login: string; id: number };

export default function Home() {
    const { state, start, close } = useClaim();
    const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

    useEffect(() => {
        let cancelled = false;
        fetch('/api/auth/me')
            .then((r) => r.json())
            .then((d) => {
                if (cancelled) return;
                if (d.logged_in) {
                    setAuth({ status: 'in', login: d.login, id: d.id });
                } else {
                    setAuth({ status: 'out' });
                }
            })
            .catch(() => !cancelled && setAuth({ status: 'out' }));
        return () => { cancelled = true; };
    }, []);

    async function handleLogout() {
        await fetch('/api/auth/logout', { method: 'POST' });
        setAuth({ status: 'out' });
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

            {auth.status === 'loading' && (
                <div className="text-center text-sm text-muted">…</div>
            )}

            {auth.status === 'out' && (
                <a
                    href="/api/auth/login"
                    className="block w-full rounded-xl border border-white/15 bg-white/[0.03] px-6 py-4 text-center text-lg font-semibold transition hover:bg-white/[0.06]"
                >
                    🐙 Sign in with GitHub
                </a>
            )}

            {auth.status === 'in' && (
                <>
                    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
                        <span>
                            ✓ Signed in as{' '}
                            <span className="font-mono text-accent">@{auth.login}</span>
                        </span>
                        <button
                            onClick={handleLogout}
                            className="text-xs text-muted hover:text-fg"
                        >
                            Sign out
                        </button>
                    </div>
                    <ClaimForm onSubmit={start} />
                </>
            )}

            <footer className="mt-auto pt-8 text-center text-xs text-muted">
                ZK proof in ~140 ms warm — accelerated by zkX.
            </footer>

            <ClaimModal
                open={state.open}
                repo={REPO}
                onClose={close}
                steps={state.steps}
                result={state.result}
                error={state.error}
            />
        </main>
    );
}
