# `witness/` — input fixture + witness gen HTTP service

A long-running Node service that turns a **high-level intent + recipient
+ amount** request into a **circom witness file** that the zkX prover
can consume.

```
caller ──HTTP──> witness service ──spawn──> circom C++ witness gen
                  (Poseidon/Merkle/EdDSA)    (built from `circom --c`)
```

It exists for two reasons:

1. **Avoid Node startup cost per request.** circomlibjs (Poseidon,
   EdDSA, BabyJubjub) takes ~1 s to initialize. We pay that once at
   service startup, not on every witness build.
2. **Match in-circuit hashing exactly.** The intent commitment, Merkle
   root, EdDSA signature, etc. are all in-circuit Poseidon. Computing
   them outside the circuit with the *same library* the circuit uses
   eliminates the parameter-mismatch class of bugs (a common silent
   failure mode in ZK toolchains).

---

## Run

```bash
cd witness
npm install
node app.js                      # listens on :7001
```

Required: the C++ witness binaries must already be built at

    circuits/build/intent_cpp/intent
    circuits/build/bounty_cpp/bounty

(see top-level setup.sh / README for `circom --c` + `make` steps).

Env vars:

| Var                | Default                          | Purpose                                  |
| ------------------ | -------------------------------- | ---------------------------------------- |
| `WITNESS_PORT`     | `7001`                           | Listen port                              |
| `CIRCUITS_DIR`     | `../circuits` (rel. to this dir) | Where to find `build/<circuit>_cpp/`     |
| `WITNESS_WORK_DIR` | `/tmp/zkx-snap`                  | Where to drop input.json + .wtns files   |

---

## HTTP API

All bodies are JSON. Strings vs numbers are interchangeable for numeric
fields (we coerce with `String(x)`).

### `GET /health`

```json
{"ok": true}
```

### `POST /witness/intent`

Request body:

```json
{
  "recipient_b58": "5T2VVxXk4...",
  "amount": "5000000",
  "nonce": 1,
  "now": 1778044189,

  "intent": {
    "amount_cap":          "100000000",
    "max_per_recipient":   "10000000",
    "expiry":              "1778648989",
    "asset":               ["24197857200151252728969465429440056815",
                            "338769989521388930494245921488005055265"],
    "salt":                "16045690984503098046",
    "min_valid_nonce":     "0",
    "cluster_id":          "1",
    "allowlist":           ["5T2VVxXk4...", "9aBcDef..."]
  },

  "wallet_pda":              ["22685491...", "45370982..."],
  "recipient_token_account": ["68056473...", "90741964..."]
}
```

Required fields are validated; missing ones return HTTP 500 with
`{"error": "intent: missing nonce"}` etc. Optional: `now` (defaults
to current unix sec).

Response:

```json
{
  "wtns_path":  "/tmp/zkx-snap/intent_<uuid>.wtns",
  "input_path": "/tmp/zkx-snap/intent_<uuid>.input.json",
  "public_inputs": {
    "intent_root_pub": "...",
    "recipient":       ["...", "..."],
    "amount":          "5000000",
    "now":             "1778044189"
  },
  "timing_ms": {
    "build_input":  3,
    "witness_gen": 10,
    "total":       13
  }
}
```

The caller passes `wtns_path` to the prover service:

```bash
curl -s :8000/prove -d '{"witness_path":"/tmp/zkx-snap/intent_xxx.wtns"}'
```

### `POST /witness/bounty`

Same shape as `intent` plus the attestation layer. The `intent`
sub-object replaces `cluster_id`/`min_valid_nonce` with `window_start`
(claim-trigger semantics differ from the nonce-floor model).

The `claim` is a generic (subject, object, timestamp) tuple — any
attested external state, not just GitHub stars. Pick whatever encoding
fits the attestor:
- GitHub star:    `subject=user_id`, `object="<owner>/<repo>"`
- Twitter follow: `subject=twitter_id`, `object="<followed_handle>"`
- Plaid balance:  `subject=account_id`, `object="balance≥50k"`

You can also pre-hash the object yourself and pass `object_hash`
instead of `object` if you've computed the field encoding off-band.

Request body:

```json
{
  "recipient_b58": "5T2VVxXk4...",
  "amount": "5000000",
  "now": 1778044189,

  "intent": {
    "amount_cap":        "100000000",
    "max_per_recipient": "10000000",
    "window_start":      "1",
    "expiry":            "1778648989",
    "asset":             ["...", "..."],
    "salt":              "16045690984503098046",
    "allowlist":         ["5T2VVxXk4...", "..."]
  },

  "claim": {
    "subject":   "424242",
    "object":    "octocat/Hello-World",
    "timestamp": 1778044100
  },
  "attestor_priv_hex": "1111111111111111111111111111111111111111111111111111111111111111",

  "wallet_pda":              ["...", "..."],
  "recipient_token_account": ["...", "..."]
}
```

Response: same shape as `intent`, plus `attestor_Ax` / `attestor_Ay`
in `public_inputs` (the BabyJubjub pubkey of the signing attestor).

---

## What happens per request

```
   POST /witness/<circuit>
            │
            ▼
   builder(body, deps)        ← intent/builder.js or bounty/builder.js
   ├─ validate (amount caps, expiry/window, allowlist membership, ...)
   ├─ Poseidon Merkle build over allowlist  (depth-8 padded tree)
   ├─ Compute intent_root_pub               (Poseidon-9 with vk_id baked in)
   ├─ EdDSA-BabyJubjub sign claim           (bounty only)
   └─ return {input, public_inputs}
            │
            ▼
   write input.json → /tmp/zkx-snap/<id>.input.json
            │
            ▼
   spawn circuits/build/<circuit>_cpp/<circuit>  input.json  wtns_path
            │
            ▼
   return {wtns_path, public_inputs, timing_ms}
```

Typical per-request timing (16k-constraint bounty):
- `build_input`: 3–8 ms (Poseidon over ~10 hashes + EdDSA sign)
- `witness_gen`: ~10 ms (C++ binary, native speed)
- **total: ~15 ms warm**

(Cold start: +1 s to init circomlibjs once at process boot.)

---

## File layout

```
witness/
  app.js                 Express HTTP entry — wraps the two builders
  intent/builder.js          buildInput() — pure function, takes init'd
                         circomlibjs primitives via `deps`
  bounty/builder.js         buildInput() — same, plus EdDSA + claim layer
  util.js                shared helpers: b58 decode, Merkle build/proof
  package.json           "type": "module" — deps: express, circomlibjs
  README.md              this file
```

---

## Composition with the prover service

Two services, two roles:

```
apps/click_to_paid.py
  ├─ POST :7001/witness/bounty {high-level intent + claim}
  │      → {wtns_path, public_inputs, timing}
  ├─ POST :8000/prove {wtns_path}
  │      → {proof, public_signals, timing}
  └─ Solana submit
```

The prover (zkX) is **prover-agnostic** w.r.t. the witness side — anyone
can swap a different Groth16 prover into that slot as long as it
consumes a circom `.wtns` and outputs a proof matching the verifier
key registered on-chain.
