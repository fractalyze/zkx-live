/*
 * Performance — tabbed by proving scheme. Each scheme shows ONE chart:
 * the SOTA / current best baseline for that scheme vs zkx.
 *
 * Adding a new scheme = push one entry into SCHEMES.
 *
 * Hand-rolled SVG bars. No chart library.
 */
import { useEffect, useState } from 'react';

const ACCENT = '#1f5fa8';

type Scheme = {
    id: string;
    label: string;
    chart: ChartSpec;
};

type ChartSpec = {
    title: string;       // e.g. "vs Gnark"
    sub: string;         // workload description
    baseline: { name: string; ms: number; valueText: string };
    zkx:      {           ms: number; valueText: string };
    speedup: string;     // "~2×"
    scaleMax: string;
    scaleMid: string;
    note?: string;
    realTimeCallout?: { headline: string; body: string };
};

/* Add a new scheme by pushing to this list — UI updates automatically. */
const SCHEMES: Scheme[] = [
    {
        id: 'groth16',
        label: 'Groth16',
        chart: {
            title: 'vs Gnark + ICICLE',
            sub: 'SP1 STARK verifier in Groth16 · ~5–6M constraints · RTX 5090',
            baseline: { name: 'Gnark + ICICLE', ms: 4900, valueText: '4.90 s' },
            zkx:      {                         ms: 2490, valueText: '2.49 s' },
            speedup: '~2×',
            scaleMax: '5 s',
            scaleMid: '2.5 s',
            note: 'Apples-to-apples: same circuit, same hardware. Baseline is Gnark prover with ICICLE GPU primitives — the industry-standard accelerated Groth16 stack. The SP1 verifier circuit is the canonical "STARK→SNARK" wrapper used by every SP1 onchain deployment.',
            realTimeCallout: {
                headline: 'What "real-time" means',
                body: 'At ~5–6M constraints, zkx generates a Groth16 proof in 2.49 s on a single RTX 5090. At the more typical ~2M constraints production circuits use, the same hardware lands under one second per proof — fast enough that user-triggered actions (claim, vote, verify) can request a fresh proof on every interaction without showing a loading state.',
            },
        },
    },
    {
        id: 'zkvm',
        label: 'zkVM',
        chart: {
            title: 'vs SP1',
            sub: 'zkVM block proving',
            baseline: { name: 'SP1', ms: 10300, valueText: '10.30 s' },
            zkx:      {              ms:  7000, valueText:  '7.00 s' },
            speedup: '~1.5×',
            scaleMax: '10 s',
            scaleMid: '5 s',
        },
    },
    // ↓ add more schemes here, e.g.
    // { id: 'plonk', label: 'PLONK', chart: { title: 'vs ...', baseline: {...}, zkx: {...}, ... } },
];

export function PerfCharts() {
    const [activeId, setActiveId] = useState(SCHEMES[0].id);
    const active = SCHEMES.find(s => s.id === activeId) ?? SCHEMES[0];

    return (
        <div>
            <SchemeTabs items={SCHEMES} activeId={activeId} onSelect={setActiveId} />
            <div className="mt-5">
                {/* key on activeId so the chart remounts on tab switch and
                    bars re-animate from 0 every time */}
                <Chart key={activeId} spec={active.chart} />
            </div>
        </div>
    );
}

/* ---------- tabs ---------- */

