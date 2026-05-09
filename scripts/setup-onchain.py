#!/usr/bin/env python3
"""
Stage B+C of the on-chain integration: upload the bounty circuit's verifying
key to the verifier program and register an intent on the gateway program.

Reuses the helpers in apps/lib.py (VK serialization, intent/VK PDA derivation,
ix builders, etc.). Idempotent — re-running detects existing PDAs and skips.

Usage:
    python scripts/setup-onchain.py [--rpc URL] [--keypair PATH] [--vk PATH]

Defaults:
    --rpc      https://api.devnet.solana.com
    --keypair  /tmp/zkx-bounty-keys/bounty.json
    --vk       circuits/build/bounty_vk.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "apps"))
import lib  # noqa: E402

from solders.keypair import Keypair  # noqa: E402
from solana.rpc.api import Client  # noqa: E402

DEFAULT_RPC = "https://api.devnet.solana.com"
DEFAULT_KEYPAIR = "/tmp/zkx-bounty-keys/bounty.json"
DEFAULT_VK = REPO / "circuits/build/bounty_vk.json"

# Stable salt → deterministic intent PDA. Anyone re-running this script gets
# the same intent_pda owned by the same payer, so subsequent stages can find
# it without ambient state.
#
# v5 SALT — bumped to give a fresh per-subject nullifier set (v4 was used
# during dev and accumulated test claims under individual GitHub accounts).
# tx_builder.py's SALT must match.
SALT = b"\x55" * 32
NULLIFIER_SEED = b"\x55" * 32

# Bounty circuit metadata (matches programs/verifier-groth16-bn254 and
# circuits/bounty/bounty.circom).
SCHEMA_ID = 2          # SCHEMA_SELF_ATTEST (gateway decode unchanged: slots 1,2,3)
NR_PUBINPUTS = 7       # v3: ERC-8150 minimal + claim_subject (GitHub user_id)

# Intent's `expiry` is 1 year out — long enough for a demo without
# re-registering. cluster_id=1 == devnet/testnet generic per gateway code.
EXPIRY_OFFSET_S = 365 * 24 * 3600
CLUSTER_ID = 1


def load_keypair(path: str) -> Keypair:
    return Keypair.from_bytes(json.loads(Path(path).read_text()))


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--rpc", default=DEFAULT_RPC)
    p.add_argument("--keypair", default=DEFAULT_KEYPAIR)
    p.add_argument("--vk", default=str(DEFAULT_VK))
    args = p.parse_args()

    payer = load_keypair(args.keypair)
    client = Client(args.rpc)
    print(f"[setup] rpc    = {args.rpc}")
    print(f"[setup] payer  = {payer.pubkey()}")
    bal = client.get_balance(payer.pubkey()).value / 1e9
    print(f"[setup] balance= {bal:.4f} SOL")

    # ── Stage B: VK upload ────────────────────────────────────────────────────
    vk_json = json.loads(Path(args.vk).read_text())
    vk_bytes = lib.serialize_vk(vk_json)
    print(f"[setup] VK serialized: {len(vk_bytes)} bytes")
    config = lib.upload_vk(client, payer, vk_bytes, schema_id=SCHEMA_ID, nr_pubinputs=NR_PUBINPUTS)
    vk_addr = lib.vk_pda(config)
    print(f"[setup] VK config = {config.hex()}")
    print(f"[setup] VK PDA    = {vk_addr}")

    # ── Stage C: intent registration ──────────────────────────────────────────
    intent_addr = lib.intent_pda(payer.pubkey(), SALT)
    nset_addr = lib.nset_pda(intent_addr)
    print(f"[setup] intent PDA = {intent_addr}")
    print(f"[setup] nset   PDA = {nset_addr}")

    if client.get_account_info(intent_addr).value is not None:
        print(f"[setup] intent already registered (skip)")
        return

    expiry = int(time.time()) + EXPIRY_OFFSET_S
    register_ix = lib.register_intent_ix(
        owner=payer.pubkey(),
        salt=SALT,
        verifier_program=lib.VERIFIER_PROGRAM_ID,
        verifier_config=config,
        schema_id=SCHEMA_ID,
        # The proof carries the real intent_root_pub in its public inputs;
        # the gateway re-derives it from the proof on execute and binds via
        # public_inputs_hash. The on-chain intent_root field is informational
        # — left as zeros to match the existing apps/click_to_paid.py demo.
        intent_root=b"\x00" * 32,
        nullifier_seed=NULLIFIER_SEED,
        cluster_id=CLUSTER_ID,
        expiry=expiry,
        action_policy_root=b"\x00" * 32,
    )
    sig = lib.send_tx(client, [register_ix], payer, label="register_intent")
    print(f"[setup] registered intent at {intent_addr}")
    print(f"[setup] tx sig: {sig}")


if __name__ == "__main__":
    main()
