import { HeroDiagram } from '@/components/HeroDiagram';
import { HowItWorksDiagram } from '@/components/HowItWorksDiagram';
import { PerfCharts, BaselineSnapshots } from '@/components/PerfCharts';
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
                <HowItWorks />
                <Performance />
                <SystemBenchmarks />
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
                        — real-time ZK proofs, accelerated by zkx
                    </span>
                </a>
                <nav className="flex items-center gap-5 font-mono text-xs text-muted">
                    <a href="#how-it-works" className="hover:text-ink">how it works</a>
                    <a href="#performance" className="hover:text-ink">performance</a>
                    <a href="#demo" className="hover:text-ink">demo</a>
                    <a href="#certified" className="hidden hover:text-ink sm:inline">certified</a>
                    <a
                        href="https://github.com/fractalyze/open-zkx"
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
    // Single column. Section fills up to max-w-page (1440px); above that
    // it caps and centers with the section's horizontal gutters. Inside
    // the section, only paragraphs cap at max-w-prose for readability —
    // headline + diagram fill the section width. SPEC §4.
    return (
        <section id="hero" className="border-b border-rule">
            <div className="mx-auto max-w-page px-6 pt-14 pb-20 text-center lg:px-10 lg:pt-20 lg:pb-28">
                <div className="font-mono text-xs uppercase tracking-[0.14em] text-faint">
                    fractalyze · zkx compiler
                </div>
                <h1 className="mt-4 text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl lg:text-[52px] lg:leading-[1.05]">
                    ZKX + PrimeIR: compiler stack for real-time proving.
                </h1>
                <p className="mx-auto mt-6 max-w-prose text-pretty text-lg leading-7 text-ink2">
                    ZKX is our proof compiler, and PrimeIR is the optimization layer beneath it. Instead of hand-tuning each prover backend, this stack compiles proving workloads into optimized primitive kernels across schemes and hardware targets.
                </p>
                <p className="mx-auto mt-4 max-w-prose text-pretty text-base leading-7 text-muted">
                    The benchmark sections below show the kernel-level gains (FFT, IFFT, MSM, SMCS, LOGUP GKR) and the application-level outcomes (Groth16 prove, zkVM block proof). The payment gateway demo shows what this means in product terms: proof generation fast enough for real user-facing flows.
                </p>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                    <a
                        href="#demo"
                        className="inline-flex items-center gap-2 rounded border border-accent bg-accent px-4 py-2 font-mono text-sm font-semibold text-white hover:opacity-90"
                    >
                        Try the demo
                        <span aria-hidden>↓</span>
                    </a>
                </div>

                {/* Diagram — capped + centered so it doesn't dwarf the copy */}
                <div className="mx-auto mt-12 max-w-5xl">
                    <HeroDiagram />
                </div>
            </div>
        </section>
    );
}

/* ----------------------- how it works ----------------------- */

function HowItWorks() {
    return (
        <section id="how-it-works" className="border-b border-rule bg-page">
            <div className="mx-auto max-w-page px-6 py-20 lg:px-10 lg:py-24">
                <SectionHeader
                    eyebrow="How it works"
                    title="An XLA for ZK."
                    sub="ZK proving today looks like ML did around 2015 — every scheme has its own hand-tuned prover, and every new (scheme × hardware) combination is a fresh manual optimization round."
                />
                <div className="mt-8 grid gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
                    <div className="space-y-5 text-base leading-7 text-ink2">
                        <p>
                            <span className="font-semibold text-ink">ML solved this with XLA.</span> TensorFlow, PyTorch, and JAX stopped emitting hand-tuned CUDA kernels and started emitting an IR that XLA lowers to whatever hardware target you bring. The result: PyTorch + XLA on a GPU often beats hand-written CUDA C++, because the compiler sees the whole computation graph and the manual writer only sees one kernel at a time.
                        </p>
                        <p>
                            <span className="font-semibold text-ink">zkX takes the same path for ZK.</span> PrimeIR is the IR. The compiler ingests circom, SP1, or any custom circuit, lowers through algebraic rewrite + kernel fusion + layout assignment + lowering passes, and emits an optimized prover backend per (scheme × hardware) target.
                        </p>
                        <p>
                            The two domains share the same constraint: ZK proving and ML training are both <span className="font-semibold text-ink">memory-bound</span> on modern GPUs. The compiler optimizations that won for XLA — fusion, layout, scheduling — are the same ones that move the needle here.
                        </p>
                        <p className="text-sm text-muted">
                            The benchmarks below are what comes out the other end: kernel-level wins (FFT, MSM, LOGUP GKR) and end-to-end application wins against the prover each category currently calls SOTA.
                        </p>
                    </div>
                    <div>
                        <HowItWorksDiagram />
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
                    title="Primitive kernel benchmarks"
                    sub="Backend kernel improvements from ZKX + PrimeIR, measured on FFT, IFFT, MSM, SMCS, and LOGUP GKR."
                />
                <div className="mt-10">
                    <PerfCharts />
                </div>
            </div>
        </section>
    );
}

