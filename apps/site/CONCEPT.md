# zkx — product introduction page

## Visual personality

A technical-product introduction page, not a documentation site. Inter
for body, JetBrains Mono for numerals, identifiers, and diagram labels.
Light theme only. A single accent color (engineering blue, `#1f5fa8`)
used sparingly — the zkx core in the hero diagram, the focal `242 ms`
and `86×` numbers, the demo callout border, primary anchor links.

The page is diagram-led: the hero figure is the centerpiece and the
copy supports it, not the other way around. Restrained, professional,
asks the visitor to trust its numbers without marketing fluff.

## Section list

Four sections, in this order, nothing else:

1. **Hero** — Headline plus the schematic compiler-stack diagram
   (sources → zkx core with PrimeIR → CPU/GPU/ZK ASIC backends), with
   the load-bearing "1.66M constraints in 242 ms" callout adjacent.
2. **Performance** — Two hand-rolled SVG bar charts (vs circom, vs
   ICICLE) plus a three-up secondary stat row with the verified
   `pay_static`, `pay_with_reclaim`, and sub-linear-scaling numbers.
3. **Demo** — The existing `ClaimDemo` component running live against
   apps/bounty on `:3000` via the Next reverse-proxy. Adjacent
   four-step explainer of what's happening end-to-end.
4. **Grants** — Ethereum Foundation + NVIDIA Inception logos with
   one-line captions. No amounts, no dates.

## Key design choices

- **Hero diagram is hand-drawn SVG** with hairline strokes, monospace
  labels, and a single accent color on the zkx core box and PrimeIR
  inner box. Reads top-to-bottom: input sources (circom, zkVM, custom
  circuit) → zkx compiler core (PrimeIR + algebraic rewrite, fusion,
  layout assignment, lowering passes) → hardware backends (CPU, GPU,
  ZK ASIC*). ZK ASIC is rendered dim/dashed to mark it as planned.
- **Performance charts are honest.** vs-circom uses real measured
  numbers (20.7 s vs 0.242 s). The accent bar is floored at a small
  visible width so the comparison renders at-a-glance, but the
  proportional ratio is annotated precisely. vs-ICICLE is rendered as
  a relative comparison (1.0× baseline vs ~0.5×) with a footnote that
  ICICLE absolute numbers were not independently re-measured. We do
  not invent measured-looking absolute ICICLE numbers.
- **Demo wiring is unchanged.** The Next rewrite proxy in
  `next.config.js` still routes `/api/claim` and `/api/auth/*` to
  apps/bounty on `:3000`. The SSE state machine in `ClaimDemo.tsx` is
  byte-for-byte identical to the previous version — only presentation
  classes were restyled (light-theme only, dropped dark variants).
- **Grant logos are official assets** fetched from Wikimedia
  (Ethereum diamond) and the canonical NVIDIA badge SVG, served from
  `/public/`. Captions read "Ethereum Foundation grant recipient" and
  "NVIDIA Inception Program member" — exactly what the brief asked
  for, no overclaiming.
- **Top nav is a thin section-anchor strip** (sticky, ~48 px tall).
  No sticky left TOC, no docs-style numbered chapters. Anchors:
  performance · demo · grants · github.

## What was dropped from the previous concept

- Sticky left TOC + scrollspy (`Sidebar.tsx`)
- Tiny inline syntax highlighter (`Highlight.tsx`)
- Doc-style heading anchors (`Heading.tsx`)
- Doc-style callouts (`Callout.tsx`)
- Performance table (`PerfTable.tsx`)
- Old pipeline + stack diagrams (`Diagrams.tsx`)
- Light/dark toggle and entire dark-theme palette
- All `prose-doc` typography, code-block CSS, and Markdown-style ¶
  anchor affordances

## What stayed

- Inter + JetBrains Mono typographic foundation
- Restrained light-theme palette (whites, grays, single accent blue)
- `ClaimDemo` component logic and the `next.config.js` reverse proxy
  for `/api/claim` and `/api/auth/*` to apps/bounty `:3000`

## Dev commands

```sh
cd apps/site
npm install
npm run build           # verify

# run (port 3001 — :3000 is apps/bounty)
npm run dev

# the inline demo proxies to apps/bounty; in another terminal:
cd apps/bounty && npm run dev      # serves :3000

# optionally override the proxy target
BOUNTY_ORIGIN=http://127.0.0.1:3000 npm run dev
```

The site lives at <http://localhost:3001>. All four sections
(Hero, Performance, Demo, Grants) render on a single page; the top
nav anchors deep-link to each one. Mobile and desktop both render
without horizontal scroll.
