#!/usr/bin/env bash
# zkx-snap one-time environment setup.
#
# Clones the circom dependency libraries (NOT vendored in the repo for size)
# and downloads the Powers of Tau ceremony file required for Groth16 setup
# of the larger circuits (V2 / V4).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "[setup] zkx-snap one-time setup"
echo "[setup] root = $ROOT"

# 1. Circom dependency libraries
mkdir -p circuits/deps
if [ ! -d circuits/deps/circom-ecdsa ]; then
    echo "[setup] cloning 0xparc/circom-ecdsa ..."
    git clone --depth 1 https://github.com/0xparc/circom-ecdsa.git circuits/deps/circom-ecdsa
fi
if [ ! -d circuits/deps/efficient-zk-ecdsa ]; then
    echo "[setup] cloning personaelabs/efficient-zk-ecdsa ..."
    git clone --depth 1 https://github.com/personaelabs/efficient-zk-ecdsa.git circuits/deps/efficient-zk-ecdsa
fi

# Symlink circomlib for the embedded deps (so includes resolve)
mkdir -p circuits/deps/circom-ecdsa/node_modules
[ -e circuits/deps/circom-ecdsa/node_modules/circomlib ] \
    || ln -sfn ../../../node_modules/circomlib circuits/deps/circom-ecdsa/node_modules/circomlib
mkdir -p circuits/deps/efficient-zk-ecdsa/node_modules
[ -e circuits/deps/efficient-zk-ecdsa/node_modules/circomlib ] \
    || ln -sfn ../../../node_modules/circomlib circuits/deps/efficient-zk-ecdsa/node_modules/circomlib

# 2. Powers of Tau (only needed for V2/V4 ≥ 1M-constraint circuits)
mkdir -p circuits/ptau
PTAU=circuits/ptau/pot22_hez.ptau
if [ ! -f "$PTAU" ]; then
    echo "[setup] downloading pot22_hez.ptau (4.6 GB — only needed for V2/V4) ..."
    curl -sSL --max-time 600 \
        "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_22.ptau" \
        -o "$PTAU"
    echo "[setup]   downloaded $(du -h $PTAU | cut -f1)"
else
    echo "[setup] pot22_hez.ptau already present"
fi

# 3. Node deps
echo "[setup] installing circuits/ npm deps ..."
( cd circuits && npm install --quiet )

# 4. Program keypairs — copy from keys/ → target/deploy/ so cargo-build-sbf
#    will recognize the IDs (target/deploy/ is gitignored but anchor expects
#    keypairs to live there).
mkdir -p target/deploy
cp -n keys/gateway-keypair.json target/deploy/ 2>/dev/null || true
cp -n keys/verifier_groth16_bn254-keypair.json target/deploy/ 2>/dev/null || true

echo "[setup] done"
echo
echo "Next steps:"
echo "  1. Build programs:"
echo "       cargo-build-sbf --manifest-path programs/verifier-groth16-bn254/Cargo.toml"
echo "       cargo-build-sbf --manifest-path programs/gateway/Cargo.toml"
echo
echo "  2. Compile + zkey for the star_bounty demo circuit:"
echo "       cd circuits"
echo "       circom star_bounty.circom --r1cs --c -l node_modules -o build/"
echo "       ./node_modules/.bin/snarkjs groth16 setup build/star_bounty.r1cs ptau/pot22_hez.ptau build/star_bounty_0000.zkey"
echo "       ./node_modules/.bin/snarkjs zkey contribute build/star_bounty_0000.zkey build/star_bounty_final.zkey -e='snap'"
echo "       ./node_modules/.bin/snarkjs zkey export verificationkey build/star_bounty_final.zkey build/star_bounty_vk.json"
echo "       ( cd build/star_bounty_cpp && make )"
echo
echo "  3. Start the prover service (warm GPU, ~3 s startup):"
echo "       PROVER_ZKEY=\$PWD/circuits/build/star_bounty_final.zkey \\"
echo "         python server/prover.py"
echo
echo "  4. Run the click → paid demo:"
echo "       python server/click_to_paid.py <github_username> <owner/repo>"
