"""zkX warm prover HTTP server — proof generation only.

POST /prove   body: {"witness_path": "/abs/path/to/wtns"}
              resp: {"proof": {...}, "public_signals": [...], "timing_ms": {...}}

JAX kernels are JIT-compiled on first prove and cached to disk
($XDG_CACHE_HOME/zkx-jit), so subsequent process restarts skip the
~100 s compile step.

Usage:
    PROVER_ZKEY=/path/to/circuit.zkey python server/prover.py
"""
from __future__ import annotations

import http.server
import json
import os
import socketserver
import threading
import time
import traceback

# NOTE: JAX persistent compilation cache (jax_compilation_cache_dir) conflicts
# with zkx-cuda-pjrt internal options on this build. Server warmup pays the
# JAX compile cost (~100 s for V4) once per process — keep the process up.

import numpy as np
from zk_dtypes import bn254_sf_mont

from rabbitsnark.circom.wtns import parse_wtns
from rabbitsnark.circom.zkey import parse_zkey
from rabbitsnark.circom.zkey_to_terms import zkey_to_terms
from rabbitsnark.groth16 import compile_circom, write_public_signals
from rabbitsnark.r1cs_solver import compute_abc

PORT = int(os.environ.get("PROVER_PORT", "9090"))
ZKEY_PATH = os.environ["PROVER_ZKEY"]
os.environ.setdefault(
    "R1CS_SOLVER_LIB",
    "/data/a41/bazel/a2888a4cffa9ac602adfb78d336aa5fd/execroot/rabbitsnark/"
    "bazel-out/k8-opt/bin/external/r1cs_solver/solver/libr1cs_solver.so",
)


def load():
    print(f"[prover] loading {ZKEY_PATH}")
    t0 = time.time()
    zkey = parse_zkey(ZKEY_PATH)
    print(f"  parse zkey:    {time.time()-t0:.2f}s")
    t0 = time.time()
    compiled = compile_circom(zkey)
    print(f"  compile JAX:   {time.time()-t0:.2f}s")
    t0 = time.time()
    _, coefficients = zkey_to_terms(zkey)
    print(f"  zkey_to_terms: {time.time()-t0:.2f}s")
    return compiled, coefficients


def prove_once(compiled, coefficients, witness_path):
    t = time.time()
    wtns = parse_wtns(witness_path)
    z_std = wtns.data._witnesses
    witness_mont = z_std.view(np.dtype(bn254_sf_mont))
    public_signals = write_public_signals(wtns.witnesses, compiled.config.num_public)
    t_parse = time.time() - t
    t = time.time()
    az_mont, bz_mont = compute_abc(
        witness_mont,
        compiled.terms,
        coefficients,
        compiled.domain_size,
        compiled.domain_size,
    )
    t_abc = time.time() - t
    t = time.time()
    proof, pubs = compiled.prove(z_std, az_mont, bz_mont, public_signals)
    t_prove = time.time() - t
    return proof, pubs, {
        "parse": int(t_parse * 1000),
        "az_bz": int(t_abc * 1000),
        "proof": int(t_prove * 1000),
    }


COMPILED, COEFFS = None, None
LOCK = threading.Lock()


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args, **kwargs):
        return

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": True})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/prove":
            self._send(404, {"error": "not found"})
            return
        try:
            n = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(n))
            with LOCK:
                t0 = time.time()
                proof, pubs, timing = prove_once(COMPILED, COEFFS, req["witness_path"])
                wall = int((time.time() - t0) * 1000)
            timing["wall"] = wall
            print(f"[prover] /prove total={wall}ms az/bz={timing['az_bz']}ms proof={timing['proof']}ms")
            self._send(
                200,
                {"proof": proof.to_json(), "public_signals": pubs, "timing_ms": timing},
            )
        except Exception:
            err = traceback.format_exc()
            print(f"[prover] error:\n{err}")
            self._send(500, {"error": err})

    def _send(self, status, body):
        b = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)


def main():
    global COMPILED, COEFFS
    COMPILED, COEFFS = load()
    print(f"[prover] ready  http://127.0.0.1:{PORT}")
    with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler) as s:
        s.allow_reuse_address = True
        s.serve_forever()


if __name__ == "__main__":
    main()
