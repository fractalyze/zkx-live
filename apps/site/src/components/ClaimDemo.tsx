import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';

/*
 * Self-contained inline demo. Calls /api/claim and /api/auth/* on the
 * site's same origin; next.config.js rewrites these to apps/bounty on
 * :3000. SSE works through Next's rewrite layer because the Node fetch
 * proxy honors streaming.
 *
 * The networking + SSE state machine here is deliberately unchanged
 * from the original implementation — only presentation was restyled
 * for the product page (light theme, dropped dark variants).
 */

type StepKey = 'star' | 'witness' | 'prove' | 'submit';
type StepState = 'pending' | 'running' | 'done' | 'error';
type StepStatus = { state: StepState; timing_ms?: number };

type ClaimResult = {
    tx_sig: string;
    explorer_url: string;
    total_ms: number;
    proof_ms: number;
    amount_human: string;
    recipient: string;
};

type AuthState =
    | { status: 'loading' }
    | { status: 'out' }
    | { status: 'in'; login: string; id: number }
    | { status: 'unreachable'; detail: string };

const STEPS: { key: StepKey; label: string; emphasize?: boolean }[] = [
    { key: 'star',    label: 'star repository (GitHub)' },
    { key: 'witness', label: 'build witness' },
    { key: 'prove',   label: 'generate ZK proof', emphasize: true },
    { key: 'submit',  label: 'submit on Solana' },
];

const INITIAL_STEPS: Record<StepKey, StepStatus> = {
    star:    { state: 'pending' },
    witness: { state: 'pending' },
    prove:   { state: 'pending' },
    submit:  { state: 'pending' },
};

