#!/usr/bin/env bash
#
# start.sh — bring up the full zkx-live production stack on this host.
#
# Layout:
#   - prover     :9090   host process (closed-source zkX SDK, can't go in compose)
#   - witness    :7001   docker (internal)
#   - tx_builder :7100   docker (internal)
#   - bounty     :3002   docker (host port published)
#   - tailscale funnel → bounty :3002
#
# Reads env from .env at the repo root (not committed). See .env.example.
#
# Usage: bash scripts/start.sh

set -euo pipefail

REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

PROVER_LOG="/tmp/zkx-prover.log"
PROVER_PIDFILE="/tmp/zkx-prover.pid"
PROVER_VENV_PY="${PROVER_VENV_PY:-/tmp/zkx-guardrail-venv/bin/python3}"

# ──────────────────────────── 1. preflight ────────────────────────────
if [[ ! -f .env ]]; then
    echo "✗ .env missing at $REPO/.env — copy .env.example and fill in values"
    exit 1
fi
if [[ ! -f /tmp/zkx-bounty-keys/bounty.json ]]; then
    echo "✗ /tmp/zkx-bounty-keys/bounty.json missing (tx_builder needs the bounty wallet)"
    exit 1
fi
if [[ ! -f circuits/build/bounty_vk.json ]] || [[ ! -f circuits/build/bounty_cpp/bounty ]]; then
    echo "✗ circuits/build/ missing artifacts — run \`bash setup.sh\` first"
    exit 1
fi
if ! command -v tailscale >/dev/null; then
    echo "✗ tailscale CLI not found"
    exit 1
fi

# ──────────────────────────── 2. prover (host process) ────────────────────────────
prover_alive() {
    curl -fsS --max-time 1 http://127.0.0.1:9090/health >/dev/null 2>&1
}

if prover_alive; then
    echo "✓ prover :9090 already up"
else
    if [[ ! -x "$PROVER_VENV_PY" ]]; then
        echo "✗ prover venv missing at $PROVER_VENV_PY — install zkX SDK first"
        echo "  (set PROVER_VENV_PY=/path/to/python if your venv lives elsewhere)"
        exit 1
    fi
    echo "→ starting prover (host, :9090, bound 0.0.0.0 for docker bridge) ..."
    PROVER_HOST=0.0.0.0 nohup "$PROVER_VENV_PY" prover/app.py >"$PROVER_LOG" 2>&1 &
    echo $! >"$PROVER_PIDFILE"
    for _ in {1..30}; do
        sleep 0.5
        if prover_alive; then
            echo "✓ prover up (pid $(cat "$PROVER_PIDFILE"))"
            break
        fi
    done
    if ! prover_alive; then
        echo "✗ prover failed to come up — last 20 lines of $PROVER_LOG:"
        tail -20 "$PROVER_LOG"
        exit 1
    fi
fi

# ──────────────────────────── 3. docker compose ────────────────────────────
echo "→ docker compose up -d --build ..."
docker compose --env-file .env up -d --build

# Wait for bounty health (next start binds after a moment)
for _ in {1..30}; do
    sleep 0.5
    if curl -fsS --max-time 1 http://127.0.0.1:3002/api/auth/me >/dev/null 2>&1; then
        echo "✓ bounty :3002 responding"
        break
    fi
done

# ──────────────────────────── 4. tailscale funnel ────────────────────────────
# Map https://<host>.<tailnet>.ts.net/ → http://127.0.0.1:3002
# Tailscale 1.96+ syntax: `funnel --bg <port>` (no more on/off toggle).
# Requires `sudo tailscale set --operator=$USER` once + per-node funnel
# allowlist enabled at https://login.tailscale.com/f/funnel?node=<id>.
echo "→ tailscale funnel ..."
tailscale funnel --bg 3002 >/dev/null 2>&1 || true
FUNNEL_URL="$(tailscale funnel status 2>/dev/null | awk '/^https:\/\//{print $1; exit}')"

# ──────────────────────────── 5. summary ────────────────────────────
echo
echo "================================================================="
echo "  zkx-live stack up"
echo "================================================================="
docker compose ps --format "table {{.Service}}\t{{.Status}}\t{{.Ports}}"
echo
echo "  prover       host      http://127.0.0.1:9090   (pidfile $PROVER_PIDFILE)"
echo
if [[ -n "${FUNNEL_URL:-}" ]]; then
    echo "  Public URL:  $FUNNEL_URL"
    echo "  → set Vercel BOUNTY_ORIGIN=$FUNNEL_URL"
else
    echo "  Public URL:  (run \`tailscale funnel status\` to see it)"
fi
echo "================================================================="
