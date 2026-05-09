#!/usr/bin/env bash
#
# stop.sh — tear down the zkx-live production stack.
# Reverses scripts/start.sh in dependency-safe order:
#   1. close public exposure (funnel + serve)
#   2. stop docker services
#   3. stop the host-process prover
#
# Usage: bash scripts/stop.sh

set -uo pipefail

REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

PROVER_PIDFILE="/tmp/zkx-prover.pid"

# ──────────────────────────── 1. tailscale funnel ────────────────────────────
# Tailscale 1.96+ uses `funnel reset` (no more `on/off` toggle).
if command -v tailscale >/dev/null; then
    echo "→ tailscale funnel reset"
    tailscale funnel reset >/dev/null 2>&1 || true
    tailscale serve reset >/dev/null 2>&1 || true
fi

# ──────────────────────────── 2. docker compose ────────────────────────────
echo "→ docker compose down"
docker compose down --remove-orphans 2>&1 | tail -5

# ──────────────────────────── 3. prover (host process) ────────────────────────────
if [[ -f "$PROVER_PIDFILE" ]]; then
    pid="$(cat "$PROVER_PIDFILE")"
    if kill -0 "$pid" 2>/dev/null; then
        echo "→ stopping prover pid $pid"
        kill "$pid"
        # Give it 5s to exit cleanly, then SIGKILL
        for _ in {1..10}; do
            sleep 0.5
            kill -0 "$pid" 2>/dev/null || break
        done
        kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PROVER_PIDFILE"
else
    # Fallback: kill anyone listening on :9090 that looks like our prover
    pid="$(ss -tlnp 2>/dev/null | awk '/127\.0\.0\.1:9090/{print $NF}' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)"
    if [[ -n "${pid:-}" ]]; then
        echo "→ no pidfile; killing pid $pid on :9090 (verify before trusting)"
        kill "$pid" 2>/dev/null || true
    fi
fi

echo "✓ stack stopped"
