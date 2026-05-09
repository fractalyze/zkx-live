/*
 * Hero diagram — the centerpiece of the page.
 *
 * Reads top to bottom:
 *
 *   [ circom circuit ]   [ zkVM ]   [ custom circuit ]
 *           \              |              /
 *            \             |             /
 *           ┌───────────────────────────────┐
 *           │            zkx                │
 *           │   ┌───────────────────────┐   │
 *           │   │      PrimeIR (MLIR)   │   │
 *           │   └───────────────────────┘   │
 *           │  algebraic rewrite · fusion   │
 *           │       layout assignment       │
 *           └───────────────────────────────┘
 *              |             |             |
 *           [ CPU ]       [ GPU ]    [ ZK ASIC* ]
 *                                       (future)
 *
 *                    ──>  Real-time proof
 *                         1.66M constraints in 242 ms
 *
 * Style: schematic, hairline 1px strokes, JetBrains Mono labels,
 * monochrome with one accent (the zkx core box and the proof callout).
 * Uses currentColor so it inherits theme color cleanly.
 *
 * Sized for two breakpoints:
 *   - mobile: SVG scales to 100% width, ~520px tall
 *   - desktop: SVG scales to ~880px wide, ~480px tall
 */
export function HeroDiagram() {
    const W = 880;
    const H = 480;
    const accent = '#1f5fa8';

    // Layout constants — single source of truth so every row aligns.
    // Content is constrained to [contentX, W - rightMargin]; lane labels
    // get a generous gutter on the left so they don't crowd the rects.
    const contentX = 140;
    const rightMargin = 40;
    const contentW = W - contentX - rightMargin;     // 700
    const boxW = 168;
    const colGap = (contentW - 3 * boxW) / 2;        // 98
    const colXs = [0, 1, 2].map(i => contentX + i * (boxW + colGap));

    // Sources row
    const sourceY = 24;
    const sourceH = 60;
    const sources = [
        { label: 'circom',         sub: 'arithmetic circuit', icon: 'code' as const },
        { label: 'zkVM',           sub: 'RISC-V trace',       icon: 'cube' as const },
        { label: 'custom circuit', sub: 'user-defined',       icon: 'gear' as const },
    ];

    // zkx core box — spans the full content width so the grid feels uniform.
    const coreX = contentX;
    const coreY = 158;
    const coreW = contentW;
    const coreH = 168;

    // Inner PrimeIR box — same 16px gutter as everything else, doubled.
    const innerPad = 32;
    const irX = coreX + innerPad;
    const irY = coreY + 40;
    const irW = coreW - innerPad * 2;
    const irH = 52;

    // Backends row
    const backendY = 384;
    const backendH = 56;
    const backends = [
        { label: 'CPU',     sub: 'AVX-512',     dim: false },
        { label: 'GPU',     sub: 'CUDA',        dim: false },
        { label: 'ZK ASIC', sub: 'planned',     dim: true  },
    ];

    return (
        <figure className="mt-2">
            <svg
                viewBox={`0 0 ${W} ${H}`}
                role="img"
                aria-label="zkx compiler stack: circom, zkVM, and custom circuits flow into the zkx core (PrimeIR plus optimization passes), which lowers to CPU, GPU, and future ZK ASIC backends to produce real-time proofs"
                className="block w-full text-ink"
            >
                <defs>
                    <marker
                        id="hd-arrow"
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="7"
                        markerHeight="7"
                        orient="auto-start-reverse"
                    >
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" opacity="0.6" />
                    </marker>
                    <marker
                        id="hd-arrow-accent"
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="8"
                        markerHeight="8"
                        orient="auto-start-reverse"
                    >
                        <path d="M 0 0 L 10 5 L 0 10 z" fill={accent} />
                    </marker>
                </defs>

                {/* Lane labels (left margin) — vertically centered with each row */}
                <text x={24} y={sourceY  + sourceH  / 2 + 4} className="fill-current font-mono" fontSize="10" opacity="0.4" letterSpacing="0.12em">INPUT</text>
                <text x={24} y={coreY    + coreH    / 2 + 4} className="fill-current font-mono" fontSize="10" opacity="0.4" letterSpacing="0.12em">COMPILER</text>
                <text x={24} y={backendY + backendH / 2 + 4} className="fill-current font-mono" fontSize="10" opacity="0.4" letterSpacing="0.12em">HARDWARE</text>

                {/* --- Sources --- */}
                {sources.map((s, i) => (
                    <SourceBox
                        key={i}
                        x={colXs[i]}
                        y={sourceY}
                        w={boxW}
                        h={sourceH}
                        label={s.label}
                        sub={s.sub}
                        icon={s.icon}
                    />
                ))}

                {/* --- Source-to-core arrows (converging) --- */}
                {sources.map((_, i) => (
                    <Arrow
                        key={`sa${i}`}
                        x1={colXs[i] + boxW / 2}
                        y1={sourceY + sourceH}
                        x2={colXs[i] + boxW / 2}
                        y2={coreY}
                    />
                ))}

                {/* --- zkx core box (accent) --- */}
                <rect
                    x={coreX} y={coreY} width={coreW} height={coreH}
                    rx={6} ry={6}
                    stroke={accent}
                    strokeWidth={1.5}
                    fill="#f4f8fd"
                />
                {/* zkx label, top-left corner — 16px gutter from rect edge */}
                <text
                    x={coreX + 16} y={coreY + 24}
                    className="font-mono"
                    fill={accent}
                    fontSize="14"
                    fontWeight="600"
                    letterSpacing="0.04em"
                >
                    zkx
                </text>
                <text
                    x={coreX + 48} y={coreY + 24}
                    className="font-mono"
                    fill={accent}
                    fontSize="11"
                    opacity="0.55"
                >
                    optimization compiler
                </text>

                {/* PrimeIR inner box — single line, no busy subtitle */}
                <rect
                    x={irX} y={irY} width={irW} height={irH}
                    rx={4} ry={4}
                    stroke={accent}
                    strokeWidth={1}
                    fill="#ffffff"
                />
                <text
                    x={irX + irW / 2} y={irY + irH / 2 + 5}
                    textAnchor="middle"
                    className="font-mono"
                    fill={accent}
                    fontSize="15"
                    fontWeight="600"
                >
                    PrimeIR · MLIR dialect
                </text>

                {/* Pass labels — uniform width, evenly distributed across inner width */}
                {(() => {
                    const passes = ['algebraic rewrite', 'kernel fusion', 'layout assignment', 'lowering'];
                    const N = passes.length;
                    const innerLeft = irX;
                    const innerW = irW;
                    const chipW = 128;            // uniform width for every chip
                    const gap = (innerW - N * chipW) / (N - 1);
                    return passes.map((label, i) => (
                        <PassChip
                            key={label}
                            x={innerLeft + i * (chipW + gap)}
                            y={irY + irH + 18}
                            w={chipW}
                            label={label}
                        />
                    ));
                })()}

                {/* --- Core-to-backend arrows --- */}
                {backends.map((b, i) => (
                    <Arrow
                        key={`ba${i}`}
                        x1={colXs[i] + boxW / 2}
                        y1={coreY + coreH}
                        x2={colXs[i] + boxW / 2}
                        y2={backendY}
                        dim={b.dim}
                    />
                ))}

                {/* --- Backends --- */}
                {backends.map((b, i) => (
                    <BackendBox
                        key={`b${i}`}
                        x={colXs[i]}
                        y={backendY}
                        w={boxW}
                        h={backendH}
                        label={b.label}
                        sub={b.sub}
                        dim={b.dim}
                    />
                ))}
            </svg>

        </figure>
    );
}