export function ClaimDemo() {
    const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
    const [recipient, setRecipient] = useState('');
    const [steps, setSteps] = useState<Record<StepKey, StepStatus>>(INITIAL_STEPS);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<ClaimResult | undefined>();
    const [error, setError] = useState<string | undefined>();
    const [stars, setStars] = useState<number | null>(null);
    const [starred, setStarred] = useState<boolean | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    // Probe auth state once on mount.
    useEffect(() => {
        let cancelled = false;
        fetch('/api/auth/me')
            .then(async (r) => {
                if (!r.ok) throw new Error(`auth/me ${r.status}`);
                return r.json();
            })
            .then((d) => {
                if (cancelled) return;
                if (d.logged_in) setAuth({ status: 'in', login: d.login, id: d.id });
                else setAuth({ status: 'out' });
            })
            .catch((e) => {
                if (cancelled) return;
                setAuth({
                    status: 'unreachable',
                    detail: String(e?.message ?? e),
                });
            });
        return () => { cancelled = true; };
    }, []);

    // Fetch live star count from GitHub. GitHub returns cache-control max-age=60,
    // so browsers cache the response and refreshes don't see updates promptly.
    // Pass cache: 'no-store' to force a fresh request, and re-fetch when the
    // user comes back to the tab (typical after they (un)star on GitHub).
    useEffect(() => {
        let cancelled = false;
        const refresh = () => {
            fetch('https://api.github.com/repos/fractalyze/zkx-live', { cache: 'no-store' })
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                    if (cancelled || !d) return;
                    if (typeof d.stargazers_count === 'number') {
                        setStars(d.stargazers_count);
                    }
                })
                .catch(() => {});
        };
        refresh();
        const onFocus = () => refresh();
        window.addEventListener('focus', onFocus);
        return () => {
            cancelled = true;
            window.removeEventListener('focus', onFocus);
        };
    }, []);

    // Once signed in, check whether the user has already starred the repo.
    // GitHub's API returns 204 if starred, 404 if not. Disables the star
    // button when starred=true (already participated). Same no-store +
    // refresh-on-focus dance as the star count.
    useEffect(() => {
        if (auth.status !== 'in') {
            setStarred(null);
            return;
        }
        let cancelled = false;
        const refresh = () => {
            fetch('/api/star-state', { cache: 'no-store' })
                .then(r => r.json())
                .then(d => {
                    if (cancelled) return;
                    if (typeof d.starred === 'boolean') setStarred(d.starred);
                })
                .catch(() => {});
        };
        refresh();
        const onFocus = () => refresh();
        window.addEventListener('focus', onFocus);
        return () => {
            cancelled = true;
            window.removeEventListener('focus', onFocus);
        };
    }, [auth.status]);

    const handleSignOut = useCallback(async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch { /* ignore */ }
        setAuth({ status: 'out' });
        setStarred(null);
        // wipe any in-flight result/error from previous user
        setResult(undefined);
        setError(undefined);
        setSteps(INITIAL_STEPS);
    }, []);

    // OAuth in a popup so the underlying page never navigates away.
    // The callback page (apps/bounty) postMessage's back to us when done.
    const openSignInPopup = useCallback(() => {
        const w = 600;
        const h = 700;
        const left = window.screenX + (window.outerWidth - w) / 2;
        const top  = window.screenY + (window.outerHeight - h) / 2;
        window.open(
            '/api/auth/login',
            'zkx-oauth',
            `width=${w},height=${h},left=${left},top=${top},popup=yes`,
        );
    }, []);

    // Listen for the popup's "auth complete" message. Refetch /api/auth/me
    // so the UI flips to signed-in without any page navigation.
    useEffect(() => {
        function onMessage(e: MessageEvent) {
            if (!e.data || typeof e.data !== 'object') return;
            if ((e.data as { type?: string }).type !== 'zkx-auth-complete') return;
            // Refresh auth state in place.
            fetch('/api/auth/me')
                .then(r => r.json())
                .then(d => {
                    if (d.logged_in) setAuth({ status: 'in', login: d.login, id: d.id });
                })
                .catch(() => {});
        }
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, []);

    const start = useCallback(async (input: { recipient: string }) => {
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        setRunning(true);
        setResult(undefined);
        setError(undefined);
        setSteps({ ...INITIAL_STEPS, star: { state: 'running' } });

        let response: Response;
        try {
            response = await fetch('/api/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
                signal: ctrl.signal,
            });
        } catch (e) {
            if ((e as { name?: string })?.name === 'AbortError') return;
            setError(String((e as Error)?.message ?? e));
            setRunning(false);
            return;
        }

        if (!response.ok || !response.body) {
            let msg = `claim API ${response.status}`;
            try {
                const body = (await response.json()) as { error?: string };
                if (body.error) msg = body.error;
            } catch { /* not JSON */ }
            setError(msg);
            setRunning(false);
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
                    if (!evt) continue;
                    if (evt.event === 'step') {
                        const { key, state, timing_ms } = evt.data as {
                            key: StepKey; state: StepState; timing_ms?: number;
                        };
                        setSteps((s) => ({ ...s, [key]: { state, timing_ms } }));
                    } else if (evt.event === 'done') {
                        setResult(evt.data as ClaimResult);
                    } else if (evt.event === 'error') {
                        setError((evt.data as { message: string }).message);
                    }
                }
            }
        } catch (e) {
            if ((e as { name?: string })?.name !== 'AbortError') {
                setError(String((e as Error)?.message ?? e));
            }
        } finally {
            setRunning(false);
        }
    }, []);

    function reset() {
        abortRef.current?.abort();
        setSteps(INITIAL_STEPS);
        setResult(undefined);
        setError(undefined);
        setRunning(false);
    }

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        if (recipient.trim().length < 32) return;
        start({ recipient: recipient.trim() });
    }

    const completedSteps = STEPS.filter(({ key }) => steps[key].state === 'done').length;
    const runningStep = STEPS.find(({ key }) => steps[key].state === 'running')?.label;

    return (
        <div className="overflow-hidden rounded-md border-2 border-accent/60 bg-page shadow-sm">
            <div className="flex items-center justify-between border-b border-accent/30 bg-accentSoft px-5 py-2.5 text-xs">
                <span className="font-mono font-semibold uppercase tracking-[0.12em] text-accent">
                    Try it · live on devnet
                </span>
                <span className="font-mono text-faint">POST /api/claim</span>
            </div>

            <div className="px-5 py-5 sm:px-6 sm:py-6">
                {/* One-line lede — the rest is told by the visual */}
                <p className="text-sm leading-6 text-ink2">
                    A Solana program that gates payments on a ZK proof of an
                    off-chain attestation. AI-agent payouts, verified on-chain.
                </p>

                <LiveSignalStrip
                    running={running}
                    completedSteps={completedSteps}
                    runningStep={runningStep}
                    hasResult={Boolean(result)}
                    hasError={Boolean(error)}
                />

                <FlowDiagram />

                <RepoBadge stars={stars} />

                <ClaimCta
                    auth={auth}
                    recipient={recipient}
                    setRecipient={setRecipient}
                    running={running}
                    onSubmit={handleSubmit}
                    onReset={reset}
                    onSignOut={handleSignOut}
                    openSignInPopup={openSignInPopup}
                    settled={Boolean(result || error)}
                    starred={starred}
                    stars={stars}
                />

                {(running || result || error) && (
                    <>
                        <TotalElapsed
                            running={running}
                            totalMs={result?.total_ms}
                            errored={!!error}
                        />
                        <StepsPane steps={steps} />
                    </>
                )}

                {result && <ResultBlock result={result} />}
                {error && <ErrorBlock error={error} />}
            </div>
        </div>
    );
}

