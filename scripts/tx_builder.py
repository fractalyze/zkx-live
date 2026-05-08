"""tx_builder — Flask micro-service that lifts the existing apps/lib.py
gateway flow off click_to_paid.py's localnet path and onto devnet, behind
an HTTP API the Next.js /api/claim route can call.

Endpoints:
    GET  /health          → {ok: true, balance_sol, intent_pda}
    POST /submit          body: {recipient_b58, proof, public_signals}
                          → {tx_sig, explorer_url, total_lamports_spent}

Why a service and not a TS port: apps/lib.py already has every gateway
helper we need (proof_a pre-negation, ix discriminators, PDA derivation,
chunked staging). Re-implementing in TypeScript is a 1-2 day port; an
HTTP wrapper is ~100 lines.

Usage:
    nohup /tmp/zkx-guardrail-venv/bin/python3 scripts/tx_builder.py \
        > /tmp/tx_builder.log 2>&1 < /dev/null & disown
"""
from __future__ import annotations

import json
import os
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "apps"))

import lib  # noqa: E402

from flask import Flask, jsonify, request  # noqa: E402

from solders.keypair import Keypair  # noqa: E402
from solders.pubkey import Pubkey  # noqa: E402
from solders.instruction import AccountMeta, Instruction  # noqa: E402
from solana.rpc.api import Client  # noqa: E402

# Same SALT / SCHEMA_ID as scripts/setup-onchain.py — must match for the
# intent_pda derivation to match what setup-onchain.py registered.
SALT = b"\x52" * 32                  # v2 salt (matches setup-onchain.py v2)
SCHEMA_ID = 2

PORT = int(os.environ.get("TX_BUILDER_PORT", "7100"))
RPC = os.environ.get("SOLANA_RPC_URL", "https://api.devnet.solana.com")
KEYPAIR = os.environ.get("BOUNTY_WALLET_PATH", "/tmp/zkx-bounty-keys/bounty.json")
VK_PATH = os.environ.get(
    "BOUNTY_VK_JSON",
    str(REPO / "circuits/build/bounty_vk.json"),
)

# Native SOL transfer ix — recipient is account[1], amount little-endian u64
# at data[4..12], discriminator = 2.
SYSTEM_PROGRAM_ID = Pubkey.from_string("11111111111111111111111111111111")


def system_transfer_ix(source: Pubkey, dest: Pubkey, lamports: int) -> Instruction:
    data = (2).to_bytes(4, "little") + lamports.to_bytes(8, "little")
    return Instruction(
        program_id=SYSTEM_PROGRAM_ID,
        data=data,
        accounts=[
            AccountMeta(pubkey=source, is_signer=True, is_writable=True),
            AccountMeta(pubkey=dest, is_signer=False, is_writable=True),
        ],
    )


def explorer_url(sig: str, rpc: str) -> str:
    if "devnet" in rpc:
        return f"https://explorer.solana.com/tx/{sig}?cluster=devnet"
    if "mainnet" in rpc:
        return f"https://explorer.solana.com/tx/{sig}"
    return f"https://explorer.solana.com/tx/{sig}?cluster=custom&customUrl={rpc}"


# ── one-time setup at boot ────────────────────────────────────────────────────
print(f"[tx_builder] rpc={RPC}")
PAYER = Keypair.from_bytes(json.loads(Path(KEYPAIR).read_text()))
CLIENT = Client(RPC)
print(f"[tx_builder] payer={PAYER.pubkey()}")

VK_BYTES = lib.serialize_vk(json.loads(Path(VK_PATH).read_text()))
import hashlib

VK_CONFIG = hashlib.sha256(VK_BYTES).digest()
INTENT_PDA = lib.intent_pda(PAYER.pubkey(), SALT)
print(f"[tx_builder] vk_config={VK_CONFIG.hex()}")
print(f"[tx_builder] intent_pda={INTENT_PDA}")


