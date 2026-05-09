#!/usr/bin/env bash
# zkx-live one-time environment setup.
#
# Brings a fresh clone all the way to "ready to start the witness service +
# prover service": clones circom dependency libs, downloads ptau, installs
# node deps for circuits + witness, compiles each circuit (.circom + C++
# witness binary + zkey + vk), and copies program keypairs into target/deploy/
# so anchor finds them at the right declare_id!.
#
# Idempotent — re-running it skips any step whose output already exists.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "[setup] zkx-live one-time setup"
echo "[setup] root = $ROOT"

# -----------------------------------------------------------------------------
# 1. Circom dependency libraries (vendored deps not in the repo for size)
# -----------------------------------------------------------------------------
mkdir -p circuits/deps
if [ ! -d circuits/deps/circom-ecdsa ]; then
    echo "[setup] cloning 0xparc/circom-ecdsa ..."
    git clone --depth 1 https://github.com/0xparc/circom-ecdsa.git circuits/deps/circom-ecdsa
fi
if [ ! -d circuits/deps/efficient-zk-ecdsa ]; then
    echo "[setup] cloning personaelabs/efficient-zk-ecdsa ..."
    git clone --depth 1 https://github.com/personaelabs/efficient-zk-ecdsa.git circuits/deps/efficient-zk-ecdsa
fi

# Symlink circomlib for the embedded deps so their includes resolve.
mkdir -p circuits/deps/circom-ecdsa/node_modules
[ -e circuits/deps/circom-ecdsa/node_modules/circomlib ] \
    || ln -sfn ../../../node_modules/circomlib circuits/deps/circom-ecdsa/node_modules/circomlib
mkdir -p circuits/deps/efficient-zk-ecdsa/node_modules
[ -e circuits/deps/efficient-zk-ecdsa/node_modules/circomlib ] \
    || ln -sfn ../../../node_modules/circomlib circuits/deps/efficient-zk-ecdsa/node_modules/circomlib

# -----------------------------------------------------------------------------
# 2. Powers of Tau — pot15 covers both circuits (intent: 2^14, bounty: 2^15)
# -----------------------------------------------------------------------------
mkdir -p circuits/ptau
PTAU=circuits/ptau/pot15_hez.ptau
if [ ! -f "$PTAU" ]; then
    echo "[setup] downloading pot15_hez.ptau (~32 MB) ..."
    curl -sSL --max-time 600 \
        "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau" \
        -o "$PTAU"
    echo "[setup]   downloaded $(du -h "$PTAU" | cut -f1)"
else
    echo "[setup] pot15_hez.ptau already present"
fi

# -----------------------------------------------------------------------------
# 3. Node deps — circuits/ (circom + snarkjs CLI) and witness/ (Express + circomlibjs)
# -----------------------------------------------------------------------------
echo "[setup] installing circuits/ npm deps ..."
( cd circuits && npm install --quiet )
echo "[setup] installing witness/ npm deps ..."
( cd witness && npm install --quiet )

# -----------------------------------------------------------------------------
# 4. Per-circuit build pipeline: compile → C++ witness binary → zkey → vk
# -----------------------------------------------------------------------------
build_circuit() {
    local c="$1"
    local final_zkey="circuits/build/${c}_final.zkey"
    if [ -f "$final_zkey" ]; then
        echo "[setup] $c: already built (skip — delete $final_zkey to rebuild)"
        return
    fi
    echo "[setup] $c: building ..."
    (
        cd circuits
        circom "$c/$c.circom" --r1cs --c -l node_modules -o build/ >/dev/null
        ( cd "build/${c}_cpp" && make -s )
        ./node_modules/.bin/snarkjs groth16 setup \
            "build/$c.r1cs" "ptau/pot15_hez.ptau" "build/${c}_0000.zkey" 2>&1 | tail -1
        ./node_modules/.bin/snarkjs zkey contribute \
            "build/${c}_0000.zkey" "build/${c}_final.zkey" -e='zkx-live-setup' 2>&1 | tail -1
        ./node_modules/.bin/snarkjs zkey export verificationkey \
            "build/${c}_final.zkey" "build/${c}_vk.json" 2>&1 | tail -1
        rm "build/${c}_0000.zkey"
    )
    echo "[setup] $c: built (zkey $(du -h "$final_zkey" | cut -f1))"
}

build_circuit intent
build_circuit bounty

# -----------------------------------------------------------------------------
# 5. Program keypairs — each program owns its keypair.json; copy into
#    target/deploy/ with anchor's expected naming so cargo-build-sbf sees the
#    IDs that match each program's declare_id!. target/deploy/ is gitignored
#    but anchor expects keypairs to live there.
# -----------------------------------------------------------------------------
mkdir -p target/deploy
cp -n programs/gateway/keypair.json target/deploy/gateway-keypair.json 2>/dev/null || true
cp -n programs/groth16-verifier/keypair.json \
      target/deploy/groth16_verifier-keypair.json 2>/dev/null || true

# -----------------------------------------------------------------------------
# 6. Prover service deps — pip-installable bits only.
#    rabbitsnark / zk_dtypes / jax* / zkx-cuda-pjrt are NOT on PyPI; install
#    those separately from the zkX SDK. The prover/ tree itself is gitignored
#    (deployed to a GPU box, only the HTTP API is exposed).
# -----------------------------------------------------------------------------
if [ -f prover/requirements.txt ]; then
    echo "[setup] installing prover/ pip deps (flask, numpy) ..."
    pip install -q -r prover/requirements.txt || \
        echo "[setup]   pip install failed — install manually if you plan to run the prover locally"
fi

echo "[setup] done"
echo
echo "Next steps:"
echo "  1. Build Solana programs:"
echo "       cargo-build-sbf --manifest-path programs/groth16-verifier/Cargo.toml"
echo "       cargo-build-sbf --manifest-path programs/gateway/Cargo.toml"
echo
echo "  2. Start the witness service (Node, :7001):"
echo "       node witness/app.js"
echo
echo "  3. Start the prover service (Python, :9090) — needs zkX SDK installed separately:"
echo "       python prover/app.py"
echo
echo "  4. Run a demo:"
echo "       python apps/click_to_paid.py <github_username> <owner/repo>"
