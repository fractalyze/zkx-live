/*
 * Two-row before/after analogy showing the parallel between ML pre/post
 * XLA and ZK pre/post zkX. Pure HTML/Tailwind — no SVG positioning math.
 *
 * Layout (md+): 2 columns, 2 rows.
 *
 *               BEFORE COMPILER            AFTER COMPILER
 *   ML  ┌──────────────────────┐    ┌──────────────────────┐
 *       │ TF/PyTorch/JAX       │    │ TF/PyTorch/JAX       │
 *       │   ↓                  │    │   ↓                  │
 *       │ hand-written CUDA    │    │ XLA                  │
 *       │   ↓                  │    │   ↓                  │
 *       │ GPU                  │    │ GPU · TPU · ASIC     │
 *       └──────────────────────┘    └──────────────────────┘
 *
 *   ZK  ┌──────────────────────┐    ┌──────────────────────┐
 *       │ Groth16/zkVM/circom  │    │ Groth16/zkVM/circom  │
 *       │   ↓                  │    │   ↓                  │
 *       │ hand-tuned prover    │    │ zkX + PrimeIR        │
 *       │ (Gnark, ICICLE, …)   │    │   ↓                  │
 *       │   ↓                  │    │ CPU · GPU · ASIC     │
 *       │ GPU                  │    │                      │
 *       └──────────────────────┘    └──────────────────────┘
 *
 * Below md it falls back to a single column (4 stacked panels).
 */
import type { ReactNode } from 'react';

export function HowItWorksDiagram() {
    return (
        <div className="rounded-lg border border-rule bg-page p-4 sm:p-6">
            {/* Column headers — only on md+ */}
            <div className="hidden grid-cols-[80px_1fr_1fr] gap-4 pb-3 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-faint md:grid">
                <span />
                <span>Without compiler</span>
                <span>With compiler</span>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-[80px_1fr_1fr] md:gap-4">
                {/* ML row */}
                <RowLabel>ML</RowLabel>
                <Panel
                    era="~2015"
                    inputs={['TensorFlow', 'PyTorch', 'JAX']}
                    middle="hand-written CUDA"
                    outputs={['GPU']}
                />
                <Panel
                    era="today"
                    inputs={['TensorFlow', 'PyTorch', 'JAX']}
                    middle="XLA"
                    middleAccent
                    outputs={['GPU · TPU · ASIC']}
                />

                {/* ZK row */}
                <RowLabel>ZK</RowLabel>
                <Panel
                    era="today"
                    inputs={['Groth16', 'zkVM', 'circom / custom']}
                    middle="hand-tuned prover"
                    middleSub="Gnark · ICICLE · SP1 · …"
                    outputs={['GPU']}
                />
                <Panel
                    era="with zkX"
                    inputs={['Groth16', 'zkVM', 'circom / custom']}
                    middle="zkX + PrimeIR"
                    middleAccent
                    outputs={['CPU · GPU · ASIC']}
                />
            </div>

            <p className="mt-4 max-w-prose text-sm leading-6 text-muted">
                Same pattern, ten years apart. The ML world stopped
                hand-writing CUDA and started lowering through XLA — PyTorch
                + XLA on a GPU now routinely beats hand-written CUDA C++,
                because the compiler sees the whole computation graph and
                the manual writer only sees one kernel at a time. zkX is
                the equivalent move for ZK proving.
            </p>
        </div>
    );
}

function RowLabel({ children }: { children: ReactNode }) {
    return (
        <div className="flex items-center justify-start font-mono text-sm font-semibold uppercase tracking-[0.14em] text-ink2 md:justify-end md:pr-2">
            {children}
        </div>
    );
}

function Panel({
    era, inputs, middle, middleSub, middleAccent, outputs,
}: {
    era: string;
    inputs: string[];
    middle: string;
    middleSub?: string;
    middleAccent?: boolean;
    outputs: string[];
}) {
    return (
        <div className="rounded-md border border-rule bg-surface p-4">
            <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
                    {era}
                </span>
            </div>
            <Stack items={inputs} small />
            <Arrow />
            <div
                className={[
                    'rounded border px-3 py-2 text-center font-mono text-sm font-semibold',
                    middleAccent
                        ? 'border-accent bg-accentSoft text-accent'
                        : 'border-rule bg-page text-ink',
                ].join(' ')}
            >
                {middle}
                {middleSub && (
                    <div className="mt-0.5 font-mono text-[10px] font-normal text-muted">
                        {middleSub}
                    </div>
                )}
            </div>
            <Arrow />
            <Stack items={outputs} />
        </div>
    );
}

function Stack({ items, small }: { items: string[]; small?: boolean }) {
    return (
        <div className="space-y-1">
            {items.map((it) => (
                <div
                    key={it}
                    className={[
                        'rounded border border-rule bg-page px-3 py-1.5 text-center font-mono',
                        small ? 'text-xs text-muted' : 'text-sm text-ink',
                    ].join(' ')}
                >
                    {it}
                </div>
            ))}
        </div>
    );
}

function Arrow() {
    return <div className="my-2 text-center font-mono text-xs text-faint">↓</div>;
}
