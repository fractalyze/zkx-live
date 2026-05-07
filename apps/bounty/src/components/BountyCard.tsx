type Props = {
    repo: string;
    amount: string;       // human-readable, e.g., "5 USDC"
};

export function BountyCard({ repo, amount }: Props) {
    return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
            <div className="text-sm uppercase tracking-widest text-muted">
                ⭐ Star for bounty
            </div>
            <div className="mt-3 text-3xl font-semibold leading-tight">
                Star{' '}
                <span className="font-mono text-accent">{repo}</span>
            </div>
            <div className="mt-2 text-3xl font-semibold leading-tight text-fg/80">
                → {amount}, instantly
            </div>
            <div className="mt-6 text-sm text-muted">
                Powered by zkX real-time ZK proofs on Solana.
            </div>
        </div>
    );
}