function LiveSignalStrip({
    running,
    completedSteps,
    runningStep,
    hasResult,
    hasError,
}: {
    running: boolean;
    completedSteps: number;
    runningStep?: string;
    hasResult: boolean;
    hasError: boolean;
}) {
    const status = hasError
        ? 'failed'
        : hasResult
          ? 'settled'
          : running
            ? 'running'
            : 'idle';

    return (
        <div className="mt-4 rounded border border-rule bg-surface px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em]">
                <span className="text-faint">real-time signal</span>
                <span className={
                    status === 'running'
                        ? 'rounded border border-accent/40 bg-accentSoft px-2 py-0.5 text-accent'
                        : status === 'settled'
                          ? 'rounded border border-ok/40 bg-ok/[0.06] px-2 py-0.5 text-ok'
                          : status === 'failed'
                            ? 'rounded border border-err/40 bg-err/[0.06] px-2 py-0.5 text-err'
                            : 'rounded border border-rule px-2 py-0.5 text-muted'
                }>
                    {status}
                </span>
                <span className="text-muted">{completedSteps}/{STEPS.length} complete</span>
                {runningStep && <span className="text-accent">now: {runningStep}</span>}
            </div>
        </div>
    );
}

/* ------------ flow visualization ------------
 *
 * Demo-specific 4-stage flow that tells the literal story:
 *
 *   ⭐               🔒                  ⛓                   💰
 *   you star    →   zkx makes proof  →  proof on-chain   →  recipient
 *   the repo        of "you starred"    gateway verifies    gets paid
 *   ─── off-chain ─────────────────── │ ─── on-chain ──────────────────
 *
 * The dashed vertical line marks the off-chain → on-chain boundary,
 * crossed by the proof.
 */
