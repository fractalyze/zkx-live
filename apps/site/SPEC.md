# apps/site — Copy + Responsive + Perf Chart Polish Spec

> Branch: `feat/site-demo` · Last shipped: `9d7a7af`
> Owner: site iteration round 2 (post-9d7a7af)

## 1. Objective

Polish the existing zkx product page so a first-time visitor:

1. Reads exactly **two** pieces of copy (hero line + perf section sub) and
   already understands "zkx is a ZK compiler that beats SOTA provers in
   real measured workloads."
2. Sees the perf comparison **without being misled** — every number is
   labeled with the exact circuit, baseline stack, hardware, and what
   makes the comparison apples-to-apples.
3. Never sees the hero compiler-stack diagram clipped or torn at any
   viewport width — the diagram is the page's load-bearing visual; if
   it breaks, the brand impression breaks.

Non-goals:
- Adding more proving-scheme tabs (PLONK, STARK, RISC0, Halo2 placeholder
  rows in `SCHEMES` / `SCHEME_ROWS` will be removed — see §5).
- Adding more visualizations (theme tester, scheme catalog table) beyond
  what the page actually needs to communicate.

## 2. Audience and tone

- **Primary audience**: ZK engineers, infra leads at L2 / zkVM teams,
  prover service operators. They know what Gnark, ICICLE, SP1, Groth16,
  STARK, BN254 mean. Don't over-explain those.
- **Secondary audience**: VCs, dev-rel, generalist devs who Google
  "fastest Groth16 prover". They need the headline numbers and the
  "what's the apples-to-apples vs SOTA" framing in one glance.
- **Tone**: terse, technical, claim-first then qualify. No hype words
  ("revolutionary", "blazing", "unparalleled"). No emoji in body copy.
  Numbers do the talking.
- **Voice anchor**: "Performance Control Room" — the page is structured
  like a perf dashboard, not a marketing page.

## 3. Copy — exact wording for each surface

### 3.1 Hero

| Surface | Current | Proposed |
|---|---|---|
| Eyebrow | "fractalyze · performance control room" | "fractalyze · zkx" |
| H1 | "Benchmark-first ZK UX. Make performance impossible to miss." | "**Real-time ZK proofs through a compiler.**" |
| Sub-line | "This page is structured as a performance control room…" | "zkx is an MLIR-based zero-knowledge optimization compiler. We make production-grade ZK provers — measurably faster than today's SOTA across Groth16 and zkVM workloads." |
| CTA | "Try the demo ↓" (keep) | (keep) |

Rationale: the meta description ("performance control room") was
implementation-talk leaked into copy. Replace with the actual product
positioning + a concrete claim that the perf section then proves.

### 3.2 Performance section header

| Surface | Proposed |
|---|---|
| Eyebrow | "Performance" |
| H2 | "Application-level proof benchmarks." |
| Sub | "Each scheme compares zkx to the prover currently cited as the fastest in its category, on the workload that actually drives production cost. Real measurements, same hardware, same circuit — no fabricated numbers." |

### 3.3 Groth16 chart copy

```
Title: vs Gnark + ICICLE
Sub:   SP1 STARK verifier in Groth16 · ~5–6M constraints · BN254 · RTX 5090
Stat:  ~2× faster
Note:  Apples-to-apples — same circuit, same GPU. Baseline is Gnark with
       ICICLE GPU primitives, the standard accelerated Groth16 stack
       (used by every production SP1 onchain deployment for the
       STARK→SNARK wrapping step). zkx is the first prover to beat this
       baseline on its own workload.
```

### 3.4 zkVM chart copy

```
Title: vs SP1 Hypercube
Sub:   Ethereum mainnet block proving · target block 22309250
Stat:  ~1.5× faster
Note:  Hypercube is SP1's current production prover for block proving.
       zkx generates the same block proof in less time on the same GPU,
       with no protocol changes — block 22309250 used as a representative
       mainnet block (typical txn mix and gas usage).
```

### 3.5 "What real-time means" callout (Groth16 only — already correctly scoped)

Keep current text. Already cleanly scoped to Groth16.

### 3.5b Repo badge — star count visible regardless of auth

The repo badge at the top of the demo card shows the live star count
**without requiring login**. The GitHub `/repos/{owner}/{repo}` endpoint
is public — fetched without a token, no rate-limit concern at our
traffic. Format mirrors GitHub's own header: repo name on the left,
`★ 1,234 stars` on the right.

