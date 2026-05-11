/*
 * Rosetta-stone table — ML ↔ ZK layer-by-layer correspondence.
 *
 * Different visual idiom from the hero diagram (which is a flow-shaped
 * stack picture of zkx itself). This table answers "why is this the
 * right architecture for ZK" by showing that every layer of the ZK side
 * lines up with an existing, validated layer in the ML compiler stack.
 *
 * The compiler row (XLA / ZKX) is the focal one — that's the value-
 * capture layer of both ecosystems. Accent-colored on the ZK column.
 */
import type { ReactNode } from 'react';

type Row = {
    layer: string;        // left-most label
    ml: ReactNode;        // ML side
    zk: ReactNode;        // ZK side
    accent?: boolean;     // highlight the ZK cell + background tint
};

const ROWS: Row[] = [
    {
        layer: 'frontends',
        ml: 'TensorFlow · PyTorch · JAX',
        zk: 'Groth16 · zkVM · circom',
    },
    {
        layer: 'IR',
        ml: 'StableHLO · HLO',
        zk: 'PrimeIR · StableHLO · HLO',
    },
    {
        layer: 'compiler',
        ml: 'XLA',
        zk: 'ZKX',
        accent: true,
    },
    {
        layer: 'backends',
        ml: 'CPU · GPU · TPU',
        zk: 'CPU · GPU · ASIC',
    },
    {
        layer: 'bottleneck',
        ml: <span className="text-muted">memory-bound</span>,
        zk: <span className="text-muted">memory-bound</span>,
    },
    {
        layer: 'manual cost (no compiler)',
        ml: <span className="text-muted">N × M hand-tuned kernels</span>,
        zk: <span className="text-muted">N × M hand-tuned provers</span>,
    },
];

export function HowItWorksDiagram() {
    return (
        <div className="overflow-hidden rounded-xl border border-rule bg-page">
            {/* Header band — column titles */}
            <div className="grid grid-cols-[140px_1fr_1fr] border-b border-rule bg-surface/60">
                <HeaderCell />
                <HeaderCell label="ML — today" />
                <HeaderCell label="ZK — with ZKX" accent />
            </div>

            {/* Body rows */}
            <div role="table" aria-label="ML ↔ ZK layer correspondence">
                {ROWS.map((row, i) => (
                    <BodyRow key={row.layer} row={row} last={i === ROWS.length - 1} />
                ))}
            </div>
        </div>
    );
}

function HeaderCell({ label, accent = false }: { label?: string; accent?: boolean }) {
    return (
        <div
            className={[
                'px-5 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em]',
                accent ? 'text-accent' : 'text-faint',
            ].join(' ')}
        >
            {label ?? ''}
        </div>
    );
}

function BodyRow({ row, last }: { row: Row; last: boolean }) {
    return (
        <div
            role="row"
            className={[
                'grid grid-cols-[140px_1fr_1fr] items-center',
                last ? '' : 'border-b border-rule',
                row.accent ? 'bg-accentSoft/60' : 'bg-page',
            ].join(' ')}
        >
            {/* layer label */}
            <div className="px-5 py-4 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
                {row.layer}
            </div>

            {/* ML cell */}
            <div className="border-l border-rule px-5 py-4 font-mono text-sm text-ink">
                {row.ml}
            </div>

            {/* ZK cell — accent variant gets bold + accent color */}
            <div
                className={[
                    'border-l border-rule px-5 py-4 font-mono text-sm',
                    row.accent ? 'font-bold text-accent' : 'text-ink',
                ].join(' ')}
            >
                {row.zk}
            </div>
        </div>
    );
}
