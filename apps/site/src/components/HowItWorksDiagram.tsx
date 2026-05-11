/*
 * Side-by-side comparison: ZK proving today (no compiler) vs ZK with
 * ZKX. Each row picks one dimension where the contrast is sharpest —
 * the "with ZKX" column should read as the obviously-better option to
 * a ZK-native who has never seen XLA.
 *
 * The compiler row (the value-capture layer) is accent-tinted on the
 * ZKX side. A small footer line points at XLA as a precedent for the
 * same shape — useful context if the reader knows ML, harmless if not.
 */
import type { ReactNode } from 'react';

type Row = {
    layer: string;
    today: ReactNode;
    zkx: ReactNode;
    accent?: boolean;
};

const ROWS: Row[] = [
    {
        layer: 'frontends',
        today: (
            <span>
                <span className="text-muted">per scheme, isolated —</span> Groth16, zkVM, circom each ship their own prover
            </span>
        ),
        zkx: (
            <span>
                Unified ingest — Groth16, zkVM, circom feed the same pipeline
            </span>
        ),
    },
    {
        layer: 'IR',
        today: <span className="text-muted">None — each prover has its own internals</span>,
        zkx: <span>PrimeIR · StableHLO · HLO</span>,
    },
    {
        layer: 'compiler',
        today: <span className="text-muted">None — kernels are written by hand</span>,
        zkx: <span>ZKX — whole-graph fusion, layout, scheduling</span>,
        accent: true,
    },
    {
        layer: 'optimization cost',
        today: (
            <span>
                <span className="text-muted">N × M</span> hand-tuned implementations (per scheme × hardware)
            </span>
        ),
        zkx: (
            <span>
                <span className="text-muted">N + M</span> — add a frontend or backend, the cross is automated
            </span>
        ),
    },
    {
        layer: 'backends',
        today: <span className="text-muted">Per-prover (Gnark → CPU, ICICLE → GPU, SP1 → GPU, …)</span>,
        zkx: <span>CPU · GPU · ASIC (one compiler, any target)</span>,
    },
    {
        layer: 'memory bound',
        today: <span className="text-muted">tuned by hand, kernel by kernel</span>,
        zkx: <span className="text-muted">tuned by the compiler, end-to-end</span>,
    },
];

export function HowItWorksDiagram() {
    return (
        <div className="overflow-hidden rounded-xl border border-rule bg-page">
            {/* Header band */}
            <div className="grid grid-cols-[140px_1fr_1fr] border-b border-rule bg-surface/60">
                <HeaderCell />
                <HeaderCell label="ZK — today" />
                <HeaderCell label="ZK — with ZKX" accent />
            </div>

            {/* Body rows */}
            <div role="table" aria-label="ZK proving without and with ZKX">
                {ROWS.map((row, i) => (
                    <BodyRow key={row.layer} row={row} last={i === ROWS.length - 1} />
                ))}
            </div>

            {/* Footer — soft XLA precedent line for readers who know ML */}
            <div className="border-t border-rule bg-surface/40 px-5 py-3 text-center font-mono text-[11px] text-faint">
                ML hit the same pattern around 2017 — XLA solved it there.
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
                'grid grid-cols-[140px_1fr_1fr] items-start',
                last ? '' : 'border-b border-rule',
                row.accent ? 'bg-accentSoft/60' : 'bg-page',
            ].join(' ')}
        >
            <div className="px-5 py-4 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
                {row.layer}
            </div>
            <div className="border-l border-rule px-5 py-4 font-mono text-sm leading-6 text-ink">
                {row.today}
            </div>
            <div
                className={[
                    'border-l border-rule px-5 py-4 font-mono text-sm leading-6',
                    row.accent ? 'font-bold text-accent' : 'text-ink',
                ].join(' ')}
            >
                {row.zkx}
            </div>
        </div>
    );
}
