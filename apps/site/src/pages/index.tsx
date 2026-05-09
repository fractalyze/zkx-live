import { HeroDiagram } from '@/components/HeroDiagram';
import { PerfCharts } from '@/components/PerfCharts';
import { ClaimDemo } from '@/components/ClaimDemo';
import { GrantLogos } from '@/components/GrantLogos';

/*
 * zkx product page — diagram-led, four sections:
 *
 *   1. HERO         — the compiler-stack diagram + one strong line
 *   2. PERFORMANCE  — two real SVG charts (vs circom, vs ICICLE)
 *   3. DEMO         — inline live Solana bounty claim
 *   4. GRANTS       — Ethereum Foundation + NVIDIA Inception
 *
 * Light theme only. One accent color (engineering blue) used sparingly
 * for the hero diagram core, focal numerals, demo callout border, and
 * primary anchor links.
 */
export default function Home() {
    return (
        <div id="top">
            <TopNav />
            <main>
                <Hero />
                <Performance />
                <Demo />
                <Grants />
            </main>
            <SiteFooter />
        </div>
    );
}

/* ----------------------- top nav ----------------------- */

function TopNav() {
    return (
        <header className="sticky top-0 z-30 border-b border-rule bg-page/85 backdrop-blur">
            <div className="mx-auto flex h-12 max-w-page items-center justify-between px-6 lg:px-10">
                <a href="#top" className="flex items-baseline gap-2 no-underline">
                    <span className="font-mono text-base font-semibold tracking-tight text-ink">
                        zkx
                    </span>
                    <span className="hidden font-mono text-[11px] text-faint sm:inline">
                        — real-time ZK proofs through a compiler
                    </span>
                </a>
                <nav className="flex items-center gap-5 font-mono text-xs text-muted">
                    <a href="#performance" className="hover:text-ink">performance</a>
                    <a href="#demo" className="hover:text-ink">demo</a>
                    <a href="#grants" className="hidden hover:text-ink sm:inline">grants</a>
                    <a
                        href="https://github.com/fractalyze/zkx"
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-ink"
                    >
                        github ↗
                    </a>
                </nav>
            </div>
        </header>
    );
}

/* ----------------------- hero ----------------------- */

function Hero() {
    return (
        <section id="hero" className="border-b border-rule">
            <div className="mx-auto max-w-page px-6 pt-14 pb-20 lg:px-10 lg:pt-20 lg:pb-28">
                <div className="grid gap-10 xl:grid-cols-12 xl:gap-12">
                    {/* Copy column — narrow, supports the diagram */}
                    <div className="xl:col-span-5">
                        <div className="font-mono text-xs uppercase tracking-[0.14em] text-faint">
                            fractalyze · accelerate a verifiable world
                        </div>
                        <h1 className="mt-4 text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl lg:text-[52px] lg:leading-[1.05]">
                            Real-time ZK proofs<br />
                            <span className="text-accent">through a compiler.</span>
                        </h1>
                        <p className="mt-6 max-w-prose text-lg leading-7 text-ink2">
                            zkx is an MLIR-based zero-knowledge optimization compiler.
                            Bring any circuit, any proving scheme — get sub-second
                            proofs on the hardware you have.
                        </p>
                        <div className="mt-8 flex flex-wrap items-center gap-4">
                            <a
                                href="#demo"
                                className="inline-flex items-center gap-2 rounded border border-accent bg-accent px-4 py-2 font-mono text-sm font-semibold text-white hover:opacity-90"
                            >
                                Try the demo
                                <span aria-hidden>↓</span>
                            </a>
                        </div>
                    </div>

                    {/* Diagram column — the centerpiece */}
                    <div className="xl:col-span-7">
                        <HeroDiagram />
                    </div>
                </div>
            </div>
        </section>
    );
}

/* ----------------------- performance ----------------------- */

function Performance() {
    return (
        <section id="performance" className="border-b border-rule bg-surface/60">
            <div className="mx-auto max-w-page px-6 py-20 lg:px-10 lg:py-24">
                <SectionHeader
                    eyebrow="Performance"
                    title="Faster across schemes."
                />
                <div className="mt-10">
                    <PerfCharts />
                </div>
            </div>
        </section>
    );
}

/* ----------------------- demo ----------------------- */

function Demo() {
    return (
        <section id="demo" className="border-b border-rule">
            <div className="mx-auto max-w-page px-6 py-20 lg:px-10 lg:py-24">
                <SectionHeader
                    eyebrow="Live demo"
                    title="Star our repo, claim 0.01 SOL on devnet."
                    sub="A real on-chain claim, proved by zkx in real time. Each step runs end-to-end on this page — watch the elapsed counter."
                />
                <div className="mt-10">
                    <ClaimDemo />
                </div>
            </div>
        </section>
    );
}

/* ----------------------- grants ----------------------- */

function Grants() {
    return (
        <section id="grants" className="border-b border-rule">
            <div className="mx-auto max-w-page px-6 py-20 lg:px-10 lg:py-24">
                <SectionHeader
                    eyebrow="Grants"
                    title="Built with support from."
                />
                <div className="mt-12">
                    <GrantLogos />
                </div>
            </div>
        </section>
    );
}

/* ----------------------- shared bits ----------------------- */

function SectionHeader({
    eyebrow, title, sub,
}: { eyebrow: string; title: string; sub?: string }) {
    return (
        <div className="max-w-3xl">
            <div className="font-mono text-xs uppercase tracking-[0.14em] text-accent">
                {eyebrow}
            </div>
            <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-[36px]">
                {title}
            </h2>
            {sub && (
                <p className="mt-4 text-base leading-7 text-ink2">{sub}</p>
            )}
        </div>
    );
}

function SiteFooter() {
    return (
        <footer className="border-t border-rule bg-surface/60">
            <div className="mx-auto flex max-w-page flex-col items-start justify-between gap-4 px-6 py-8 font-mono text-xs text-muted sm:flex-row sm:items-center lg:px-10">
                <div>© 2026 Fractalyze · accelerate a verifiable world</div>
                <div className="flex flex-wrap items-center gap-4">
                    <a href="https://github.com/fractalyze/zkx" target="_blank" rel="noreferrer" className="hover:text-ink">
                        github.com/fractalyze/zkx
                    </a>
                    <a href="https://github.com/fractalyze/prime-ir" target="_blank" rel="noreferrer" className="hover:text-ink">
                        prime-ir
                    </a>
                    <a href="https://github.com/fractalyze/zkx-snap" target="_blank" rel="noreferrer" className="hover:text-ink">
                        zkx-snap
                    </a>
                </div>
            </div>
        </footer>
    );
}
