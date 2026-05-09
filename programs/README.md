# `programs/` — Solana on-chain programs

Two Anchor programs, deployed to **devnet**:

| Program | Address (devnet) | Role |
| --- | --- | --- |
| `gateway` | `3FYPieR6NZiQYGUx9TNeXGWwaV6ntD6ig2hu9jLi69ZQ` | Verify-and-execute. Accepts a proof + public inputs, CPIs to the verifier, enforces nullifier policy, then atomically executes the bound action (e.g. SOL transfer). |
| `verifier-groth16-bn254` | `Hy878UwGsJpw62Kxio3ySbDXQoy21dR8JgmFrEv338qj` | BN254 Groth16 verifier. Light Protocol's verifier wrapped behind a tiny CPI ABI so the gateway can call it with arbitrary VKs. |

## Why split

The gateway is **prover- and circuit-agnostic** — it only knows
"verify a proof against a registered VK, check the nullifier set,
execute the bound instruction." Plug in a new circuit by registering
its VK; gateway code doesn't change.

The verifier is **circuit-system agnostic** within Groth16/BN254 —
swap to `verifier-plonk` or `verifier-stark` later without touching
the gateway.

## Per-subject nullifier (commit `572e80e`)

For schemas that bind a subject identity (e.g. `claim_subject` =
GitHub user_id), the gateway enforces "**one claim per (intent,
subject)**" independent of recipient. The per-subject nullifier set
is its own PDA (`snset`, seeded `(b"snset", intent_pda)`),
initialized at `register_intent`.

Old intents (pre-`572e80e`) don't have this PDA — re-register with
a fresh SALT to get the full account suite.

## Build + deploy

```bash
cargo-build-sbf --manifest-path programs/verifier-groth16-bn254/Cargo.toml
cargo-build-sbf --manifest-path programs/gateway/Cargo.toml
solana program deploy --program-id programs/gateway/keypair.json \
    target/deploy/gateway.so --url devnet
```

`programs/<program>/keypair.json` are deterministic deploy keypairs
that match each program's `declare_id!` — anyone re-deploying these
binaries gets the same program addresses. **Localnet/devnet only**:
holding these keypairs lets the world upgrade the program, so do not
use them on mainnet.
