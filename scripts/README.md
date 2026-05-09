# `scripts/` — one-shot ops + long-running services

| Script | Type | Purpose |
| --- | --- | --- |
| `setup-onchain.py` | one-shot | Stage B+C of devnet bring-up: upload bounty VK to the verifier program, register the intent on the gateway. Idempotent (skips existing PDAs). Bumps **SALT** to rotate the intent + nullifier set. Currently v5: `b"\x55"*32`. |
| `tx_builder.py` | service | Flask micro-service (port `:7100`) that takes `{recipient, proof, public_signals}` and submits the gateway tx (proof_a pre-negation, BE field encoding, chunked staging, sibling System.transfer). Mirrors `apps/lib.py` so we don't reimplement the gateway helpers in TS. |
| `start.sh` | ops | Bring up the full prod stack: prover (host nohup) → docker compose → tailscale funnel. Prints the public URL at the end. |
| `stop.sh` | ops | Reverse, in dependency-safe order. |
| `status.sh` | ops | One-shot health probe: 4 service `/health` curls, `docker compose ps`, `tailscale funnel status`. Read-only. |

## Service ports

| Service | Port | Bind | Where |
| --- | --- | --- | --- |
| `prover` | 9090 | host | host process (closed-source zkX SDK) |
| `witness` | 7001 | docker | compose internal |
| `tx_builder` | 7100 | docker | compose internal |
| `bounty` | 3002 | docker | host-published (Tailscale Funnel target) |

`scripts/start.sh` sets `PROVER_HOST=0.0.0.0` so the host prover is
reachable from docker containers via `host.docker.internal:9090`.
The other two services accept a `WITNESS_HOST` / `TX_BUILDER_HOST`
env (default `127.0.0.1`) — compose overrides both to `0.0.0.0`.

## Rotating the intent (fresh nullifier set)

Bump SALT in both files in lockstep:

```diff
-SALT = b"\x55" * 32          # v5
+SALT = b"\x56" * 32          # v6
```

Then re-run `setup-onchain.py` — it derives a new intent PDA and
initializes a fresh nullifier set, so accounts that already claimed
under the old intent can claim again under the new one.