function SystemBenchmarks() {
    return (
        <section id="system-benchmarks" className="border-b border-rule bg-page">
            <div className="mx-auto max-w-page px-6 py-16 lg:px-10 lg:py-20">
                <SectionHeader
                    eyebrow="Applications"
                    title="We beat the industry's fastest provers."
                    sub="Two end-to-end workloads drive most production GPU prover cost — Groth16 STARK→SNARK wrapping and zkVM block proving. zkx is faster than the prover each category currently calls SOTA."
                />
                <div className="mt-8">
                    <BaselineSnapshots />
                </div>
            </div>
        </section>
    );
}

function Demo() {
    return (
        <section id="demo" className="border-b border-rule">
            <div className="mx-auto max-w-page px-6 py-20 lg:px-10 lg:py-24">
                <SectionHeader
                    eyebrow="Live demo"
                    title="Bridge real-world events to on-chain in real-time."
                    sub="Check how fast a real-world activity can land on-chain. Star a GitHub repo → zkx generates the proof → Solana settles the payout, all in seconds."
                />
                <div className="mx-auto mt-10 max-w-3xl">
                    <ClaimDemo />
                </div>
            </div>
        </section>
    );
}

/* ----------------------- grants ----------------------- */

function Grants() {
    return (
        <section id="certified" className="border-b border-rule">
            <div className="mx-auto max-w-page px-6 py-20 lg:px-10 lg:py-24">
                <SectionHeader
                    eyebrow="Certified by"
                    title="Backed by top-tier programs."
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
    // Title h2 takes the section's natural width so long headlines (e.g.
    // "Payment gateway demo powered by real-time proving") stay on one
    // line on desktop. Sub paragraph keeps a readable max-width.
    return (
        <div>
            <div className="font-mono text-xs uppercase tracking-[0.14em] text-accent">
                {eyebrow}
            </div>
            <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-[36px]">
                {title}
            </h2>
            {sub && (
                <p className="mt-4 max-w-3xl text-base leading-7 text-ink2">{sub}</p>
            )}
        </div>
    );
}

function SiteFooter() {
    return (
        <footer className="border-t border-rule bg-surface/60">
            <div className="mx-auto flex max-w-page flex-col gap-6 px-6 py-10 font-mono text-xs text-muted lg:flex-row lg:items-start lg:justify-between lg:px-10">
                {/* Left: brand line + zkx vs open-zkx clarification */}
                <div className="space-y-2">
                    <div>© 2026 Fractalyze · accelerate a verifiable world</div>
                    <div className="text-faint">
                        zkx is closed source. <a href="https://github.com/fractalyze/open-zkx" target="_blank" rel="noreferrer" className="text-accent hover:underline">open-zkx ↗</a> is the public subset.
                    </div>
                </div>

                {/* Right: link columns */}
                <div className="grid gap-6 sm:grid-cols-3">
                    <FooterCol title="Code">
                        <FooterLink href="https://github.com/fractalyze/open-zkx">open-zkx</FooterLink>
                        <FooterLink href="https://github.com/fractalyze/prime-ir">prime-ir</FooterLink>
                        <FooterLink href="https://github.com/fractalyze/zkx-live">zkx-live</FooterLink>
                    </FooterCol>
                    <FooterCol title="Org">
                        <FooterLink href="https://github.com/fractalyze">github.com/fractalyze</FooterLink>
                        <FooterLink href="https://www.linkedin.com/company/fractalyze">linkedin/fractalyze</FooterLink>
                        <FooterLink href="https://x.com/fractalyze">@fractalyze (X)</FooterLink>
                    </FooterCol>
                    <FooterCol title="Contact">
                        <FooterLink href="mailto:hello@fractalyze.io">hello@fractalyze.io</FooterLink>
                    </FooterCol>
                </div>
            </div>
        </footer>
    );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
                {title}
            </div>
            <div className="space-y-1.5">{children}</div>
        </div>
    );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="block text-muted hover:text-ink"
        >
            {children}
        </a>
    );
}