/* ----------------- sub-components ----------------- */

function SourceBox({
    x, y, w, h, label, sub, icon,
}: {
    x: number; y: number; w: number; h: number;
    label: string; sub: string; icon: 'code' | 'cube' | 'gear';
}) {
    // Padding: 16px from rect edge to icon, 8px between icon (20px wide) and text.
    const PAD = 16;
    const ICON = 20;
    const textX = x + PAD + ICON + 8;   // = x + 44
    return (
        <g>
            <rect
                x={x} y={y} width={w} height={h}
                rx={4} ry={4}
                stroke="currentColor"
                strokeOpacity={0.4}
                strokeWidth={1}
                fill="#ffffff"
            />
            <g transform={`translate(${x + PAD} ${y + h / 2 - 10})`} opacity={0.65}>
                <Icon name={icon} />
            </g>
            <text
                x={textX} y={y + h / 2 - 3}
                className="fill-current font-mono"
                fontSize="13"
                fontWeight="600"
            >
                {label}
            </text>
            <text
                x={textX} y={y + h / 2 + 13}
                className="fill-current font-mono"
                fontSize="10.5"
                opacity="0.55"
            >
                {sub}
            </text>
        </g>
    );
}

function BackendBox({
    x, y, w, h, label, sub, dim,
}: {
    x: number; y: number; w: number; h: number;
    label: string; sub: string; dim: boolean;
}) {
    return (
        <g opacity={dim ? 0.45 : 1}>
            <rect
                x={x} y={y} width={w} height={h}
                rx={4} ry={4}
                stroke="currentColor"
                strokeOpacity={0.45}
                strokeWidth={1}
                strokeDasharray={dim ? '4 3' : undefined}
                fill="#ffffff"
            />
            <text
                x={x + w / 2} y={y + h / 2 - 3}
                textAnchor="middle"
                className="fill-current font-mono"
                fontSize="13"
                fontWeight="600"
            >
                {label}
            </text>
            <text
                x={x + w / 2} y={y + h / 2 + 13}
                textAnchor="middle"
                className="fill-current font-mono"
                fontSize="10.5"
                opacity="0.55"
            >
                {sub}
            </text>
        </g>
    );
}