When signed in, the same count also appears inside the "Star | 1,234"
split button (GitHub-native pattern). Both reads come from the same
fetch — they stay in sync.

### 3.6 Live demo section

| Surface | Proposed |
|---|---|
| Eyebrow | "Live demo" |
| H2 | "Star our repo, claim 0.01 SOL on devnet." |
| Sub | "A real on-chain claim, proved by zkx in real time. Each step runs end-to-end on this page — watch the elapsed counter." |

(unchanged from current — already on-brief)

Demo card copy:
- Lede: "A Solana program — a zk-guard gateway — verifies ZK proofs
  on-chain to gate downstream actions like payouts. Use case: AI-agent
  payment verification. This demo: a GitHub star → ZK proof → on-chain
  verify → 0.01 SOL." (one sentence shorter than current)

### 3.7 Grants

Keep current ("Built with support from" + EF + NVIDIA Inception logos).

### 3.8 Footer

One-liner only: "© 2026 Fractalyze · github.com/fractalyze/{zkx, prime-ir, zkx-live}"

## 4. Hero diagram — responsive contract

**Hard rule**: the hero compiler-stack SVG (HeroDiagram component) is
ALWAYS rendered as a single column on every viewport. No side-by-side
copy/diagram layout. Reasons:

- The user explicitly required this ("zkx, prime-ir 있는 그림은
  무조건 1단으로 해줘 반응형으로 짤리지 않게").
- The diagram has 3 source boxes + 4 pass chips at fixed pixel
  positions inside a 880×480 viewBox. When the column gets narrower
  than ~720px, the SVG scales down and labels become unreadable.
- Single-column layout gives the SVG full container width on every
  viewport, which is what the diagram was designed for.

Implementation:
- `index.tsx` Hero: drop the `xl:grid-cols-12 / xl:col-span-5 / xl:col-span-7`
  pattern. Use a single stacked layout (copy on top, diagram below) at
  every breakpoint. Add a max-w to the copy column for line length.
- `HeroDiagram.tsx`: ensure SVG container is `width: 100%` with
  `viewBox` preserving aspect ratio. Add `min-width: 0` on parent if any
  flex container is in play.

## 5. Performance — visual emphasis & data hygiene

### 5.1 Remove placeholder schemes

Currently `SCHEMES` and `SCHEME_ROWS` in `PerfCharts.tsx` contain
fabricated numbers for PLONK / STARK / RISC0 / Halo2 / Nova / Sumcheck /
FRI / Hyrax / Kimchi. **Delete these.** The site shows only schemes
where we have real, reproducible measurements:

```ts
const SCHEMES: Scheme[] = [
    { id: 'groth16', label: 'Groth16',  chart: GROTH16_CHART },
    { id: 'zkvm',    label: 'zkVM',     chart: ZKVM_CHART },
];
```

`SCHEME_ROWS` array + `SchemeCatalog` table component: **remove
entirely** until we have real measurements to populate it. A small
"more benchmarks coming" line is fine; a fabricated table is not.

### 5.2 MetricCard row above chart

Keep the new top-row of three `MetricCard` elements (Best zkx · Baseline
· Latency saved). They're a strong addition by the user — surfaces the
delta numerically before the bar chart. No changes needed.

### 5.3 Visual emphasis on the speedup gap

Make the zkx-faster gap impossible to miss:

- The "~2×" / "~1.5×" speedup pill in the chart header — bump font size
  (currently `text-4xl`) → `text-5xl` and add a subtle accent
  background / pill border so it reads as a badge, not a number.
- After bars finish animating, render a thin horizontal **delta-bracket**
  between the two bars showing the saved-time region (e.g. shaded
  cyan/accent stripe from end-of-zkx-bar to end-of-baseline-bar with a
  small "→ saved 2.41 s" label centered on it).
- Stagger animation timing already in place (baseline 120ms, zkx 520ms)
  — keep, but consider a final pulse on the zkx bar after settle to
  draw the eye.

### 5.4 Tab styling

Already-good GitHub-style large pill tabs. No change.

### 5.5 Theme tester

The fixed-bottom-right ThemeTester widget (7 themes: Default, Pulse
Benchmark, Dark Graphite, Neon Night, Light Contrast Premium, Warm
Paper, Mono Minimal) is a design-time tool, not a visitor feature.

Default behavior: **hidden in production**. Only render when one of:
- `?theme-tester=1` query param set, OR
- `process.env.NODE_ENV === 'development'`

This keeps the iteration loop fast for the team without polluting the
visitor experience.

## 6. Concrete acceptance criteria

Each item is binary checkable:

- [ ] Hero stays single-column at viewport widths 320 / 768 / 1024 /
      1536 / 2560 px. Diagram never overflows or clips.
- [ ] No "Performance Control Room" or "Make performance impossible to
      miss" string anywhere in `src/`. New copy from §3.1 in place.
- [ ] PerfCharts `SCHEMES` array length is exactly 2 (Groth16, zkVM).
- [ ] No `SCHEME_ROWS` array, no `SchemeCatalog` component imported in
      `index.tsx`.
- [ ] Groth16 chart sub reads exactly the workload from §3.3 (mentions
      SP1 STARK verifier, ~5–6M constraints, RTX 5090).
- [ ] zkVM chart title reads "vs SP1 Hypercube" (not "vs SP1") and sub
      mentions "block 22309250".
- [ ] Speedup pill in chart header is visually emphasized vs current
      (badge / pill background, larger font).
- [ ] Delta-bracket between bars after animation settle, with saved-time
      label.
- [ ] ThemeTester is not visible at `localhost:3000/` in production
      build, but appears with `?theme-tester=1`.
- [ ] `npm run build` passes with no warnings beyond next.js's defaults.

## 7. Boundaries

**Always do**:
- Use existing palette tokens (`text-ink`, `bg-accent`, etc.) — no new
  hex codes inline.
- Run `npm run build` after each substantive change to confirm zero TS
  errors.
- Keep `next.config.js` rewrites untouched (OAuth flow depends on them).
- Keep `ClaimDemo.tsx`'s SSE wiring + auth state machine untouched.

**Ask first**:
- Adding new dependencies (chart libs, animation libs, icon sets).
- Replacing the existing typographic system (Inter + JetBrains Mono).
- Changing the palette beyond accent shades.
- Re-introducing SchemeCatalog or other multi-scheme widgets — only
  when measurements actually exist.

**Never do**:
- Fabricate benchmark numbers. Every perf claim must be sourced.
- Modify `apps/bounty/`, `programs/`, `circuits/`, or `scripts/` from
  the site work. Site is read-only against those.
- Touch `apps/bounty/.env.local` (it's gitignored and local-only).
- Skip the hero single-column rule for "just one breakpoint" — it's
  load-bearing.

## 8. Out of scope (explicitly defer)

- Adding real PLONK / STARK / RISC0 measurements (need the actual bench
  runs first; not in this round).
- Dark theme / theme persistence (theme tester is dev-only).
- i18n / Korean copy (English only for now).
- SEO meta tags / OG image (separate ship-prep ticket).
- Analytics, error reporting, etc. (production concerns, not site
  polish).

## 9. Verification plan

Per acceptance criteria in §6. Manual checks:

1. Cycle viewport widths in DevTools (320, 414, 768, 1024, 1280, 1536,
   2560) — hero diagram never breaks.
2. Click each scheme tab — chart copy matches §3.3 / §3.4.
3. Inspect `apps/site/src/components/PerfCharts.tsx` — only 2 scheme
   entries, no `SCHEME_ROWS`.
4. Visit `localhost:3000/` — no theme tester. Visit `?theme-tester=1`
   — theme tester appears.
5. Visit `localhost:3000/api/auth/me` — JSON response (proves OAuth
   proxy still untouched).
6. Click claim flow with fresh recipient — full live demo still works
   (proves ClaimDemo wiring untouched).

## 10. Sequencing for implementation

1. Hero responsive: index.tsx Hero layout → single column. (small,
   high-impact, do first)
2. Copy revisions: hero, perf section header, Groth16 + zkVM chart
   copy. (text-only, fast)
3. Remove placeholder schemes + SchemeCatalog from PerfCharts.tsx.
   (deletion-heavy, keeps the file simpler)
4. Speedup-pill visual emphasis + delta-bracket animation. (most
   complex; do last so simpler items ship even if this lingers)
5. ThemeTester gate behind env / query param.
6. Final `npm run build` + manual viewport sweep.

End of spec.
