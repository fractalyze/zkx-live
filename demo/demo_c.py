"""Demo B — GitHub-star bounty via the V3 gateway, in-circuit Reclaim attestation.

Same gateway + verifier-groth16-bn254 program as Demo A; only the VK and
intent differ. Uses `pay_with_reclaim.circom` (V2, ~1.66 M constraints,
~10 s zkX proof) so the Reclaim attestor's secp256k1 ECDSA signature is
verified inside Groth16 — no SDK trust.

Same proof-pipeline as Demo A: build input → witness → rabbit-py prove.
End-state asserted: claimer ATA balance == bounty amount.
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
BUILD = CIRCUITS / "build" / "demo_b"
BUILD.mkdir(parents=True, exist_ok=True)

TOKEN_PROGRAM_ID = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")


def run(cmd, **kwargs):
    return subprocess.run(cmd, capture_output=True, text=True, check=True, **kwargs).stdout


def spl_transfer_ix(source, dest, owner, amount):
    return Instruction(
        program_id=TOKEN_PROGRAM_ID,
        data=b"\x03" + amount.to_bytes(8, "little"),
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
    print(f"[demo-c] payer: {payer.pubkey()}")
    lib.airdrop(client, payer.pubkey(), sol=200)

    lib.deploy_program(
        REPO / "target" / "deploy" / "verifier_groth16_bn254.so",
        REPO / "target" / "deploy" / "verifier_groth16_bn254-keypair.json",
    )
    lib.deploy_program(
        REPO / "target" / "deploy" / "gateway.so",
        REPO / "target" / "deploy" / "gateway-keypair.json",
    )

    AMOUNT = 5_000_000
    print("[spl] creating mint ...")
    mint_addr = next(
        line.split()[2]
        for line in run([str(lib.SOLANA_BIN / "spl-token"), "create-token", "--decimals", "0"]).splitlines()
        if line.startswith("Creating token")
    )
    print(f"[spl] mint: {mint_addr}")

    src_ata = next(
        line.split()[2]
        for line in run([str(lib.SOLANA_BIN / "spl-token"), "create-account", mint_addr]).splitlines()
        if line.startswith("Creating account")
    )

    # Claimer (GitHub user) gets a fresh keypair → token account at that address.
    dst_kp = Keypair()
    dst_kp_path = BUILD / "dst.json"
    dst_kp_path.write_text(json.dumps(list(bytes(dst_kp))))
    out = run(
        [str(lib.SOLANA_BIN / "spl-token"), "create-account", mint_addr, str(dst_kp_path)]
    )
    dst_ata = next(line.split()[2] for line in out.splitlines() if line.startswith("Creating account"))
    print(f"[spl] claimer ATA: {dst_ata}")
    assert dst_ata == str(dst_kp.pubkey())

    run([str(lib.SOLANA_BIN / "spl-token"), "mint", mint_addr, str(AMOUNT), src_ata])

    src_ata_pk = Pubkey.from_string(src_ata)

    # --- V2 proof: build_v4_input.mjs binds dst pubkey + signs Reclaim claim ---
    input_json = BUILD / "input.json"
    wtns = BUILD / "witness.wtns"
    proof_path = BUILD / "proof.json"
    pub_path = BUILD / "public.json"

    print("[demo-c] building V2 input bound to claimer pubkey ...")
    run(
        [
            "node",
            "build_v4_input.mjs",
            str(dst_kp.pubkey()),
            str(AMOUNT),
            str(input_json),
        ],
        cwd=str(CIRCUITS),
    )
    print("[demo-c] computing witness (V2 ~ 2.5 min on first run) ...")
    lib.gen_witness(
        CIRCUITS / "build" / "pay_with_reclaim_real_js" / "pay_with_reclaim_real.wasm",
        input_json,
        wtns,
    )
    print("[demo-c] generating proof via rabbit-py (V2 ~ 8-10 s) ...")
    lib.gen_proof(
        CIRCUITS / "build" / "pay_with_reclaim_real_final.zkey",
        wtns,
        proof_path,
        pub_path,
    )

    # --- VK upload (schema 1) ---
    vk_json = json.loads((CIRCUITS / "build" / "pay_with_reclaim_real_vk.json").read_text())
    vk_bytes = lib.serialize_vk(vk_json)
    config = lib.upload_vk(client, payer, vk_bytes, schema_id=1, nr_pubinputs=36)

    proof_bytes = lib.encode_proof(json.loads(proof_path.read_text()))
    pi_bytes = lib.encode_public_inputs(json.loads(pub_path.read_text()))

    salt = b"\xc4" * 32
    nullifier_seed = b"\x44" * 32
    intent_root = b"\x00" * 32
    action_policy_root = b"\x00" * 32
    expiry = int(time.time()) + 3600

    register_ix = lib.register_intent_ix(
        owner=payer.pubkey(),
        salt=salt,
        verifier_program=lib.VERIFIER_PROGRAM_ID,
        verifier_config=config,
        schema_id=1,
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

    tag = b"\xee" * 32
    # V4 blob (1408 B) is too big for a single stage_proof tx — chunk it.
    total_chunks = lib.stage_chunked(client, payer, intent_pda, tag, proof_bytes, pi_bytes)

    execute_ix = lib.execute_chunked_intent_ix(
        rent_recipient=payer.pubkey(),
        intent=intent_pda,
        tag=tag,
        total_chunks=total_chunks,
        verifier_program=lib.VERIFIER_PROGRAM_ID,
        verifier_config=config,
    )
    transfer_ix = spl_transfer_ix(
        source=src_ata_pk,
        dest=dst_kp.pubkey(),
        owner=payer.pubkey(),
        amount=AMOUNT,
    )
    sig = lib.send_tx(
        client,
        [lib.cu_limit_ix(600_000), execute_ix, transfer_ix],
        payer,
        label="execute_staged_intent + spl_transfer (V2)",
    )

    final_bal = "0"
    for _ in range(60):
        try:
            final_bal = client.get_token_account_balance(dst_kp.pubkey()).value.amount
            if int(final_bal) == AMOUNT:
                break
        except Exception:
            pass
        time.sleep(0.5)
    print(f"[demo-c] claimer balance: {final_bal} (expected {AMOUNT})")
    if int(final_bal) != AMOUNT:
        from solders.signature import Signature as _SolSig
        sig_obj = _SolSig.from_string(str(sig))
        for _ in range(20):
            txr = client.get_transaction(sig_obj, max_supported_transaction_version=0).value
            if txr:
                for line in (txr.transaction.meta.log_messages or []):
                    print(f"    {line}")
                break
            time.sleep(0.5)
        return 1
    print(
        "[demo-c] PASS — same gateway, same verifier program, "
        "different VK + different intent. In-circuit Reclaim ECDSA verified."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
