/*
 * Two side-by-side hourglass stacks. Mirrors the canonical XLA diagram
 * (frontends → IR waist → backends) and shows the same shape applied to
 * ZK. The IR waist is the only accent-colored element — it's the
 * "compiler in the middle" the whole pitch hangs on.
 *
 * Visual structure (md+):
 *
 *      ML side                            ZK side
 *   ─────────                          ─────────
 *   TF  PT  JAX                        Groth16  zkVM  circom
 *      ↘ ↓ ↙                              ↘ ↓ ↙
 *      ┌──────┐                         ┌────────┐
 *      │ XLA  │  ←  accent              │  ZKX   │  ←  accent
 *      │ HLO  │                         │PrimeIR │
 *      └──────┘                         └────────┘
 *      ↙ ↓ ↘                              ↙ ↓ ↘
 *   CPU GPU TPU                         CPU GPU ASIC
 *
 * Below md the two sides stack vertically.
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
        <div className="rounded-lg border border-rule bg-page p-4 sm:p-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-10">
                <Hourglass side={ML_SIDE} />
                <Hourglass side={ZK_SIDE} accentWaist />
            </div>
            <p className="mt-5 text-xs leading-5 text-muted">
                <span className="font-semibold text-ink">Hourglass shape:</span>{' '}
                many input frameworks converge on a single IR, then fan
                out to multiple hardware targets. The compiler in the
                middle is the value-capture layer — it sees the whole
                graph at once, where a hand-written kernel only sees
                itself.
            </p>
        </div>
    );
}

function Hourglass({ side, accentWaist = false }: { side: Side; accentWaist?: boolean }) {
    return (
        <div className="flex flex-col items-stretch">
            {/* Section title */}
            <div className="mb-3 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
                {side.title}
            </div>

            {/* Top row — frontends fan-in */}
            <Row items={side.inputs} />

            {/* Funnel-in arrows */}
            <Funnel direction="in" />

            {/* IR waist — the compiler layer (single column, accent for ZKX) */}
            <div
                className={[
                    'mx-auto w-[60%] min-w-[160px] rounded border-2 px-4 py-3 text-center',
                    accentWaist
                        ? 'border-accent bg-accentSoft'
                        : 'border-ink/30 bg-surface',
                ].join(' ')}
            >
                <div
                    className={[
                        'font-mono text-base font-bold tracking-wide',
                        accentWaist ? 'text-accent' : 'text-ink',
                    ].join(' ')}
                >
                    {side.waist.primary}
                </div>
                <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                    {side.waist.secondary}
                </div>
            </div>

            {/* Funnel-out arrows */}
            <Funnel direction="out" />

            {/* Bottom row — backends fan-out */}
            <Row items={side.outputs} />

            {side.note && (
                <p className="mt-4 text-center text-[11px] leading-5 text-muted">
                    {side.note}
                </p>
            )}
        </div>
    );
}

function Row({ items }: { items: string[] }) {
    // Equal-width chips so the funnel arrows below land symmetrically.
    return (
        <div
            className="grid items-stretch gap-2"
            style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
        >
            {items.map((it) => (
                <div
                    key={it}
                    className="rounded border border-rule bg-surface px-2 py-2 text-center font-mono text-xs text-ink"
                >
                    {it}
                </div>
            ))}
        </div>
    );
}

/*
 * SVG funnel — a tiny inline triangle of converging (or diverging) lines.
 * Drawn at a fixed viewBox so it scales with the column width without
 * needing measurement of the row above. Stroke matches the page's
 * hairline border color via currentColor on the muted text class.
 */
function Funnel({ direction }: { direction: 'in' | 'out' }) {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const W = 200, H = 28;
    const fanXs = [10, W / 2, W - 10];        // outer-left, center, outer-right
    const waist = W / 2;
    for (const x of fanXs) {
        lines.push(
            direction === 'in'
                ? { x1: x, y1: 2,    x2: waist, y2: H - 2 }
                : { x1: waist, y1: 2, x2: x,    y2: H - 2 }
        );
    }
    return (
        <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="my-1 h-7 w-full text-faint"
            aria-hidden
        >
            {lines.map((l, i) => (
                <line
                    key={i}
                    x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                    stroke="currentColor"
                    strokeWidth="1"
                />
            ))}
        </svg>
    );
}

// Keep the export name + signature stable for the import in pages/index.tsx.
// Underscore-export so unused-export linters don't complain about ReactNode.
export type _ = ReactNode;