function FlowDiagram() {
    const stages: { x: number; icon: 'star' | 'lock' | 'chain' | 'coin'; title: string; sub: string }[] = [
        { x:  40, icon: 'star',  title: 'you star',         sub: 'the repo' },
        { x: 220, icon: 'lock',  title: 'zkx makes proof',  sub: 'of your action' },
        { x: 400, icon: 'chain', title: 'proof on-chain',   sub: 'gateway verifies' },
        { x: 580, icon: 'coin',  title: 'you get paid',     sub: '0.01 SOL' },
    ];
    const W = 720;

    return (
        <div className="mt-5 overflow-hidden rounded border border-rule bg-surface px-2 py-5 sm:px-4">
            <svg
                viewBox={`0 0 ${W} 170`}
                role="img"
                aria-label="Four-stage flow: you click star, zkx generates a proof of your action, the proof is submitted on-chain where the gateway verifies it, then 0.01 SOL is paid to your recipient."
                className="block w-full"
            >
                {/* Off-chain / on-chain lane labels at the top */}
                <text x={160} y={16} textAnchor="middle" className="font-mono" fill="#94a3b8" fontSize="10" letterSpacing="0.18em">
                    OFF-CHAIN
                </text>
                <text x={500} y={16} textAnchor="middle" className="font-mono" fill="#1f5fa8" fontSize="10" letterSpacing="0.18em" opacity="0.85">
                    ON-CHAIN
                </text>

                {/* Vertical dashed boundary between stage 2 (off-chain) and stage 3 (on-chain) */}
                <line
                    x1={330} y1={26} x2={330} y2={150}
                    stroke="#94a3b8"
                    strokeWidth={1}
                    strokeDasharray="3 4"
                    opacity="0.7"
                />

                {/* Connecting horizontal track behind the icons — very subtle */}
                <line
                    x1={70} y1={70} x2={650} y2={70}
                    stroke="#cbd5e1"
                    strokeWidth={1}
                    strokeDasharray="2 4"
                />

                {stages.map((s, i) => (
                    <Stage
                        key={i}
                        x={s.x}
                        icon={s.icon}
                        title={s.title}
                        sub={s.sub}
                        isOnChain={i >= 2}
                    />
                ))}

                {/* Arrows between stages — circle r=26, leave a 6px gap on
                    either side so the line + arrowhead never overlap the icons */}
                {[0, 1, 2].map(i => {
                    const cxFrom = stages[i].x + 40;
                    const cxTo   = stages[i + 1].x + 40;
                    const fromX  = cxFrom + 26 + 6;   // outside circle + gap
                    const toX    = cxTo   - 26 - 6;   // arrowhead tip ends here
                    return <FlowArrow key={i} x1={fromX} x2={toX} y={70} accent={i === 1} />;
                })}
            </svg>
        </div>
    );
}

function Stage({
    x, icon, title, sub, isOnChain,
}: {
    x: number;
    icon: 'star' | 'lock' | 'chain' | 'coin';
    title: string;
    sub: string;
    isOnChain: boolean;
}) {
    const tone = isOnChain ? '#1f5fa8' : '#475569';
    const bg   = isOnChain ? '#eff5fc' : '#ffffff';
    const cx = x + 40;
    const cy = 70;

    return (
        <g>
            {/* circular badge */}
            <circle
                cx={cx} cy={cy} r={26}
                fill={bg}
                stroke={tone}
                strokeWidth={1.5}
            />
            <StageIcon icon={icon} cx={cx} cy={cy} tone={tone} />

            {/* title — under the icon */}
            <text
                x={cx} y={cy + 50}
                textAnchor="middle"
                className="font-mono"
                fill="#0f172a"
                fontSize="12"
                fontWeight="600"
            >
                {title}
            </text>
            <text
                x={cx} y={cy + 68}
                textAnchor="middle"
                className="font-mono"
                fill="#64748b"
                fontSize="10.5"
            >
                {sub}
            </text>
        </g>
    );
}

function StageIcon({
    icon, cx, cy, tone,
}: { icon: 'star' | 'lock' | 'chain' | 'coin'; cx: number; cy: number; tone: string }) {
    if (icon === 'star') {
        return (
            <g transform={`translate(${cx - 11} ${cy - 11})`}>
                <path
                    d="M11 0 L13.5 7.5 L21 7.5 L15 12 L17.5 19.5 L11 15 L4.5 19.5 L7 12 L1 7.5 L8.5 7.5 Z"
                    fill={tone}
                />
            </g>
        );
    }
    if (icon === 'lock') {
        return (
            <g transform={`translate(${cx - 9} ${cy - 10})`} stroke={tone} strokeWidth={1.3} fill="none" strokeLinecap="round">
                <rect x={2} y={9} width={14} height={11} rx={1.5} fill={tone} />
                <path d={`M5 9 V5 a4 4 0 0 1 8 0 V9`} />
            </g>
        );
    }
    if (icon === 'chain') {
        return (
            <g transform={`translate(${cx - 12} ${cy - 8})`} stroke={tone} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 6 a5 5 0 0 0 -7 0 l-2 2 a5 5 0 0 0 7 7 l1 -1" />
                <path d="M14 10 a5 5 0 0 0 7 0 l2 -2 a5 5 0 0 0 -7 -7 l-1 1" />
                <line x1="9" y1="9" x2="15" y2="3" />
            </g>
        );
    }
    // coin
    return (
        <g transform={`translate(${cx - 10} ${cy - 10})`}>
            <circle cx="10" cy="10" r="9" fill={tone} />
            <text x="10" y="14.5" textAnchor="middle" className="font-mono" fontSize="12" fontWeight="700" fill="#ffffff">$</text>
        </g>
    );
}

