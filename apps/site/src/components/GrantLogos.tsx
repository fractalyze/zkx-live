/*
 * Grants strip. Two logos with one-line captions, no amounts, no
 * dates. Logos served from /public — Ethereum is the canonical
 * Wikimedia mark, NVIDIA is the canonical corporate badge. Both are
 * rendered at restrained scale so the section reads as a credit
 * line, not a sponsorship banner.
 */
export function GrantLogos() {
    return (
        <div className="grid items-center gap-10 sm:grid-cols-2 sm:gap-16">
            <GrantItem
                logoSrc="/ethereum.svg"
                logoAlt="Ethereum logo"
                logoH={56}
                title="Ethereum Foundation"
                caption="Ethereum Foundation grant recipient"
            />
            <GrantItem
                logoSrc="/nvidia.svg"
                logoAlt="NVIDIA logo"
                logoH={42}
                title="NVIDIA Inception"
                caption="NVIDIA Inception Program member"
            />
        </div>
    );
}

function GrantItem({
    logoSrc, logoAlt, logoH, title, caption,
}: {
    logoSrc: string;
    logoAlt: string;
    logoH: number;
    title: string;
    caption: string;
}) {
    return (
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-center sm:gap-6 sm:text-left">
            <div className="shrink-0 flex h-16 items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={logoSrc}
                    alt={logoAlt}
                    height={logoH}
                    style={{ height: `${logoH}px`, width: 'auto' }}
                />
            </div>
            <div className="min-w-0">
                <div className="font-mono text-sm font-semibold text-ink">{title}</div>
                <div className="mt-0.5 text-xs text-muted">{caption}</div>
            </div>
        </div>
    );
}
