#!/usr/bin/env bash
# Cluster switcher — sets all env vars for a given cluster in one call.
# Usage:  source scripts/cluster.sh <localnet|devnet|testnet|mainnet>
# Or:     bash scripts/cluster.sh devnet  (prints export commands)

set -euo pipefail

CLUSTER="${1:-devnet}"

case "$CLUSTER" in
  localnet)
    RPC=http://127.0.0.1:8899
    PROVER=http://127.0.0.1:7000
    ;;
  devnet)
    RPC=https://api.devnet.solana.com
    PROVER=https://prove-dev.zkx.example
    ;;
  testnet)
    RPC=https://api.testnet.solana.com
    PROVER=https://prove-dev.zkx.example
    ;;
  mainnet)
    RPC=https://api.mainnet-beta.solana.com
    PROVER=https://prove.zkx.example
    ;;
  *)
    echo "Unknown cluster: $CLUSTER" >&2
    echo "Expected one of: localnet, devnet, testnet, mainnet" >&2
    exit 1
    ;;
esac

# If sourced, set vars in the parent shell.
# If executed, print the export commands.
if (return 0 2>/dev/null); then
  export ZKX_GUARDRAIL_CLUSTER="$CLUSTER"
  export ZKX_GUARDRAIL_RPC_URL="$RPC"
  export ZKX_GUARDRAIL_ZKX_ENDPOINT="$PROVER"
  solana config set --url "$RPC" >/dev/null
  echo "Cluster set to: $CLUSTER"
  echo "  RPC:    $RPC"
  echo "  Prover: $PROVER"
else
  echo "export ZKX_GUARDRAIL_CLUSTER=$CLUSTER"
  echo "export ZKX_GUARDRAIL_RPC_URL=$RPC"
  echo "export ZKX_GUARDRAIL_ZKX_ENDPOINT=$PROVER"
  echo "# Run with 'source $0 $CLUSTER' to apply, or 'eval \$($0 $CLUSTER)'"
fi
