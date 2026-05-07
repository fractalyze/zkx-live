"""Demo A — Intent-based payment via the V3 gateway.

End-to-end flow:
  1. Spin up solana-test-validator --reset
  2. Deploy gateway + verifier-groth16-bn254 programs
  3. Set up SPL: mint + source/destination token accounts (via `spl-token` CLI)
  4. Generate a fresh the intent circuit proof binding the destination token
     account as the policy recipient
  5. Upload VK to verifier; register intent on gateway
  6. Atomic tx: `execute_intent + sibling SPL Transfer`
  7. Assert: destination balance == policy amount
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib

from solana.rpc.api import Client
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.instruction import AccountMeta, Instruction


REPO = Path(__file__).resolve().parent.parent
CIRCUITS = REPO / "circuits"
DEMO_DIR = REPO / "demo"
BUILD = CIRCUITS / "build" / "demo_a"
BUILD.mkdir(parents=True, exist_ok=True)

TOKEN_PROGRAM_ID = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")


def run(cmd: list[str], **kwargs) -> str:
    """Run a shell command, return stdout, raise on non-zero exit."""
    res = subprocess.run(cmd, capture_output=True, text=True, check=True, **kwargs)
    return res.stdout


def spl_transfer_ix(source: Pubkey, dest: Pubkey, owner: Pubkey, amount: int) -> Instruction:
    """SPL Token Transfer (legacy, discriminator=3)."""
    data = b"\x03" + amount.to_bytes(8, "little")
    return Instruction(
        program_id=TOKEN_PROGRAM_ID,
        data=data,
        accounts=[
            AccountMeta(pubkey=source, is_signer=False, is_writable=True),
            AccountMeta(pubkey=dest, is_signer=False, is_writable=True),
            AccountMeta(pubkey=owner, is_signer=True, is_writable=False),
        ],
    )


def main() -> int:
    validator = lib.Validator()
    validator.start()
    try:
        return _run(validator)
    finally:
        validator.stop()


def _run(validator: lib.Validator) -> int:
    client = Client("http://127.0.0.1:8899")
    payer = lib.load_payer()
    print(f"[demo-a] payer: {payer.pubkey()}")
    lib.airdrop(client, payer.pubkey(), sol=200)

    # --- programs ---
    lib.deploy_program(
        REPO / "target" / "deploy" / "verifier_groth16_bn254.so",
        REPO / "target" / "deploy" / "verifier_groth16_bn254-keypair.json",
    )
    lib.deploy_program(
        REPO / "target" / "deploy" / "gateway.so",
        REPO / "target" / "deploy" / "gateway-keypair.json",
    )

    # --- SPL setup via solana CLI ---
    AMOUNT = 5_000_000
    print("[spl] creating mint ...")
    out = run([str(lib.SOLANA_BIN / "spl-token"), "create-token", "--decimals", "0"])
    mint_addr = next(
        line.split()[2] for line in out.splitlines() if line.startswith("Creating token")
    )
    print(f"[spl] mint: {mint_addr}")

    print("[spl] creating source token account ...")
    out = run([str(lib.SOLANA_BIN / "spl-token"), "create-account", mint_addr])
    src_ata = next(
        line.split()[2] for line in out.splitlines() if line.startswith("Creating account")
    )
    print(f"[spl] src ATA: {src_ata}")

    # Destination uses a freshly generated keypair -> independent token account
    dst_kp = Keypair()
    dst_kp_path = BUILD / "dst.json"
    dst_kp_path.write_text(json.dumps(list(bytes(dst_kp))))
    print("[spl] creating destination token account (fresh keypair) ...")
    out = run(
        [
            str(lib.SOLANA_BIN / "spl-token"),
            "create-account",
            mint_addr,
            str(dst_kp_path),
        ]
    )
    dst_ata = next(
        line.split()[2] for line in out.splitlines() if line.startswith("Creating account")
    )
    print(f"[spl] dst ATA: {dst_ata}  (== {dst_kp.pubkey()})")
    assert dst_ata == str(dst_kp.pubkey()), "dst keypair pubkey must equal created ATA address"

    print(f"[spl] minting {AMOUNT} → src ATA ...")
    run([str(lib.SOLANA_BIN / "spl-token"), "mint", mint_addr, str(AMOUNT), src_ata])

    src_ata_pk = Pubkey.from_string(src_ata)

    # --- proof generation (intent) ---
    input_json = BUILD / "input.json"
    wtns = BUILD / "witness.wtns"
    proof_path = BUILD / "proof.json"
    pub_path = BUILD / "public.json"

    print("[demo-a] building V1 input bound to dst pubkey ...")
    run(
        [
            "node",
            "build_v1_input.mjs",
            str(dst_kp.pubkey()),
            str(AMOUNT),
            str(input_json),
        ],
        cwd=str(CIRCUITS),
    )
    lib.gen_witness(
        CIRCUITS / "build" / "intent_js" / "intent.wasm",
        input_json,
        wtns,
    )
    lib.gen_proof(
        CIRCUITS / "build" / "intent_final.zkey",
        wtns,
        proof_path,
        pub_path,
    )

    # --- VK upload + intent registration ---
    vk_json = json.loads((CIRCUITS / "build" / "intent_vk.json").read_text())
    vk_bytes = lib.serialize_vk(vk_json)
    config = lib.upload_vk(client, payer, vk_bytes, schema_id=0, nr_pubinputs=20)

    proof_bytes = lib.encode_proof(json.loads(proof_path.read_text()))
    pi_bytes = lib.encode_public_inputs(json.loads(pub_path.read_text()))

    salt = b"\x42" * 32
    nullifier_seed = b"\x11" * 32
    intent_root = b"\x00" * 32
    action_policy_root = b"\x00" * 32
    expiry = int(time.time()) + 3600

    register_ix = lib.register_intent_ix(
        owner=payer.pubkey(),
        salt=salt,
        verifier_program=lib.VERIFIER_PROGRAM_ID,
        verifier_config=config,
        schema_id=0,
        intent_root=intent_root,
        nullifier_seed=nullifier_seed,
        cluster_id=1,
        expiry=expiry,
        action_policy_root=action_policy_root,
    )
    lib.send_tx(client, [register_ix], payer, label="register_intent")
    intent_pda = lib.intent_pda(payer.pubkey(), salt)
    lib.wait_for_account(client, intent_pda)
    lib.wait_for_account(client, lib.nset_pda(intent_pda))

    # --- chunked staging, then execute_staged + sibling SPL Transfer ---
    tag = b"\xab" * 32
    lib.stage_full(client, payer, intent_pda, tag, proof_bytes, pi_bytes)

    execute_ix = lib.execute_staged_intent_ix(
        rent_recipient=payer.pubkey(),
        intent=intent_pda,
        tag=tag,
        verifier_program=lib.VERIFIER_PROGRAM_ID,
        verifier_config=config,
    )
    transfer_ix = spl_transfer_ix(
        source=src_ata_pk,
        dest=dst_kp.pubkey(),
        owner=payer.pubkey(),
        amount=AMOUNT,
    )
    cu_ix = lib.cu_limit_ix(600_000)
    sig = lib.send_tx(
        client,
        [cu_ix, execute_ix, transfer_ix],
        payer,
        label="execute_staged_intent + spl_transfer",
    )
    # Fetch the tx and dump program logs (poll, since long-term cache may lag).
    from solders.signature import Signature as _SolSig
    sig_obj = _SolSig.from_string(str(sig))
    txr = None
    for _ in range(20):
        txr = client.get_transaction(sig_obj, max_supported_transaction_version=0).value
        if txr:
            break
        time.sleep(0.3)
    print("[exec] program logs:")
    if txr:
        for line in (txr.transaction.meta.log_messages or [])[-30:]:
            print(f"    {line}")
    else:
        print("    (tx not yet in long-term cache — re-query manually)")

    # --- verify destination balance (poll briefly) ---
    final_bal = "0"
    for _ in range(20):
        try:
            final_bal = client.get_token_account_balance(dst_kp.pubkey()).value.amount
            if int(final_bal) == AMOUNT:
                break
        except Exception:
            pass
        time.sleep(0.5)
    print(f"[demo-a] dst balance: {final_bal} (expected {AMOUNT})")
    if int(final_bal) != AMOUNT:
        # On mismatch, dump the program logs by re-fetching from RPC.
        print("[demo-a] FAIL — fetching tx logs ...")
        for _ in range(20):
            txr = client.get_transaction(sig_obj, max_supported_transaction_version=0).value
            if txr:
                for line in (txr.transaction.meta.log_messages or []):
                    print(f"    {line}")
                break
            time.sleep(0.5)
        # Also fetch `solana confirm -v` for thorough output
        try:
            out = subprocess.run(
                [str(lib.SOLANA_BIN / "solana"), "confirm", "-v", str(sig)],
                capture_output=True,
                text=True,
                timeout=10,
            ).stdout
            print(out)
        except Exception:
            pass
        return 1
    print(
        "[demo-a] PASS — gateway → verifier-groth16 CPI succeeded; "
        "SPL transfer enforced atomically."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
