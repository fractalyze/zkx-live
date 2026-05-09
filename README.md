# zkx-live

> *Snap a verifiable proof on Solana — in milliseconds.*

A real-time ZK payment-gateway demo on Solana, accelerated by **zkX**.
Vanilla Groth16 provers (snarkjs) take seconds for real-world
composed-verification circuits; zkX cuts the prove step to ~140 ms
warm steady-state — fast enough to hide behind ordinary HTTPS
roundtrips.

---

## ⚠️ About the prover

**The zkX prover itself is closed source** and not in this repo.

What you'll find here is the *consumer* side — circuits, on-chain
programs, witness service, claim orchestration, and the demo UI.
This stack treats the prover as an opaque HTTP service:

```
POST :9090/<circuit>  body: {"witness_b64": "..."}
                      resp: {proof, public_signals, timing_ms}
```

Any Groth16 prover that produces valid proofs over our circuits can
plug into that slot — the on-chain stack is **prover-agnostic**.

A public subset of the prover internals lives at
[**fractalyze/open-zkx**](https://github.com/fractalyze/open-zkx). The
production prover (`rabbitsnark` + `zk_dtypes` + `jax*` +
`zkx-cuda-pjrt`) stays closed; everything in this repo is open.

---

## Two demos

| | `intent` | `bounty` |
| --- | --- | --- |
| Constraints | 8.7 k | 14 k (with EdDSA-BabyJubjub) |
| Statement | Transfer satisfies an owner-signed intent (allowlist + caps + expiry + nullifier) | Same as `intent` + binds proof to an attested `(subject, object, timestamp)` claim |
| Use case | AI-agent wallets, automated payment policies, spending guardrails | "User U starred repo R at time T" → on-chain bounty payout |
| Circuit | `circuits/intent/intent.circom` | `circuits/bounty/bounty.circom` |

The intent layer mirrors [ERC-8150](https://eips.ethereum.org/EIPS/eip-8150)
(intent-bound transactions), adapted to Solana's account model and
enforced cryptographically rather than by an EVM precompile.

---

## Architecture

```
[ apps/site (Vercel) ]
        │ /api/{auth,claim,star-state,repo} → BOUNTY_ORIGIN
        ▼
[ apps/bounty — Next.js claim orchestrator ]
        │
        ├──→ witness    : Node + circom C++ witness binary
        ├──→ prover     : zkX HTTP API (closed source — see above)
        └──→ tx_builder : Python, builds + submits Solana tx
                              │
                              ▼
        [ Solana on-chain (devnet) ]
          gateway program        3FYPieR6NZiQYGUx9TNeXGWwaV6ntD6ig2hu9jLi69ZQ
            └─ CPI ──→ groth16-verifier
                                 Hy878UwGsJpw62Kxio3ySbDXQoy21dR8JgmFrEv338qj
                       (Light Protocol Groth16 — ~190 k CU)
```

The gateway is **circuit-agnostic** — register a new VK to plug in a
new circuit, no on-chain code changes. Per-subject nullifier enforces
"one claim per (intent, subject)" independent of recipient.

Per-folder details: [`programs/`](programs/README.md),
[`circuits/`](circuits/README.md), [`apps/`](apps/README.md),
[`witness/`](witness/README.md), [`scripts/`](scripts/README.md),
[`docker/`](docker/README.md).

---

## Production deploy

Frontend on Vercel, backend on the GPU box behind Tailscale Funnel:

```
[ Vercel: apps/site ]
        │ /api/* → BOUNTY_ORIGIN (Tailscale Funnel URL)
        ▼
[ GPU box, docker compose ]
  bounty :3002 (publish) ── witness :7001 ── tx_builder :7100
                              host.docker.internal:9090
                                       │
                              prover :9090 (host process — closed-source SDK)
```

```bash
cp .env.example .env             # fill in GitHub OAuth + COOKIE_SECRET
bash setup.sh                    # circuits + zkeys + program keypairs
# install zkX SDK into /tmp/zkx-guardrail-venv (separate; closed source)
bash scripts/start.sh            # prover + docker compose + tailscale funnel
bash scripts/status.sh           # health-check all 4 + funnel URL
```

Vercel project: Root Directory `apps/site`, env
`BOUNTY_ORIGIN=https://<gpu-box>.<tailnet>.ts.net`. Update the GitHub
OAuth callback to `${VERCEL_URL}/api/auth/callback`. See
[`scripts/README.md`](scripts/README.md) for SALT rotation +
service-port table.