function FlowArrow({ x1, x2, y, accent }: { x1: number; x2: number; y: number; accent?: boolean }) {
    const color = accent ? '#1f5fa8' : '#94a3b8';
    return (
        <g>
            <line x1={x1} y1={y} x2={x2 - 6} y2={y} stroke={color} strokeWidth={accent ? 1.7 : 1.4} />
            <polygon points={`${x2 - 6},${y - 4.5} ${x2 - 6},${y + 4.5} ${x2 + 1},${y}`} fill={color} />
        </g>
    );
}

/* ------------ live total elapsed ------------ */

function TotalElapsed({
    running, totalMs, errored,
}: { running: boolean; totalMs?: number; errored: boolean }) {
    const [elapsedMs, setElapsedMs] = useState(0);
    const startedAtRef = useRef<number | null>(null);

    useEffect(() => {
        if (running) {
            startedAtRef.current = performance.now();
            setElapsedMs(0);
            const id = setInterval(() => {
                if (startedAtRef.current !== null) {
                    setElapsedMs(performance.now() - startedAtRef.current);
                }
            }, 33);
            return () => clearInterval(id);
        } else if (totalMs !== undefined) {
            setElapsedMs(totalMs);
        }
        // when error w/ no total, keep last counter value
    }, [running, totalMs]);

    const display = formatElapsed(elapsedMs);
    const tone = errored
        ? 'text-err'
        : running
          ? 'text-accent'
          : totalMs !== undefined
            ? 'text-ok'
            : 'text-ink';

    return (
        <div className="mt-5 flex items-baseline justify-between rounded border-l-2 border-accent bg-surface px-5 py-3.5">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
                Total elapsed
                {running && <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-accent align-middle" />}
            </span>
            <span className={`font-mono text-3xl font-semibold tabular ${tone}`}>
                {display}
            </span>
        </div>
    );
}

function formatElapsed(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
}

function RepoBadge({ stars }: { stars: number | null }) {
    return (
        <a
            href="https://github.com/fractalyze/zkx-live"
            target="_blank"
            rel="noreferrer"
            className="mt-5 flex items-center justify-between rounded border border-rule bg-surface px-4 py-3 font-mono text-sm transition-colors hover:border-accent/60"
        >
            <span className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-ink2">
                    <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8a8 8 0 0 0-8-8z" />
                </svg>
                <span className="text-ink">fractalyze/zkx-live</span>
            </span>
            {/* Live star count — visible regardless of auth state. The
                GitHub /repos/{owner}/{repo} endpoint is public so the
                fetch in the parent runs without a token. */}
            <span className="flex items-center gap-1.5 text-ink2">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-amber-500">
                    <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.61L7.327.668A.75.75 0 0 1 8 .25z" />
                </svg>
                <span className="tabular tabular-nums text-ink">
                    {stars === null ? '—' : stars.toLocaleString()}
                </span>
                <span className="text-faint">stars</span>
            </span>
        </a>
    );
}

function ClaimCta({
    auth, recipient, setRecipient, running, onSubmit, onReset, onSignOut, openSignInPopup,
    settled, starred, stars,
}: {
    auth: AuthState;
    recipient: string;
    setRecipient: (v: string) => void;
    running: boolean;
    onSubmit: (e: FormEvent) => void;
    onReset: () => void;
    onSignOut: () => void;
    openSignInPopup: () => void;
    settled: boolean;
    starred: boolean | null;
    stars: number | null;
}) {
    if (auth.status === 'loading') {
        return (
            <div className="mt-3 rounded border border-rule bg-surface px-4 py-4 font-mono text-xs text-muted">
                checking GitHub session…
            </div>
        );
    }

    if (auth.status === 'unreachable') {
        return (
            <div className="mt-3 rounded border border-warn/30 bg-warn/10 px-4 py-3 text-sm">
                <div className="font-mono text-xs font-semibold uppercase tracking-wider text-warn">
                    bounty service not reachable
                </div>
                <p className="mt-1 text-ink2">
                    The local apps/bounty server isn&apos;t running on{' '}
                    <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">:3000</code>.
                    Start it with <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">cd apps/bounty &amp;&amp; npm run dev</code>.
                </p>
            </div>
        );
    }

    if (auth.status === 'out') {
        return (
            <button
                type="button"
                onClick={openSignInPopup}
                className="mt-3 flex w-full items-center justify-center gap-3 rounded-md bg-ink px-6 py-4 text-base font-semibold text-page transition hover:opacity-90"
            >
                <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                    <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8a8 8 0 0 0-8-8z" />
                </svg>
                Sign in with GitHub to claim 0.01 SOL
            </button>
        );
    }

    // Signed in — show recipient input + GitHub-style star button.
    const recipientReady = recipient.trim().length >= 32;
    const isStarred = starred === true;
    const buttonDisabled = running || !recipientReady || isStarred;
    return (
        <form onSubmit={onSubmit} className="mt-3 space-y-3">
            <div className="flex items-center justify-between font-mono text-xs">
                <span className="text-muted">
                    signed in as <span className="font-semibold text-accent">@{auth.login}</span>
                </span>
                <span className="flex items-center gap-3 text-muted">
                    {settled && !running && (
                        <button type="button" onClick={onReset} className="hover:text-ink">
                            reset
                        </button>
                    )}
                    <button type="button" onClick={onSignOut} className="hover:text-ink">
                        sign out
                    </button>
                </span>
            </div>
            <label className="block">
                <div className="mb-1.5 font-mono text-[11.5px] uppercase tracking-[0.08em] text-muted">
                    your Solana address (recipient)
                </div>
                <input
                    type="text"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="paste your devnet address e.g. HJ7K…xY4M"
                    spellCheck={false}
                    autoComplete="off"
                    disabled={running}
                    className="w-full rounded border border-rule bg-page px-3 py-3 font-mono text-sm text-ink outline-none transition focus:border-accent disabled:opacity-60"
                />
            </label>
            {/* GitHub-style split button: action on left, star count on right */}
            <div className="flex justify-center">
                <button
                    type="submit"
                    disabled={buttonDisabled}
                    aria-disabled={buttonDisabled}
                    className={
                        'inline-flex select-none rounded-md border text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed ' +
                        (running
                            ? 'border-accent/40 bg-accentSoft text-accent'
                            : isStarred
                              ? 'border-ok/40 bg-ok/[0.06] text-ok'
                              : 'border-ink/15 bg-surface text-ink hover:border-ink/30 hover:bg-page disabled:opacity-50')
                    }
                >
                    <span className="flex items-center gap-2 px-4 py-2">
                        {running ? (
                            <>
                                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
                                Starring…
                            </>
                        ) : isStarred ? (
                            <>
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden className="text-ok">
                                    <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.61L7.327.668A.75.75 0 0 1 8 .25z" />
                                </svg>
                                Starred
                            </>
                        ) : (
                            <>
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden className="text-amber-500">
                                    <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.61L7.327.668A.75.75 0 0 1 8 .25z" />
                                </svg>
                                Star
                            </>
                        )}
                    </span>
                    <span className={
                        'flex items-center gap-1.5 border-l px-3 py-2 font-mono text-xs tabular ' +
                        (running
                            ? 'border-accent/30 text-accent'
                            : isStarred
                              ? 'border-ok/30 text-ok'
                              : 'border-ink/15 text-ink')
                    }>
                        {stars === null ? '—' : stars.toLocaleString()}
                    </span>
                </button>
            </div>
            {/* Status / reward badge under the action */}
            <p className="mt-1 text-center font-mono text-[11px] text-muted">
                {running
                    ? 'generating ZK proof…'
                    : isStarred
                      ? <>✓ already claimed under this GitHub account — sign in with another to try again</>
                      : recipientReady
                        ? <>↳ pays <span className="font-semibold text-accent">0.01 SOL</span> to your recipient on completion</>
                        : <>paste a Solana base58 address above to enable</>}
            </p>
        </form>
    );
}

function StepsPane({ steps }: { steps: Record<StepKey, StepStatus> }) {
    return (
        <div className="mt-3 rounded border border-rule bg-surface">
            <div className="flex items-center justify-between border-b border-rule px-4 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint">
                <span>step</span>
                <span>elapsed</span>
            </div>
            <ul className="divide-y divide-rule">
                {STEPS.map(({ key, label, emphasize }) => {
                    const s = steps[key];
                    return (
                        <li key={key} className="flex items-center justify-between px-4 py-3 text-sm">
                            <span className="flex items-center gap-3">
                                <StateGlyph state={s.state} />
                                <span
                                    className={
                                        s.state === 'pending'
                                            ? 'text-muted'
                                            : s.state === 'error'
                                              ? 'text-err'
                                              : 'text-ink'
                                    }
                                >
                                    {label}
                                </span>
                            </span>
                            <StepElapsed s={s} emphasize={!!emphasize} />
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

function StateGlyph({ state }: { state: StepState }) {
    if (state === 'running') {
        return <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />;
    }
    if (state === 'done') {
        return <span className="font-mono text-xs text-ok">[ok]</span>;
    }
    if (state === 'error') {
        return <span className="font-mono text-xs text-err">[!!]</span>;
    }
    return <span className="font-mono text-xs text-faint">[ ]</span>;
}

function StepElapsed({ s, emphasize }: { s: StepStatus; emphasize: boolean }) {
    // pending or running — show a muted pending marker
    if (s.timing_ms === undefined || s.state !== 'done') {
        if (s.state === 'running') {
            return (
                <span className="font-mono text-sm text-accent">
                    <LiveDots />
                </span>
            );
        }
        return <span className="font-mono text-sm text-faint">—</span>;
    }
    const fast = s.timing_ms < 1000;
    const txt = s.timing_ms >= 1000
        ? `${(s.timing_ms / 1000).toFixed(2)} s`
        : `${s.timing_ms} ms`;
    return (
        <span
            className={[
                'font-mono text-base font-semibold tabular',
                emphasize && fast
                    ? 'text-accent'
                    : fast
                      ? 'text-ok'
                      : 'text-ink',
            ].join(' ')}
        >
            {txt}
        </span>
    );
}

function LiveDots() {
    const [n, setN] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setN((v) => (v + 1) % 4), 350);
        return () => clearInterval(id);
    }, []);
    return <span className="tabular">{'·'.repeat(n).padEnd(3, ' ')}</span>;
}

function ResultBlock({ result }: { result: ClaimResult }) {
    return (
        <div className="mt-4 rounded border border-ok/40 bg-ok/[0.06] px-4 py-3 text-sm">
            <div className="font-mono text-xs font-semibold uppercase tracking-wider text-ok">
                claim settled
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-xs">
                <Field label="amount"    value={result.amount_human} />
                <Field label="recipient" value={shorten(result.recipient)} />
                <Field label="total"     value={`${(result.total_ms / 1000).toFixed(2)} s`} />
                <Field label="zk-proof"  value={`${result.proof_ms} ms`} highlight />
            </div>
            <a
                href={result.explorer_url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block break-all rounded border border-rule bg-surface px-3 py-2 font-mono text-xs text-accent hover:bg-page"
            >
                {result.explorer_url} ↗
            </a>
        </div>
    );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div className="flex items-baseline gap-2">
            <span className="text-faint">{label}</span>
            <span className={highlight ? 'font-semibold text-accent' : 'text-ink'}>
                {value}
            </span>
        </div>
    );
}

function ErrorBlock({ error }: { error: string }) {
    return (
        <div className="mt-4 rounded border border-err/40 bg-err/[0.06] px-4 py-3 text-sm">
            <div className="font-mono text-xs font-semibold uppercase tracking-wider text-err">
                claim failed
            </div>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] text-err">
                {error}
            </pre>
        </div>
    );
}

function shorten(s: string): string {
    return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s;
}

function parseSseBlock(block: string): { event: string; data: unknown } | null {
    let event = 'message';
    let dataLine = '';
    for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
    }
    if (!dataLine) return null;
    try { return { event, data: JSON.parse(dataLine) }; }
    catch { return null; }
}