function PassChip({ x, y, w, label }: { x: number; y: number; w: number; label: string }) {
    return (
        <g>
            <rect
                x={x} y={y} width={w} height={22}
                rx={3} ry={3}
                fill="#ffffff"
                stroke="#1f5fa8"
                strokeOpacity={0.35}
                strokeWidth={1}
            />
            <text
                x={x + w / 2} y={y + 15}
                textAnchor="middle"
                className="font-mono"
                fill="#1f5fa8"
                fontSize="10"
                opacity="0.85"
            >
                {label}
            </text>
        </g>
    );
}

function Arrow({
    x1, y1, x2, y2, dim,
}: { x1: number; y1: number; x2: number; y2: number; dim?: boolean }) {
    return (
        <line
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="currentColor"
            strokeWidth={1}
            strokeOpacity={dim ? 0.25 : 0.5}
            strokeDasharray={dim ? '3 3' : undefined}
            markerEnd="url(#hd-arrow)"
        />
    );
}

function Icon({ name }: { name: 'code' | 'cube' | 'gear' }) {
    // 20x20 viewport, hairline strokes
    if (name === 'code') {
        return (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 6 2 10 6 14" />
                <polyline points="14 6 18 10 14 14" />
                <line x1="11" y1="4" x2="9" y2="16" />
            </svg>
        );
    }
    if (name === 'cube') {
        return (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="10 2 17 6 17 14 10 18 3 14 3 6" />
                <line x1="10" y1="2" x2="10" y2="10" />
                <line x1="10" y1="10" x2="17" y2="6" />
                <line x1="10" y1="10" x2="3" y2="6" />
            </svg>
        );
    }
    // gear
    return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="10" cy="10" r="3" />
            <path d="M10 1.5 V4 M10 16 V18.5 M1.5 10 H4 M16 10 H18.5 M3.7 3.7 L5.4 5.4 M14.6 14.6 L16.3 16.3 M3.7 16.3 L5.4 14.6 M14.6 5.4 L16.3 3.7" />
        </svg>
    );
}
