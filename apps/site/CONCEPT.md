# `apps/site` — design philosophy

This is the long-lived "design intent" doc. For the current
copy / responsive / chart polish details see `SPEC.md`.

## Visual personality

A technical-product introduction page, not a documentation site.
Inter for body, JetBrains Mono for numerals + identifiers + diagram
labels. Light theme only. A single accent color (engineering blue,
`#1f5fa8`) used sparingly — the zkx core in the hero diagram, the
focal benchmark numerals, the demo callout border, primary anchor
links.

The page is **diagram-led**: the hero figure is the centerpiece and
the copy supports it. Restrained, professional, asks the visitor to
trust its numbers without marketing fluff.

## Sections (in order, nothing else)

1. **Hero** — Headline + the schematic compiler-stack diagram
   (sources → zkx core with PrimeIR → CPU/GPU/ZK ASIC backends).
2. **Performance** — Primitive kernel benchmarks (FFT, IFFT, MSM,
   SMCS, LOGUP GKR) on real measured numbers.
3. **Applications (System benchmarks)** — Two competitive cards:
   Groth16 vs Gnark+ICICLE, zkVM vs SP1 Hypercube. Each shows
   workload provenance, baseline-vs-zkx mini bar, speedup pill.
4. **Demo** — Inline live `ClaimDemo`. Same-origin to `/api/*` via
   the Next reverse-proxy → apps/bounty.
5. **Grants** — EF + NVIDIA Inception logos, one-line captions, no
   amounts/dates.

## Key design choices

- **Hero diagram**: hand-drawn SVG with hairline strokes, monospace
  labels, accent on the zkx core box and PrimeIR inner box. ZK ASIC
  rendered dim/dashed (planned). Mobile: stacked HTML cards instead
  of scaled SVG.
- **Charts are honest.** Every number is annotated with circuit +
  hardware. Baselines named (Gnark+ICICLE, SP1 Hypercube). Cited
  competitor "fastest" claims (e.g. Ingonyama on ICICLE-snark) where
  relevant. No fabricated rows.
- **Demo wiring is unchanged.** `next.config.js` rewrites `/api/*`
  to bounty (`BOUNTY_ORIGIN`); SSE works through the Vercel rewrite
  layer because the Node fetch proxy honors streaming.
- **Top nav** is a thin sticky section-anchor strip (~48 px). No
  left TOC, no doc-style chapters. Anchors: performance ·
  applications · demo · grants · github.

## Dev commands

```sh
cd apps/site
npm install
npm run dev           # serves :3001

# the inline demo proxies /api/* to apps/bounty (:3002)
# either run bounty locally:
cd apps/bounty && npm run dev

# or proxy to the prod backend via Tailscale Funnel:
BOUNTY_ORIGIN=https://gpu-server.tailec11d1.ts.net npm run dev
```

For production deploy (Vercel + Tailscale Funnel + docker compose
on the GPU box), see the root `README.md` "Production deploy"
section.
