# `apps/` — front-ends + shared SDK

## `lib.py`
Python SDK for the on-chain integration: VK serialization, intent
PDA derivation, gateway ix builders (`register_intent`,
`execute_chunked_intent`), `proof_a` pre-negation, BE field
encoding, chunked staging, `send_tx` helper. Used by every script
that talks to the gateway.

## `bounty/` — claim-flow Next.js backend
The OAuth + ZK + Solana submit pipeline that powers the live demo:

- `/api/auth/{login,callback,me,logout}` — GitHub OAuth (popup pattern).
- `/api/star-state` — checks if signed-in user has starred the repo.
- `/api/repo` — server-side cached GitHub repo metadata (stars, name).
  Avoids the unauth 60/hr per-IP limit.
- `/api/claim` — SSE stream that runs star → witness → prove →
  submit, reporting per-step timings.

Reads:
- `WITNESS_URL`, `PROVER_URL`, `TX_BUILDER_URL` (defaults to
  `127.0.0.1:{7001,9090,7100}` for host dev; compose sets internal
  hostnames).
- `GITHUB_*`, `COOKIE_SECRET`, `APP_URL` for OAuth.
- `BOUNTY_AMOUNT` (lamports), `BOUNTY_AMOUNT_HUMAN` for display.

## `site/` — product page
Static-ish marketing front (Hero, Performance charts, ClaimDemo,
Grants). Reverse-proxies `/api/*` to bounty via `next.config.js`
rewrites so the demo runs same-origin from the browser.

Deployed to Vercel (`apps/site` is Vercel's project Root Directory);
bounty stays on the GPU box behind Tailscale Funnel. See root
`README.md` "Production deploy" section.

Design refs:
- `CONCEPT.md` — visual personality + section list.
- `SPEC.md` — copy / responsive / perf chart polish spec.

## `click_to_paid.py`, `demo_pay_intent.py`, `reclaim/`
End-to-end orchestrators run from CLI — kept for local sanity checks
and as the original demos before the web UI existed. Not used by the
production stack.