function SchemeTabs({
    items, activeId, onSelect,
}: {
    items: Scheme[];
    activeId: string;
    onSelect: (id: string) => void;
}) {
    return (
        <div>
            <div className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                Scheme
            </div>
            <div role="tablist" className="flex flex-wrap gap-2">
                {items.map(s => {
                    const isActive = s.id === activeId;
                    return (
                        <button
                            key={s.id}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            onClick={() => onSelect(s.id)}
                            className={
                                'rounded-md border-2 px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-[0.1em] transition-colors ' +
                                (isActive
                                    ? 'border-accent bg-accent text-white shadow-sm'
                                    : 'border-ink/15 bg-page text-ink hover:border-accent hover:text-accent')
                            }
                        >
                            {s.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/* ---------- chart ---------- */

function Chart({ spec }: { spec: ChartSpec }) {
    const longPct = 100;
    const shortRaw = (spec.zkx.ms / spec.baseline.ms) * 100;
    // Floor extremely small bars so they remain visually present.
    const shortPct = Math.max(shortRaw, 1.6);

    return (
        <div>
            <figure className="rounded-md border border-rule bg-page p-6">
                <header className="mb-5 flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-ink">
                            {spec.title}
                        </h3>
                        <p className="mt-1 font-mono text-xs text-faint">{spec.sub}</p>
                    </div>
                    <div className="text-right">
                        <div className="font-mono text-4xl font-semibold leading-none tabular text-accent">
                            {spec.speedup}
                        </div>
                        <div className="mt-1 font-mono text-xs uppercase tracking-[0.08em] text-muted">
                            faster
                        </div>
                    </div>
                </header>
                <div className="space-y-4">
                    {/* baseline animates first, zkx staggered after for emphasis */}
                    <BarRow
                        label={spec.baseline.name}
                        valueText={spec.baseline.valueText}
                        widthPct={longPct}
                        delayMs={120}
                        muted
                    />
                    <BarRow
                        label="zkx"
                        valueText={spec.zkx.valueText}
                        widthPct={shortPct}
                        delayMs={520}
                        accent
                        emphasizeValue
                    />
                    <Scale max={spec.scaleMax} mid={spec.scaleMid} min="0" />
                    {spec.note && (
                        <p className="mt-3 text-xs leading-5 text-muted">{spec.note}</p>
                    )}
                </div>
            </figure>

            {spec.realTimeCallout && (
                <aside className="mt-6 flex flex-col gap-4 rounded-md border-l-2 border-accent bg-page p-6 sm:flex-row sm:items-start sm:gap-6">
                    <div className="font-mono text-xs uppercase tracking-[0.14em] text-accent sm:w-32 sm:flex-none">
                        {spec.realTimeCallout.headline}
                    </div>
                    <p className="text-sm leading-6 text-ink2">
                        {spec.realTimeCallout.body}
                    </p>
                </aside>
            )}
        </div>
    );
}

function BarRow({
    label, valueText, widthPct, accent, muted, emphasizeValue, delayMs = 0,
}: {
    label: string;
    valueText: string;
    widthPct: number;
    accent?: boolean;
    muted?: boolean;
    emphasizeValue?: boolean;
    delayMs?: number;
}) {
    // Animate from 0 → widthPct on mount. Component is keyed by tab in
    // PerfCharts so it remounts (and re-animates) on every scheme switch.
    const [w, setW] = useState(0);
    useEffect(() => {
        const t = setTimeout(() => setW(widthPct), delayMs);
        return () => clearTimeout(t);
    }, [widthPct, delayMs]);

    return (
        <div>
            <div className="mb-1.5 flex items-baseline justify-between font-mono text-xs">
                <span className={muted ? 'text-muted' : 'text-ink'}>{label}</span>
                <span
                    className={
                        emphasizeValue
                            ? 'text-sm font-semibold tabular text-accent'
                            : 'tabular text-muted'
                    }
                >
                    {valueText}
                </span>
            </div>
            <div className="relative h-7 w-full overflow-hidden rounded-sm bg-surface">
                <div
                    className="h-full"
                    style={{
                        width: `${w}%`,
                        backgroundColor: accent ? ACCENT : '#cbd5e1',
                        transition: 'width 900ms cubic-bezier(0.22, 1, 0.36, 1)',
                    }}
                />
            </div>
        </div>
    );
}

function Scale({ max, mid, min }: { max: string; mid: string; min: string }) {
    return (
        <div className="mt-1 flex items-center justify-between font-mono text-[10.5px] text-faint">
            <span>{min}</span>
            <span className="opacity-70">{mid}</span>
            <span>{max}</span>
        </div>
    );
}