def submit_claim(recipient_b58: str, proof_json: dict, public_signals: list[str]) -> dict:
    recipient = Pubkey.from_string(recipient_b58)

    proof_bytes = lib.encode_proof(proof_json)
    pi_bytes = lib.encode_public_inputs(public_signals)
    if len(proof_bytes) != 256:
        raise RuntimeError(f"proof must be 256 bytes, got {len(proof_bytes)}")
    expected_pi_len = 6 * 32  # bounty circuit v2 (ERC-8150 minimal)
    if len(pi_bytes) != expected_pi_len:
        raise RuntimeError(
            f"public_inputs must be {expected_pi_len} bytes, got {len(pi_bytes)}"
        )

    # decode_payment_schema for SCHEMA_SELF_ATTEST (v2 layout) reads
    # recipient at slot 1 and amount at slot 3. Sanity-check our extraction.
    recipient_high = int.from_bytes(pi_bytes[1 * 32 + 16: 1 * 32 + 32], "big")
    recipient_low = int.from_bytes(pi_bytes[2 * 32 + 16: 2 * 32 + 32], "big")
    derived = (recipient_high << 128) | recipient_low
    derived_bytes = derived.to_bytes(32, "big")
    if Pubkey.from_bytes(derived_bytes) != recipient:
        raise RuntimeError(
            f"recipient mismatch: pubkey={recipient}, public_inputs encode {Pubkey.from_bytes(derived_bytes)}"
        )
    amount = int.from_bytes(pi_bytes[3 * 32 + 24: 3 * 32 + 32], "big")
    print(f"[tx_builder] decoded amount={amount} recipient={recipient}")

    # v2: proof+pubs (256+192=448B) fits in a single tx — no staging.
    # gateway::execute_intent + sibling SystemProgram.transfer.
    execute_ix = lib.execute_intent_ix(
        owner=PAYER.pubkey(),
        salt=SALT,
        verifier_program=lib.VERIFIER_PROGRAM_ID,
        verifier_config=VK_CONFIG,
        proof_bytes=proof_bytes,
        public_inputs_bytes=pi_bytes,
    )
    transfer_ix = system_transfer_ix(PAYER.pubkey(), recipient, amount)

    t0 = time.time()
    sig = lib.send_tx(
        CLIENT,
        [lib.cu_limit_ix(600_000), execute_ix, transfer_ix],
        PAYER,
        label="execute_intent + system_transfer",
    )
    exec_ms = int((time.time() - t0) * 1000)
    stage_ms = 0  # no staging — kept in response for backwards-compat

    return {
        "tx_sig": sig,
        "explorer_url": explorer_url(sig, RPC),
        "stage_ms": stage_ms,
        "execute_ms": exec_ms,
    }


app = Flask(__name__)


@app.get("/health")
def health():
    bal = CLIENT.get_balance(PAYER.pubkey()).value / 1e9
    return jsonify(
        ok=True,
        rpc=RPC,
        payer=str(PAYER.pubkey()),
        balance_sol=bal,
        intent_pda=str(INTENT_PDA),
        vk_config=VK_CONFIG.hex(),
    )


@app.post("/submit")
def submit():
    try:
        body = request.get_json(force=True) or {}
        for k in ("recipient_b58", "proof", "public_signals"):
            if k not in body:
                return jsonify(error=f"missing {k}"), 400
        out = submit_claim(body["recipient_b58"], body["proof"], body["public_signals"])
        return jsonify(out)
    except Exception:
        err = traceback.format_exc()
        print(f"[tx_builder] error:\n{err}")
        return jsonify(error=err), 500


def main() -> None:
    bal = CLIENT.get_balance(PAYER.pubkey()).value / 1e9
    print(f"[tx_builder] balance={bal:.4f} SOL")
    print(f"[tx_builder] ready  http://127.0.0.1:{PORT}")
    app.run(host="127.0.0.1", port=PORT, threaded=True, debug=False)


if __name__ == "__main__":
    main()
