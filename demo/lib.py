"""Shared helpers for V3 gateway demos.

Validator orchestration, program deploy, VK serialization (matches the
on-chain `parse_vk` layout), proof encoding (Light Protocol convention,
proof_a pre-negated), and Anchor instruction discriminators.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Iterable

from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.system_program import ID as SYSTEM_PROGRAM_ID
from solders.sysvar import INSTRUCTIONS as SYSVAR_INSTRUCTIONS
from solders.instruction import AccountMeta, Instruction
from solders.transaction import Transaction
from solders.message import Message
from solders.compute_budget import set_compute_unit_limit
from solana.rpc.api import Client
from solana.rpc.commitment import Confirmed

REPO_ROOT = Path(__file__).resolve().parent.parent
SOLANA_BIN = Path("/home/a41/.local/share/solana/install/active_release/bin")
RABBITSNARK_BIN = Path("/tmp/zkx-guardrail-venv/bin/rabbitsnark")
SOLVER_LIB = (
    "/data/a41/bazel/a2888a4cffa9ac602adfb78d336aa5fd/execroot/rabbitsnark/"
    "bazel-out/k8-opt/bin/external/r1cs_solver/solver/libr1cs_solver.so"
)

GATEWAY_PROGRAM_ID = Pubkey.from_string("3FYPieR6NZiQYGUx9TNeXGWwaV6ntD6ig2hu9jLi69ZQ")
VERIFIER_PROGRAM_ID = Pubkey.from_string("Hy878UwGsJpw62Kxio3ySbDXQoy21dR8JgmFrEv338qj")

FQ_MODULUS = 21888242871839275222246405745257275088696311157297823662689037894645226208583


# -----------------------------------------------------------------------------
# Anchor discriminators
# -----------------------------------------------------------------------------
def disc(name: str) -> bytes:
    return hashlib.sha256(f"global:{name}".encode()).digest()[:8]


# -----------------------------------------------------------------------------
# BN254 helpers — proof / VK serialization to match the on-chain parser
# -----------------------------------------------------------------------------
def big_to_be32(v: int) -> bytes:
    return v.to_bytes(32, "big")


def g1_be64(coords) -> bytes:
    return big_to_be32(int(coords[0])) + big_to_be32(int(coords[1]))


def g1_be64_negated(coords) -> bytes:
    """Light Protocol multi-pairing convention: pi_a is pre-negated by the SDK."""
    x = int(coords[0])
    y = int(coords[1])
    neg_y = (FQ_MODULUS - (y % FQ_MODULUS)) % FQ_MODULUS
    return big_to_be32(x) + big_to_be32(neg_y)


def g2_be128(coords) -> bytes:
    """snarkjs G2 layout: [[x_c0, x_c1], [y_c0, y_c1], [1, 0]] →
    Light Protocol layout: [x_c1 | x_c0 | y_c1 | y_c0]."""
    x_c0 = int(coords[0][0])
    x_c1 = int(coords[0][1])
    y_c0 = int(coords[1][0])
    y_c1 = int(coords[1][1])
    return (
        big_to_be32(x_c1)
        + big_to_be32(x_c0)
        + big_to_be32(y_c1)
        + big_to_be32(y_c0)
    )


def serialize_vk(vk_json: dict) -> bytes:
    alpha = g1_be64(vk_json["vk_alpha_1"])
    beta = g2_be128(vk_json["vk_beta_2"])
    gamma = g2_be128(vk_json["vk_gamma_2"])
    delta = g2_be128(vk_json["vk_delta_2"])
    nr_ic = len(vk_json["IC"])
    ic_bytes = b"".join(g1_be64(p) for p in vk_json["IC"])
    return alpha + beta + gamma + delta + nr_ic.to_bytes(4, "little") + ic_bytes


def encode_proof(proof_json: dict) -> bytes:
    """Encode (a_negated || b || c) — 256 bytes."""
    return (
        g1_be64_negated(proof_json["pi_a"])
        + g2_be128(proof_json["pi_b"])
        + g1_be64(proof_json["pi_c"])
    )


def encode_public_inputs(pub_json: list[str]) -> bytes:
    return b"".join(big_to_be32(int(s)) for s in pub_json)


# -----------------------------------------------------------------------------
# Validator + deploy
# -----------------------------------------------------------------------------
class Validator:
    def __init__(self, ledger_dir: Path | None = None):
        self.ledger_dir = ledger_dir or Path(tempfile.mkdtemp(prefix="demo-validator-"))
        self.proc: subprocess.Popen | None = None

    def start(self) -> None:
        cmd = [
            str(SOLANA_BIN / "solana-test-validator"),
            "--reset",
            "--quiet",
            "--ledger",
            str(self.ledger_dir),
            "--rpc-port",
            "8899",
        ]
        print(f"[validator] starting (ledger={self.ledger_dir})...")
        self.proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            cwd=str(self.ledger_dir),
        )
        # Wait for RPC ready
        client = Client("http://127.0.0.1:8899")
        for _ in range(60):
            try:
                client.get_version()
                print("[validator] ready")
                return
            except Exception:
                time.sleep(1)
        raise RuntimeError("validator failed to start within 60s")

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        if self.ledger_dir.exists():
            shutil.rmtree(self.ledger_dir, ignore_errors=True)


def deploy_program(program_so: Path, keypair_path: Path) -> Pubkey:
    """Deploy a program via solana CLI; wait until it's executable on-chain."""
    print(f"[deploy] {program_so.name} ...")
    out = subprocess.run(
        [
            str(SOLANA_BIN / "solana"),
            "program",
            "deploy",
            "--program-id",
            str(keypair_path),
            "--url",
            "http://127.0.0.1:8899",
            "--commitment",
            "finalized",
            str(program_so),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    program_id_line = next(
        (line for line in out.stdout.splitlines() if "Program Id:" in line), None
    )
    if not program_id_line:
        raise RuntimeError(f"deploy failed: {out.stdout}\n{out.stderr}")
    pid_str = program_id_line.split(":", 1)[1].strip()
    pubkey = Pubkey.from_string(pid_str)
    # Wait until the program is actually fetchable via RPC and marked executable.
    client = Client("http://127.0.0.1:8899")
    for _ in range(60):
        info = client.get_account_info(pubkey).value
        if info is not None and info.executable:
            print(f"[deploy]   id: {pid_str} (executable)")
            return pubkey
        time.sleep(0.5)
    raise RuntimeError(f"deployed program {pid_str} not visible after 30s")


def wait_for_account(client: Client, pda: Pubkey, timeout_s: float = 30.0) -> None:
    """Poll until an account is fetchable by RPC. Solana confirmation_status
    can race ahead of leader-cache visibility; this closes that gap."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if client.get_account_info(pda).value is not None:
            return
        time.sleep(0.3)
    raise RuntimeError(f"account {pda} not visible after {timeout_s}s")


def airdrop(client: Client, who: Pubkey, sol: int = 100) -> None:
    print(f"[airdrop] {sol} SOL → {who}")
    sig = client.request_airdrop(who, sol * 1_000_000_000).value
    for _ in range(30):
        if client.confirm_transaction(sig).value:
            return
        time.sleep(0.5)
    raise RuntimeError("airdrop confirm timeout")


def load_payer() -> Keypair:
    p = Path(os.environ["HOME"]) / ".config" / "solana" / "id.json"
    if p.exists():
        return Keypair.from_bytes(bytes(json.loads(p.read_text())))
    # Generate ad-hoc keypair if no default wallet
    kp = Keypair()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(list(bytes(kp))))
    return kp


def send_tx(
    client: Client,
    instructions: Iterable[Instruction],
    payer: Keypair,
    extra_signers: Iterable[Keypair] = (),
    label: str | None = None,
) -> str:
    blockhash = client.get_latest_blockhash().value.blockhash
    msg = Message.new_with_blockhash(list(instructions), payer.pubkey(), blockhash)
    signers = [payer, *extra_signers]
    tx = Transaction.new_unsigned(msg)
    tx.sign(signers, blockhash)
    resp = client.send_transaction(tx)
    sig = resp.value
    # Wait for at least "confirmed" so subsequent txs see the resulting state.
    for _ in range(120):
        st = client.get_signature_statuses([sig]).value[0]
        if st and st.confirmation_status:
            if st.err:
                # Pull logs for the failed tx so the caller sees the actual error.
                try:
                    from solders.signature import Signature as _SolSig
                    txr = client.get_transaction(
                        sig if isinstance(sig, _SolSig) else _SolSig.from_string(str(sig)),
                        max_supported_transaction_version=0,
                    ).value
                    logs = txr.transaction.meta.log_messages if txr else []
                except Exception:
                    logs = []
                raise RuntimeError(
                    f"tx {label or ''} failed: {st.err}\n  logs:\n    "
                    + "\n    ".join(logs[-15:])
                )
            level = str(st.confirmation_status).lower()
            if "confirmed" in level or "finalized" in level:
                if label:
                    print(f"[tx] {label}: {sig}")
                return str(sig)
        time.sleep(0.3)
    raise RuntimeError("tx confirm timeout")


# -----------------------------------------------------------------------------
# Verifier program — high-level wrappers
# -----------------------------------------------------------------------------
def vk_pda(config: bytes) -> Pubkey:
    pda, _ = Pubkey.find_program_address([b"vk", config], VERIFIER_PROGRAM_ID)
    return pda


def initialize_vk_ix(
    payer: Pubkey, config: bytes, vk_size: int, schema_id: int, nr_pubinputs: int
) -> Instruction:
    pda = vk_pda(config)
    data = (
        disc("initialize_vk")
        + config
        + vk_size.to_bytes(4, "little")
        + schema_id.to_bytes(1, "little")
        + nr_pubinputs.to_bytes(2, "little")
    )
    return Instruction(
        program_id=VERIFIER_PROGRAM_ID,
        data=data,
        accounts=[
            AccountMeta(pubkey=pda, is_signer=False, is_writable=True),
            AccountMeta(pubkey=payer, is_signer=True, is_writable=True),
            AccountMeta(pubkey=SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
        ],
    )


def write_vk_chunk_ix(
    payer: Pubkey, config: bytes, offset: int, chunk: bytes
) -> Instruction:
    pda = vk_pda(config)
    data = (
        disc("write_vk_chunk")
        + config
        + offset.to_bytes(4, "little")
        + len(chunk).to_bytes(4, "little")
        + chunk
    )
    return Instruction(
        program_id=VERIFIER_PROGRAM_ID,
        data=data,
        accounts=[
            AccountMeta(pubkey=pda, is_signer=False, is_writable=True),
            AccountMeta(pubkey=payer, is_signer=True, is_writable=False),
        ],
    )


def upload_vk(
    client: Client,
    payer: Keypair,
    vk_bytes: bytes,
    schema_id: int,
    nr_pubinputs: int,
) -> bytes:
    """Upload VK to the verifier program. Returns the 32-byte config (= sha256(VK))."""
    config = hashlib.sha256(vk_bytes).digest()
    pda = vk_pda(config)
    if client.get_account_info(pda).value is not None:
        print(f"[vk] already uploaded at {pda}")
        return config
    send_tx(
        client,
        [initialize_vk_ix(payer.pubkey(), config, len(vk_bytes), schema_id, nr_pubinputs)],
        payer,
        label=f"initialize_vk schema={schema_id} size={len(vk_bytes)}",
    )
    # Wait until the PDA is actually visible to subsequent tx preflight.
    for _ in range(60):
        if client.get_account_info(pda).value is not None:
            break
        time.sleep(0.3)
    else:
        raise RuntimeError(f"VK PDA {pda} not visible after init")
    CHUNK = 800
    for off in range(0, len(vk_bytes), CHUNK):
        chunk = vk_bytes[off : off + CHUNK]
        send_tx(
            client,
            [write_vk_chunk_ix(payer.pubkey(), config, off, chunk)],
            payer,
            label=f"write_vk_chunk off={off} len={len(chunk)}",
        )
    print(f"[vk] uploaded {len(vk_bytes)}B to {pda}")
    return config


# -----------------------------------------------------------------------------
# Gateway — high-level wrappers
# -----------------------------------------------------------------------------
def intent_pda(owner: Pubkey, salt: bytes) -> Pubkey:
    pda, _ = Pubkey.find_program_address([b"intent", bytes(owner), salt], GATEWAY_PROGRAM_ID)
    return pda


def nset_pda(intent: Pubkey) -> Pubkey:
    pda, _ = Pubkey.find_program_address([b"nset", bytes(intent)], GATEWAY_PROGRAM_ID)
    return pda


def register_intent_ix(
    owner: Pubkey,
    salt: bytes,
    verifier_program: Pubkey,
    verifier_config: bytes,
    schema_id: int,
    intent_root: bytes,
    nullifier_seed: bytes,
    cluster_id: int,
    expiry: int,
    action_policy_root: bytes,
) -> Instruction:
    intent = intent_pda(owner, salt)
    nset = nset_pda(intent)
    data = (
        disc("register_intent")
        + salt
        + bytes(verifier_program)
        + verifier_config
        + schema_id.to_bytes(1, "little")
        + intent_root
        + nullifier_seed
        + cluster_id.to_bytes(1, "little")
        + expiry.to_bytes(8, "little", signed=True)
        + action_policy_root
    )
    return Instruction(
        program_id=GATEWAY_PROGRAM_ID,
        data=data,
        accounts=[
            AccountMeta(pubkey=intent, is_signer=False, is_writable=True),
            AccountMeta(pubkey=nset, is_signer=False, is_writable=True),
            AccountMeta(pubkey=owner, is_signer=True, is_writable=True),
            AccountMeta(pubkey=SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
        ],
    )


def execute_intent_ix(
    owner: Pubkey,
    salt: bytes,
    verifier_program: Pubkey,
    verifier_config: bytes,
    proof_bytes: bytes,
    public_inputs_bytes: bytes,
) -> Instruction:
    intent = intent_pda(owner, salt)
    data = (
        disc("execute_intent")
        + len(proof_bytes).to_bytes(4, "little")
        + proof_bytes
        + len(public_inputs_bytes).to_bytes(4, "little")
        + public_inputs_bytes
    )
    return Instruction(
        program_id=GATEWAY_PROGRAM_ID,
        data=data,
        accounts=[
            AccountMeta(pubkey=intent, is_signer=False, is_writable=False),
            AccountMeta(pubkey=nset_pda(intent), is_signer=False, is_writable=True),
            AccountMeta(pubkey=verifier_program, is_signer=False, is_writable=False),
            AccountMeta(pubkey=vk_pda(verifier_config), is_signer=False, is_writable=False),
            AccountMeta(pubkey=SYSVAR_INSTRUCTIONS, is_signer=False, is_writable=False),
        ],
    )


def proof_pda(intent: Pubkey, tag: bytes) -> Pubkey:
    pda, _ = Pubkey.find_program_address(
        [b"proof", bytes(intent), tag], GATEWAY_PROGRAM_ID
    )
    return pda


MAX_CHUNK_LEN = 768  # must match programs/gateway::MAX_CHUNK_LEN


def chunk_pda(intent: Pubkey, tag: bytes, chunk_idx: int) -> Pubkey:
    pda, _ = Pubkey.find_program_address(
        [b"chunk", bytes(intent), tag, bytes([chunk_idx])],
        GATEWAY_PROGRAM_ID,
    )
    return pda


def stage_chunk_ix(
    payer: Pubkey,
    intent: Pubkey,
    tag: bytes,
    chunk_idx: int,
    total_chunks: int,
    chunk: bytes,
) -> Instruction:
    data = (
        disc("stage_chunk")
        + tag
        + chunk_idx.to_bytes(1, "little")
        + total_chunks.to_bytes(1, "little")
        + len(chunk).to_bytes(4, "little")
        + chunk
    )
    return Instruction(
        program_id=GATEWAY_PROGRAM_ID,
        data=data,
        accounts=[
            AccountMeta(pubkey=intent, is_signer=False, is_writable=False),
            AccountMeta(pubkey=chunk_pda(intent, tag, chunk_idx), is_signer=False, is_writable=True),
            AccountMeta(pubkey=payer, is_signer=True, is_writable=True),
            AccountMeta(pubkey=SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
        ],
    )


def execute_chunked_intent_ix(
    rent_recipient: Pubkey,
    intent: Pubkey,
    tag: bytes,
    total_chunks: int,
    verifier_program: Pubkey,
    verifier_config: bytes,
) -> Instruction:
    """Build execute_chunked_intent ix; chunk PDAs go in remaining_accounts."""
    accounts = [
        AccountMeta(pubkey=intent, is_signer=False, is_writable=False),
        AccountMeta(pubkey=nset_pda(intent), is_signer=False, is_writable=True),
        AccountMeta(pubkey=rent_recipient, is_signer=False, is_writable=True),
        AccountMeta(pubkey=verifier_program, is_signer=False, is_writable=False),
        AccountMeta(pubkey=vk_pda(verifier_config), is_signer=False, is_writable=False),
        AccountMeta(pubkey=SYSVAR_INSTRUCTIONS, is_signer=False, is_writable=False),
    ]
    for i in range(total_chunks):
        accounts.append(
            AccountMeta(pubkey=chunk_pda(intent, tag, i), is_signer=False, is_writable=True)
        )
    return Instruction(
        program_id=GATEWAY_PROGRAM_ID,
        data=disc("execute_chunked_intent"),
        accounts=accounts,
    )


def stage_chunked(
    client: Client,
    payer: Keypair,
    intent: Pubkey,
    tag: bytes,
    proof_bytes: bytes,
    pi_bytes: bytes,
) -> int:
    """Split proof||pubs into MAX_CHUNK_LEN-sized chunks and stage each in its
    own init-only PDA. Returns total chunk count."""
    blob = proof_bytes + pi_bytes
    total = (len(blob) + MAX_CHUNK_LEN - 1) // MAX_CHUNK_LEN
    for i in range(total):
        off = i * MAX_CHUNK_LEN
        c = blob[off : off + MAX_CHUNK_LEN]
        send_tx(
            client,
            [stage_chunk_ix(payer.pubkey(), intent, tag, i, total, c)],
            payer,
            label=f"stage_chunk[{i}/{total}] (len={len(c)})",
        )
        wait_for_account(client, chunk_pda(intent, tag, i))
    return total


def stage_proof_ix(
    payer: Pubkey,
    intent: Pubkey,
    tag: bytes,
    proof_bytes: bytes,
    public_inputs_bytes: bytes,
) -> Instruction:
    data = (
        disc("stage_proof")
        + tag
        + len(proof_bytes).to_bytes(4, "little")
        + proof_bytes
        + len(public_inputs_bytes).to_bytes(4, "little")
        + public_inputs_bytes
    )
    return Instruction(
        program_id=GATEWAY_PROGRAM_ID,
        data=data,
        accounts=[
            AccountMeta(pubkey=intent, is_signer=False, is_writable=False),
            AccountMeta(pubkey=proof_pda(intent, tag), is_signer=False, is_writable=True),
            AccountMeta(pubkey=payer, is_signer=True, is_writable=True),
            AccountMeta(pubkey=SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
        ],
    )


def _print_logs(client: Client, sig_str: str) -> None:
    # Use solana CLI to fetch logs reliably even before the rpc cache populates.
    out = subprocess.run(
        [str(SOLANA_BIN / "solana"), "confirm", "-v", sig_str, "--url", "http://127.0.0.1:8899"],
        capture_output=True,
        text=True,
        timeout=10,
    )
    for line in out.stdout.splitlines():
        if "Program log" in line or "Program return" in line or "error" in line.lower():
            print(f"      {line.strip()}")


def stage_full(
    client: Client,
    payer: Keypair,
    intent: Pubkey,
    tag: bytes,
    proof_bytes: bytes,
    pi_bytes: bytes,
) -> None:
    """Stage proof + public_inputs in a single tx (V1-sized circuits only — V2's
    larger publics need versioned-tx + Address Lookup Tables, deferred)."""
    send_tx(
        client,
        [stage_proof_ix(payer.pubkey(), intent, tag, proof_bytes, pi_bytes)],
        payer,
        label="stage_proof",
    )
    wait_for_account(client, proof_pda(intent, tag))


def execute_staged_intent_ix(
    rent_recipient: Pubkey,
    intent: Pubkey,
    tag: bytes,
    verifier_program: Pubkey,
    verifier_config: bytes,
) -> Instruction:
    data = disc("execute_staged_intent")
    return Instruction(
        program_id=GATEWAY_PROGRAM_ID,
        data=data,
        accounts=[
            AccountMeta(pubkey=intent, is_signer=False, is_writable=False),
            AccountMeta(pubkey=nset_pda(intent), is_signer=False, is_writable=True),
            AccountMeta(pubkey=proof_pda(intent, tag), is_signer=False, is_writable=True),
            AccountMeta(pubkey=rent_recipient, is_signer=False, is_writable=True),
            AccountMeta(pubkey=verifier_program, is_signer=False, is_writable=False),
            AccountMeta(pubkey=vk_pda(verifier_config), is_signer=False, is_writable=False),
            AccountMeta(pubkey=SYSVAR_INSTRUCTIONS, is_signer=False, is_writable=False),
        ],
    )


# -----------------------------------------------------------------------------
# Proof orchestration via rabbitsnark CLI (Python rabbit-py wrapper)
# -----------------------------------------------------------------------------
def gen_witness(wasm: Path, input_json: Path, out_wtns: Path) -> None:
    print(f"[witness] {input_json.name} → {out_wtns.name}")
    js = wasm.parent / "generate_witness.js"
    subprocess.run(
        ["node", str(js), str(wasm), str(input_json), str(out_wtns)],
        check=True,
    )


def gen_proof(zkey: Path, wtns: Path, out_proof: Path, out_pub: Path) -> None:
    print(f"[proof] zkey={zkey.name} wtns={wtns.name}")
    env = os.environ.copy()
    env["R1CS_SOLVER_LIB"] = SOLVER_LIB
    subprocess.run(
        [
            str(RABBITSNARK_BIN),
            "circom",
            "prove",
            str(zkey),
            str(out_proof),
            str(out_pub),
            "--wtns",
            str(wtns),
        ],
        check=True,
        env=env,
    )


def cu_limit_ix(units: int) -> Instruction:
    return set_compute_unit_limit(units)
