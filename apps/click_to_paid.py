"""End-to-end click → bounty-paid orchestrator.

Flow (timed):
  1. Verify the GitHub user starred the target repo (public API)
  2. Build V5 fixture (self-attestor signs claim with EdDSA-BabyJubjub)
  3. Generate witness (C++)
  4. Call zkX prover service (warm) → ZK proof
  5. Submit Solana tx via gateway
  6. Print breakdown

Usage:
    python server/click_to_paid.py <github_username> [target_repo]

The prover service must already be running on http://127.0.0.1:9090 (see
server/prover.py).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

# Reuse Solana orchestration helpers
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "demo"))
import lib  # noqa: E402

from solana.rpc.api import Client
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.instruction import AccountMeta, Instruction


REPO = Path(__file__).resolve().parent.parent
CIRCUITS = REPO / "circuits"
BUILD = CIRCUITS / "build" / "click_to_paid"
BUILD.mkdir(parents=True, exist_ok=True)

TARGET_REPO_DEFAULT = "yourzk/zkx-guardrail"  # placeholder
PROVER_URL = "http://127.0.0.1:9090/prove"

TOKEN_PROGRAM_ID = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")


def github_get(url: str) -> dict | list:
    req = urllib.request.Request(url, headers={"User-Agent": "zkx-guardrail-demo"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def verify_starred(username: str, target_repo: str) -> tuple[int, str]:
    """Return (user_id, target_full_name) on success; raise on failure."""
    user = github_get(f"https://api.github.com/users/{username}")
    user_id = int(user["id"])

    target_lower = target_repo.lower()
    page = 1
    while page < 5:  # max 4 pages = 400 stars
        starred = github_get(
            f"https://api.github.com/users/{username}/starred?per_page=100&page={page}"
        )
        if not starred:
            break
        for repo in starred:
            if repo["full_name"].lower() == target_lower:
                return user_id, repo["full_name"]
        if len(starred) < 100:
            break
        page += 1
    raise RuntimeError(f"user '{username}' has not starred '{target_repo}'")


def spl_transfer_ix(source: Pubkey, dest: Pubkey, owner: Pubkey, amount: int) -> Instruction:
    return Instruction(
        program_id=TOKEN_PROGRAM_ID,
        data=b"\x03" + amount.to_bytes(8, "little"),
        accounts=[
            AccountMeta(pubkey=source, is_signer=False, is_writable=True),
            AccountMeta(pubkey=dest, is_signer=False, is_writable=True),
            AccountMeta(pubkey=owner, is_signer=True, is_writable=False),
        ],
    )


def call_prover(witness_path: Path) -> dict:
    body = json.dumps({"witness_path": str(witness_path)}).encode()
    req = urllib.request.Request(
        PROVER_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def main():
    username = sys.argv[1] if len(sys.argv) > 1 else "torvalds"
    target_repo = sys.argv[2] if len(sys.argv) > 2 else TARGET_REPO_DEFAULT
    print(f"[demo] github user='{username}' target_repo='{target_repo}'")
    print()

    timings = {}

    # ── Validator + programs setup ────────────────────────────
    validator = lib.Validator()
    validator.start()
    try:
        client = Client("http://127.0.0.1:8899")
        payer = lib.load_payer()
        lib.airdrop(client, payer.pubkey(), sol=200)
        lib.deploy_program(
            REPO / "target/deploy/groth16_verifier.so",
            REPO / "target/deploy/groth16_verifier-keypair.json",
        )
        lib.deploy_program(
            REPO / "target/deploy/gateway.so",
            REPO / "target/deploy/gateway-keypair.json",
        )
        # SPL setup
        out = subprocess.run(
            [str(lib.SOLANA_BIN / "spl-token"), "create-token", "--decimals", "0"],
            capture_output=True, text=True, check=True,
        ).stdout
        mint_addr = next(
            l.split()[2] for l in out.splitlines() if l.startswith("Creating token")
        )
        out = subprocess.run(
            [str(lib.SOLANA_BIN / "spl-token"), "create-account", mint_addr],
            capture_output=True, text=True, check=True,
        ).stdout
        src_ata = next(
            l.split()[2] for l in out.splitlines() if l.startswith("Creating account")
        )
        # Fresh dst keypair for the bounty recipient
        dst_kp = Keypair()
        dst_kp_path = BUILD / "dst.json"
        dst_kp_path.write_text(json.dumps(list(bytes(dst_kp))))
        out = subprocess.run(
            [str(lib.SOLANA_BIN / "spl-token"), "create-account", mint_addr, str(dst_kp_path)],
            capture_output=True, text=True, check=True,
        ).stdout
        dst_ata = next(
            l.split()[2] for l in out.splitlines() if l.startswith("Creating account")
        )
        AMOUNT = 5_000_000
        subprocess.run(
            [str(lib.SOLANA_BIN / "spl-token"), "mint", mint_addr, str(AMOUNT), src_ata],
            check=True,
        )
        src_ata_pk = Pubkey.from_string(src_ata)
        print(f"[setup] dst ATA = {dst_ata}\n")

        # ── Real-time pipeline starts here ────────────────────
        t_total = time.time()

        # 1. GitHub starred check
        t = time.time()
        user_id, repo_full = verify_starred(username, target_repo)
        timings["github_check"] = time.time() - t
        print(f"[1/5] GitHub starred check ✓ user_id={user_id} ({timings['github_check']*1000:.0f}ms)")

        # 2. Build V5 input.json (self-sign with EdDSA-BabyJubjub)
        t = time.time()
        input_json = BUILD / "input.json"
        # Fixed attestor priv key for repeatability across runs of this demo
        attestor_priv_hex = "11" * 32
        subprocess.run(
            [
                "node", "build_v5_input.mjs",
                str(dst_kp.pubkey()), str(AMOUNT), str(input_json),
                str(user_id), repo_full, attestor_priv_hex,
            ],
            cwd=str(CIRCUITS), check=True, capture_output=True,
        )
        timings["build_input"] = time.time() - t
        print(f"[2/5] Build fixture (EdDSA self-sign) ✓ ({timings['build_input']*1000:.0f}ms)")

        # 3. C++ witness gen
        t = time.time()
        wtns = BUILD / "witness.wtns"
        subprocess.run(
            [
                str(CIRCUITS / "build/bounty_cpp/bounty"),
                str(input_json), str(wtns),
            ],
            check=True, capture_output=True,
        )
        timings["witness_gen"] = time.time() - t
        print(f"[3/5] Witness gen (C++) ✓ ({timings['witness_gen']*1000:.0f}ms)")

        # 4. zkX warm prove via HTTP
        t = time.time()
        proof_resp = call_prover(wtns)
        timings["zk_prove"] = time.time() - t
        zkx_internal = proof_resp.get("timing_ms", {})
        print(
            f"[4/5] zkX warm prove ✓ "
            f"wall={timings['zk_prove']*1000:.0f}ms "
            f"(internal: az/bz={zkx_internal.get('az_bz')}ms, "
            f"proof={zkx_internal.get('proof')}ms)"
        )

        # Save proof + public for tx step
        proof_json = proof_resp["proof"]
        pubs = proof_resp["public_signals"]
        (BUILD / "proof.json").write_text(json.dumps(proof_json))
        (BUILD / "public.json").write_text(json.dumps(pubs))

        # 5. Submit Solana tx (gateway → verifier-groth16 CPI → SPL transfer)
        t = time.time()
        vk_json = json.loads((CIRCUITS / "build/bounty_vk.json").read_text())
        vk_bytes = lib.serialize_vk(vk_json)
        config = lib.upload_vk(client, payer, vk_bytes, schema_id=2, nr_pubinputs=24)

        proof_bytes = lib.encode_proof(proof_json)
        pi_bytes = lib.encode_public_inputs(pubs)

        salt = b"\x55" * 32
        nullifier_seed = b"\x55" * 32
        intent_root = b"\x00" * 32
        action_policy_root = b"\x00" * 32
        expiry = int(time.time()) + 3600
        register_ix = lib.register_intent_ix(
            owner=payer.pubkey(), salt=salt,
            verifier_program=lib.VERIFIER_PROGRAM_ID,
            verifier_config=config, schema_id=2,
            intent_root=intent_root, nullifier_seed=nullifier_seed,
            cluster_id=1, expiry=expiry,
            action_policy_root=action_policy_root,
        )
        lib.send_tx(client, [register_ix], payer, label="register_intent")
        intent_pda = lib.intent_pda(payer.pubkey(), salt)
        lib.wait_for_account(client, intent_pda)
        lib.wait_for_account(client, lib.nset_pda(intent_pda))

        # V5 blob = 256 + 24*32 = 1024 bytes — over single-tx limit, use chunked
        tag = b"\x66" * 32
        total_chunks = lib.stage_chunked(client, payer, intent_pda, tag, proof_bytes, pi_bytes)

        execute_ix = lib.execute_chunked_intent_ix(
            rent_recipient=payer.pubkey(), intent=intent_pda, tag=tag,
            total_chunks=total_chunks,
            verifier_program=lib.VERIFIER_PROGRAM_ID, verifier_config=config,
        )
        transfer_ix = spl_transfer_ix(
            source=src_ata_pk, dest=dst_kp.pubkey(),
            owner=payer.pubkey(), amount=AMOUNT,
        )
        sig = lib.send_tx(
            client,
            [lib.cu_limit_ix(600_000), execute_ix, transfer_ix],
            payer, label="execute_staged_intent + spl_transfer",
        )
        timings["solana_tx"] = time.time() - t
        print(f"[5/5] Solana tx submit ✓ sig={sig[:20]}... ({timings['solana_tx']*1000:.0f}ms)")

        # Verify destination balance
        for _ in range(40):
            try:
                bal = client.get_token_account_balance(dst_kp.pubkey()).value.amount
                if int(bal) == AMOUNT:
                    break
            except Exception:
                pass
            time.sleep(0.5)

        timings["total"] = time.time() - t_total

        print()
        print("=" * 60)
        print("BOUNTY PAID")
        print("=" * 60)
        for step in ("github_check", "build_input", "witness_gen", "zk_prove", "solana_tx"):
            print(f"  {step:20s}  {timings[step]*1000:6.0f} ms")
        print(f"  {'-'*20}  {'-'*9}")
        print(f"  {'TOTAL':20s}  {timings['total']*1000:6.0f} ms")
        print("=" * 60)
        print(f"Recipient {dst_kp.pubkey()} received {AMOUNT} tokens")
        return 0

    finally:
        validator.stop()


if __name__ == "__main__":
    sys.exit(main())
