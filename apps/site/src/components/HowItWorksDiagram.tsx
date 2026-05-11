/*
 * Two side-by-side hourglass stacks (ML | ZK). Mirrors the canonical
 * XLA architecture pictogram (frontends → IR waist → backends).
 *
 *   inputs   ─┐                              ╲   │   ╱
 *             ├─ converging Bézier funnel  →  ╲  │  ╱
 *   inputs   ─┘                                ╲ │ ╱
 *                                          ┌──── waist ────┐   ← compiler
 *                                          │    XLA / ZKX   │     (accent
 *                                          │  HLO  / PrimeIR│      on ZK)
 *                                          └────────┬───────┘
 *                                                ╱  │  ╲
 *                                               ╱   │   ╲
 *                                          ───╱────────╲───── outputs
 */
import type { ReactNode } from 'react';

type Side = {
    title: string;
    inputs: string[];
    waist: { primary: string; secondary: string };
    outputs: string[];
    note?: string;
};

const ML_SIDE: Side = {
    title: 'ML — today',
    inputs: ['TensorFlow', 'PyTorch', 'JAX'],
    waist: { primary: 'XLA', secondary: 'StableHLO · HLO' },
    outputs: ['CPU', 'GPU', 'TPU'],
    note: 'Frameworks emit a portable IR; XLA lowers it to whatever hardware you bring.',
};

const ZK_SIDE: Side = {
    title: 'ZK — with ZKX',
    inputs: ['Groth16', 'zkVM', 'circom / custom'],
    waist: { primary: 'ZKX', secondary: 'PrimeIR' },
    outputs: ['CPU', 'GPU', 'ASIC'],
    note: 'Same shape: schemes emit PrimeIR; ZKX lowers per (scheme × hardware) target.',
};

export function HowItWorksDiagram() {
    return (
        <div className="rounded-xl border border-rule bg-page p-5 sm:p-7">
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_auto_1fr] lg:gap-6">
                <Hourglass side={ML_SIDE} />
                {/* Subtle "↦" between the two stacks on desktop signaling
                    "the same shape applies here". Hidden on mobile where
                    the stacks are vertical. */}
                <div className="hidden items-center justify-center lg:flex">
                    <div className="flex flex-col items-center gap-1 text-faint">
                        <div className="font-mono text-[10px] uppercase tracking-[0.18em]">
                            same shape
                        </div>
                        <svg width="44" height="20" viewBox="0 0 44 20" aria-hidden>
                            <path
                                d="M2 10 H38 M30 4 L40 10 L30 16"
                                stroke="currentColor" strokeWidth="1.25"
                                fill="none" strokeLinecap="round" strokeLinejoin="round"
                            />
                        </svg>
                    </div>
                </div>
                <Hourglass side={ZK_SIDE} accentWaist />
            </div>
        </div>
    );
}

function Hourglass({ side, accentWaist = false }: { side: Side; accentWaist?: boolean }) {
    return (
        <div className="flex flex-col items-stretch">
            {/* Title with a tiny underline accent */}
            <div className="mb-4 text-center">
                <div className="inline-flex flex-col items-center">
                    <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-ink2">
                        {side.title}
                    </span>
                    <span
                        className={[
                            'mt-1 h-px w-10',
                            accentWaist ? 'bg-accent' : 'bg-rule',
                        ].join(' ')}
                        aria-hidden
                    />
                </div>
            </div>

            {/* Top row — frontends */}
            <Row items={side.inputs} />

            {/* Funnel-in (converging Bézier curves) */}
            <Funnel direction="in" count={side.inputs.length} accent={accentWaist} />

            {/* IR waist — the compiler layer (the focal element) */}
            <div
                className={[
                    'relative mx-auto w-[68%] min-w-[180px] rounded-lg border-2 px-5 py-4 text-center transition-shadow',
                    accentWaist
                        ? 'border-accent bg-accentSoft shadow-[0_4px_24px_-12px_rgba(31,95,168,0.45)]'
                        : 'border-ink/25 bg-surface shadow-[0_2px_12px_-6px_rgba(11,15,23,0.18)]',
                ].join(' ')}
            >
                <div
                    className={[
                        'font-mono text-lg font-bold leading-none tracking-wide',
                        accentWaist ? 'text-accent' : 'text-ink',
                    ].join(' ')}
                >
                    {side.waist.primary}
                </div>
                <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                    {side.waist.secondary}
                </div>
            </div>

            {/* Funnel-out */}
            <Funnel direction="out" count={side.outputs.length} accent={accentWaist} />

            {/* Bottom row — backends */}
            <Row items={side.outputs} />

            {side.note && (
                <p className="mt-5 text-center text-[11px] leading-5 text-muted">
                    {side.note}
                </p>
            )}
        </div>
    );
}

function Row({ items }: { items: string[] }) {
    return (
        <div
            className="grid items-stretch gap-2"
            style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
        >
            {items.map((it) => (
                <div
                    key={it}
                    className="rounded-md border border-rule bg-surface px-2 py-2 text-center font-mono text-xs font-medium text-ink shadow-[0_1px_0_rgba(0,0,0,0.02)]"
                >
                    {it}
                </div>
            ))}
        </div>
    );
}

/*
 * Funnel — converging (or diverging) Bézier curves drawn on a fixed
 * viewBox. Curves bend toward the center axis so the connection feels
 * organic rather than blunt. The midpoints are pulled toward the waist
 * (~30 % of the height up/down from the ends) to soften the angles.
 */
function Funnel({
    direction, count, accent,
}: { direction: 'in' | 'out'; count: number; accent: boolean }) {
    const W = 220, H = 38;
    const waistX = W / 2;
    // Distribute fan endpoints evenly, leaving a small inset off the edge
    // so they line up with the chip centers above / below.
    const inset = W / (count * 2);
    const ends = Array.from({ length: count }, (_, i) => inset + i * (W - 2 * inset) / Math.max(count - 1, 1));

    const paths = ends.map((x) => {
        if (direction === 'in') {
            // Top → bottom-center, with a control point pulled toward
            // the waist for a soft S-less arc.
            const c1x = x;
            const c1y = H * 0.55;
            const c2x = waistX + (x - waistX) * 0.25;
            const c2y = H * 0.7;
            return `M ${x} 2 C ${c1x} ${c1y} ${c2x} ${c2y} ${waistX} ${H - 2}`;
        }
        // out: waist → bottom row
        const c1x = waistX + (x - waistX) * 0.25;
        const c1y = H * 0.3;
        const c2x = x;
        const c2y = H * 0.45;
        return `M ${waistX} 2 C ${c1x} ${c1y} ${c2x} ${c2y} ${x} ${H - 2}`;
    });

    return (
        <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className={['my-1.5 h-9 w-full', accent ? 'text-accent/55' : 'text-ink/30'].join(' ')}
            aria-hidden
        >
            {paths.map((d, i) => (
                <path
                    key={i}
                    d={d}
                    stroke="currentColor"
                    strokeWidth="1"
                    fill="none"
                    strokeLinecap="round"
                />
            ))}
            {/* tiny dot at the waist endpoint to anchor the convergence */}
            <circle
                cx={waistX} cy={direction === 'in' ? H - 2 : 2}
                r="1.5" fill="currentColor"
            />
        </svg>
    );
}

// Keep the export name + signature stable for the import in pages/index.tsx.
export type _ = ReactNode;
