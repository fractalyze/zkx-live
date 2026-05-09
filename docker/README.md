# `docker/` — production Dockerfiles

Three images, all built with the repo root as build context (see
`docker-compose.yml` at the repo root for wiring).

| File | Image | Base | Notes |
| --- | --- | --- | --- |
| `Dockerfile.bounty` | `zkx-live/bounty` | `node:20-bookworm-slim` | Multi-stage Next.js build. Ships only `.next/standalone/` + `static/` + `public/` (~150 MB). Requires `output: 'standalone'` in `apps/bounty/next.config.js`. |
| `Dockerfile.witness` | `zkx-live/witness` | `node:20-trixie-slim` | **Trixie required** — host-built C++ witness binary needs ≥ GLIBC 2.38; bookworm's 2.36 fails at runtime. Adds `libgmp10` for the witness binary. Mounts `circuits/` read-only at runtime. |
| `Dockerfile.tx_builder` | `zkx-live/tx_builder` | `python:3.11-slim` | Flask + `solana` + `solders`. Imports `apps/lib.py` for gateway helpers. Mounts `bounty.json` keypair + `circuits/build/bounty_vk.json` read-only. |

## What's *not* here

The prover service (`prover/`) is intentionally **not containerized**
— it depends on the closed-source zkX SDK (`rabbitsnark`,
`zk_dtypes`, `jax*`, `zkx-cuda-pjrt`) which isn't on PyPI. We treat
it as an external HTTP dependency that the compose network reaches
via `host.docker.internal:9090`.

## Volume contract

All three containers share `/circuits` (bind mount, read-only) so
zkey/witness binaries built on the host with `bash setup.sh` are
visible without rebuilding images. `bounty` and `witness` also
share a named volume `witness-work` mounted at `/tmp/zkx-live` —
witness writes the `.wtns` there, bounty `readFile`s it before
forwarding to the prover.

## Networking note

Witness and tx_builder default to `127.0.0.1` bind for host dev —
compose sets `WITNESS_HOST=0.0.0.0` / `TX_BUILDER_HOST=0.0.0.0` so
peer containers on the bridge network can reach them. Bind to
loopback inside a container = invisible to the bridge, returns
ECONNREFUSED.
