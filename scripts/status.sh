#!/usr/bin/env bash
#
# status.sh — one-shot health overview of the full zkx-live stack.
# No side effects — safe to run anytime.
#
# Usage: bash scripts/status.sh

set -uo pipefail

REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

GREEN=$'\e[32m'; RED=$'\e[31m'; DIM=$'\e[2m'; RST=$'\e[0m'
ok()   { printf "  %sOK%s   %s\n" "$GREEN" "$RST" "$*"; }
fail() { printf "  %sDOWN%s %s\n" "$RED" "$RST" "$*"; }

probe() { # name url
    local name="$1" url="$2"
    if curl -fsS --max-time 1 "$url" >/dev/null 2>&1; then
        ok "$name  →  $url"
    else
        fail "$name  →  $url"
    fi
}

echo "── services ────────────────────────────────────────────────"
probe "prover     " "http://127.0.0.1:9090/health"
probe "witness    " "http://127.0.0.1:7001/health"
probe "tx_builder " "http://127.0.0.1:7100/health"
probe "bounty     " "http://127.0.0.1:3002/api/auth/me"

echo
echo "── docker ─────────────────────────────────────────────────"
if docker compose ps --format json >/dev/null 2>&1; then
    docker compose ps --format "table {{.Service}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null \
        | sed 's/^/  /'
else
    echo "  (docker compose not running here)"
fi

echo
echo "── tailscale funnel ───────────────────────────────────────"
if command -v tailscale >/dev/null; then
    funnel="$(tailscale funnel status 2>/dev/null)"
    if [[ -n "$funnel" ]]; then
        echo "$funnel" | sed 's/^/  /'
    else
        echo "  (no funnel active — run \`bash scripts/start.sh\` to enable)"
    fi
else
    echo "  ${DIM}tailscale CLI not installed${RST}"
fi
