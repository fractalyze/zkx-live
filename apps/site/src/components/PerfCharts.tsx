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

type SchemeRow = {
    id: string;
    family: string;
    workload: string; // setup/context: field · device · degree · baseline source
    baseline: string;
    zkx: string;
    speedup: string;
    status: 'strong' | 'good' | 'watch';
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

const PRIMITIVE_SCHEMES: Scheme[] = [
    {
        id: 'fft22-gnark',
        label: 'FFT',
        chart: {
            title: 'Primitive · vs Gnark baseline',
            sub: 'rabbitsnark-py · bn254 · gpu · degree 22',
            baseline: { name: 'Gnark baseline', ms: 28.334, valueText: '28.334 ms' },
            zkx: { ms: 1.997, valueText: '1.997 ms' },
            speedup: '14.2×',
            scaleMax: '30 ms',
            scaleMid: '15 ms',
        },
    },
    {
        id: 'ifft22-gnark',
        label: 'IFFT',
        chart: {
            title: 'Primitive · vs Gnark baseline',
            sub: 'rabbitsnark-py · bn254 · gpu · degree 22',
            baseline: { name: 'Gnark baseline', ms: 28.835, valueText: '28.835 ms' },
            zkx: { ms: 2.066, valueText: '2.066 ms' },
            speedup: '14.0×',
            scaleMax: '30 ms',
            scaleMid: '15 ms',
        },
    },
    {
        id: 'msm22-gnark',
        label: 'MSM',
        chart: {
            title: 'Primitive · vs Gnark baseline',
            sub: 'rabbitsnark-py · bn254 · gpu · degree 22',
            baseline: { name: 'Gnark baseline', ms: 56.380, valueText: '56.380 ms' },
            zkx: { ms: 29.835, valueText: '29.835 ms' },
            speedup: '1.9×',
            scaleMax: '60 ms',
            scaleMid: '30 ms',
        },
    },
    {
        id: 'smcs22-sp1',
        label: 'SMCS',
        chart: {
            title: 'Primitive · vs SP1 baseline',
            sub: 'whir-zorch · koalabear · gpu · degree 20',
            baseline: { name: 'SP1 baseline', ms: 1.736, valueText: '1.736 ms' },
            zkx: { ms: 1.321, valueText: '1.321 ms' },
            speedup: '1.3×',
            scaleMax: '2 ms',
            scaleMid: '1 ms',
        },
    },
    {
        id: 'logupgkr22-sp1',
        label: 'LOGUP GKR',
        chart: {
            title: 'Primitive · vs SP1 baseline',
            sub: 'whir-zorch · koalabear · gpu · degree 22 · total',
            baseline: { name: 'SP1 baseline', ms: 108.394, valueText: '108.394 ms' },
            zkx: { ms: 38.438, valueText: '38.438 ms' },
            speedup: '2.8×',
            scaleMax: '110 ms',
            scaleMid: '55 ms',
        },
    },
];

const PRIMITIVE_ROWS: SchemeRow[] = [
    { id: 'fft22-gnark', family: 'FFT', workload: 'bn254 · gpu · d22 · Gnark', baseline: '28.334 ms', zkx: '1.997 ms', speedup: '14.2×', status: 'strong' },
    { id: 'ifft22-gnark', family: 'IFFT', workload: 'bn254 · gpu · d22 · Gnark', baseline: '28.835 ms', zkx: '2.066 ms', speedup: '14.0×', status: 'strong' },
    { id: 'msm22-gnark', family: 'MSM', workload: 'bn254 · gpu · d22 · Gnark', baseline: '56.380 ms', zkx: '29.835 ms', speedup: '1.9×', status: 'good' },
    { id: 'smcs22-sp1', family: 'SMCS', workload: 'koalabear · gpu · d20 · SP1', baseline: '1.736 ms', zkx: '1.321 ms', speedup: '1.3×', status: 'good' },
    { id: 'logupgkr22-sp1', family: 'LOGUP GKR', workload: 'koalabear · gpu · d22 · SP1', baseline: '108.394 ms', zkx: '38.438 ms', speedup: '2.8×', status: 'strong' },
];

/* Application-level baselines — keep around for legacy table fallback,
 * but the BaselineSnapshots component below renders its own richer card
 * data so these rows are no longer load-bearing. */
const GNARK_ROWS: SchemeRow[] = [
    { id: 'groth16-prove-gnark', family: 'GROTH16 PROVE', workload: 'application proof generation', baseline: '4.90 s', zkx: '2.49 s', speedup: '2.0×', status: 'good' },
];

const ZKVM_ROWS: SchemeRow[] = [
    { id: 'sp1-block-proof', family: 'SP1 BLOCK PROOF', workload: 'zkVM block proof', baseline: '10.3 s', zkx: '7.0 s', speedup: '1.5×', status: 'good' },
];

type AppBaseline = {
    family: string;             // headline category
    speedup: string;            // big number
    baselineName: string;       // "Gnark + ICICLE", "SP1 Hypercube"
    baselineWho: string;        // 1-2 sentence "who they are / why they matter"
    baselineMs: number;
    baselineText: string;
    zkxMs: number;
    zkxText: string;
    workload: string;           // "SP1 STARK verifier · ~5–6M constraints · BN254 · RTX 5090"
    quote?: { text: string; attrib: string; href: string };  // industry "fastest" claim
};

const APP_BASELINES: AppBaseline[] = [
    {
        family: 'Groth16 prove',
        speedup: '~2×',
        baselineName: 'Gnark + ICICLE',
        baselineWho:
            'Production GPU Groth16 stack — Gnark (Consensys) wrapping Ingonyama\'s ICICLE GPU primitives. ' +
            'What every SP1 mainnet deployment uses today for the STARK→SNARK wrapping step.',
        baselineMs: 4900,
        baselineText: '4.90 s',
        zkxMs: 2490,
        zkxText: '2.49 s',
        workload: 'SP1 STARK verifier in Groth16 · ~5–6M constraints · BN254 · RTX 5090',
        quote: {
            text: '"ICICLE-snark is now the fastest Groth16 prover implementation"',
            attrib: 'Ingonyama, Mar 2025',
            href: 'https://medium.com/@ingonyama/icicle-snark-the-fastest-groth16-implementation-in-the-world-00901b39a21f',
        },
    },
    {
        family: 'zkVM block proof',
        speedup: '~1.5×',
        baselineName: 'SP1 Hypercube',
        baselineWho:
            'Succinct Labs\' current production prover for SP1. SP1 Hypercube currently holds the fastest ' +
            'end-to-end block proof latency in zkVM block proving.',
        baselineMs: 10300,
        baselineText: '10.30 s',
        zkxMs: 7000,
        zkxText: '7.00 s',
        workload: 'Ethereum mainnet block proving · target block 22,309,250 · RTX 5090',
    },
];

export function PerfCharts() {
    const [activeId, setActiveId] = useState(PRIMITIVE_SCHEMES[0].id);
    const active = PRIMITIVE_SCHEMES.find((s) => s.id === activeId) ?? PRIMITIVE_SCHEMES[0];

    return (
        <div>
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                Primitive kernels
            </div>
            <SchemeTabs
                items={PRIMITIVE_SCHEMES}
                activeId={activeId}
                onSelect={setActiveId}
            />
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <MetricCard label="Best zkx" value={active.chart.zkx.valueText} tone="accent" />
                <MetricCard label="Baseline" value={active.chart.baseline.valueText} />
            </div>
            <div className="mt-5">
                <Chart key={activeId} spec={active.chart} />
            </div>
            <div className="mt-8">
                <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                    Scheme comparison
                </div>
                <SchemeCatalog title="Primitive kernels" rows={PRIMITIVE_ROWS} />
            </div>


        </div>
    );
}

/* ---------- tabs ---------- */

export function BaselineSnapshots() {
    return (
        <section>
            {/* Lede — establishes the framing before the cards land */}
            <p className="mb-6 max-w-3xl text-base leading-7 text-ink2">
                The two provers the ZK industry currently calls fastest in
                their categories. ZKX is faster than both — same workload,
                same hardware, no protocol changes.
            </p>
            <div className="grid gap-5 lg:grid-cols-2">
                {APP_BASELINES.map((b) => (
                    <BaselineCard key={b.family} b={b} />
                ))}
            </div>
        </section>
    );
}

function BaselineCard({ b }: { b: AppBaseline }) {
    const zkxPct = (b.zkxMs / b.baselineMs) * 100;
    const savedMs = b.baselineMs - b.zkxMs;
    const savedText = savedMs >= 1000
        ? `${(savedMs / 1000).toFixed(2)} s saved`
        : `${Math.round(savedMs)} ms saved`;

    return (
        <article className="flex flex-col rounded-md border-2 border-accent/40 bg-page p-6">
            {/* Header row — category on left, big speedup on right */}
            <header className="flex items-start justify-between gap-4">
                <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
                        {b.family}
                    </div>
                    <div className="mt-2 font-mono text-sm text-ink">
                        vs <span className="font-semibold">{b.baselineName}</span>
                    </div>
                </div>
                <div className="text-right">
                    <div className="font-mono text-5xl font-semibold leading-none tabular text-accent">
                        {b.speedup}
                    </div>
                    <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                        faster
                    </div>
                </div>
            </header>

            {/* Who the baseline is — the load-bearing context */}
            <p className="mt-4 text-sm leading-6 text-ink2">{b.baselineWho}</p>

            {/* Mini bar comparison — visual proof of the gap */}
            <div className="mt-5 space-y-3">
                <BarRow
                    label={b.baselineName}
                    valueText={b.baselineText}
                    widthPct={100}
                    delayMs={120}
                    muted
                />
                <BarRow
                    label="zkx"
                    valueText={b.zkxText}
                    widthPct={zkxPct}
                    delayMs={520}
                    accent
                    emphasizeValue
                />
                <div className="flex items-center justify-end gap-2 font-mono text-[11px] text-ok">
                    <span>↳ {savedText}</span>
                </div>
            </div>

            {/* Workload row — provenance line */}
            <div className="mt-4 rounded border border-rule bg-surface px-3 py-2 font-mono text-[11px] text-muted">
                {b.workload}
            </div>

            {/* Industry "fastest" claim, if applicable — competitor context */}
            {b.quote && (
                <blockquote className="mt-4 border-l-2 border-accent/50 pl-4 text-sm leading-6 text-ink2">
                    <div className="italic">{b.quote.text}</div>
                    <div className="mt-1 font-mono text-[11px] text-faint">
                        —{' '}
                        <a
                            href={b.quote.href}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent underline-offset-2 hover:underline"
                        >
                            {b.quote.attrib}
                        </a>
                    </div>
                </blockquote>
            )}
        </article>
    );
}

function SchemeTabs({
    items, activeId, onSelect,
}: {
    items: Scheme[];
    activeId: string;
    onSelect: (id: string) => void;
}) {
    return (
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
    );
}

function MetricCard({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone?: 'accent' | 'ok';
}) {
    const valueTone = tone === 'ok' ? 'text-ok' : tone === 'accent' ? 'text-accent' : 'text-ink';
    return (
        <div className="rounded-md border border-rule bg-page p-3">
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">{label}</div>
            <div className={`mt-1 font-mono text-2xl font-semibold tabular ${valueTone}`}>{value}</div>
        </div>
    );
}

function SchemeCatalog({ title, rows }: { title: string; rows: SchemeRow[] }) {
    const toneClass: Record<SchemeRow['status'], string> = {
        strong: 'text-ok',
        good: 'text-accent',
        watch: 'text-warn',
    };

    return (
        <section className="mt-8 rounded-md border border-rule bg-page p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="font-mono text-xs uppercase tracking-[0.14em] text-muted">
                    {title}
                </div>
                <div className="font-mono text-xs text-faint">{rows.length} schemes listed</div>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                    <thead>
                        <tr className="border-b border-rule text-left font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
                            <th className="px-2 py-2">Family</th>
                            <th className="px-2 py-2">Setup</th>
                            <th className="px-2 py-2">Baseline</th>
                            <th className="px-2 py-2">zkx</th>
                            <th className="px-2 py-2">Speedup</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.id} className="border-b border-rule/70">
                                <td className="px-2 py-2 font-mono text-xs text-ink">{row.family}</td>
                                <td className="px-2 py-2 text-ink2">{row.workload}</td>
                                <td className="px-2 py-2 font-mono tabular text-muted">{row.baseline}</td>
                                <td className="px-2 py-2 font-mono tabular font-semibold text-accent">{row.zkx}</td>
                                <td className="px-2 py-2 font-mono tabular font-semibold text-ink">{row.speedup}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function BaselineGroupCard({
    title,
    rows,
}: {
    title: string;
    rows: SchemeRow[];
}) {
    return (
        <article className="rounded-md border border-accent/30 bg-page p-4">
            <div className="font-mono text-xs uppercase tracking-[0.14em] text-accent">{title}</div>
            <div className="mt-4 space-y-2">
                {rows.map((row) => (
                    <div key={row.id} className="rounded border border-rule/70 bg-surface px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                            <div className="font-mono text-xs text-ink">{row.family}</div>
                            <div className="font-mono text-xs font-semibold text-accent">{row.speedup}</div>
                        </div>
                        <div className="mt-1 text-[11px] text-faint">{row.workload}</div>
                        <div className="mt-1 font-mono text-[11px] text-muted">zkx {row.zkx} / baseline {row.baseline}</div>
                    </div>
                ))}
            </div>
        </article>
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
