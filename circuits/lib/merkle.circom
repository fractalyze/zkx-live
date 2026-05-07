pragma circom 2.1.6;

// Merkle membership verification using Poseidon (BN254-friendly).
// `path[i]` is the sibling at level i; `indices[i]` is 0 (left) or 1 (right).
// Outputs the computed root for comparison against the expected root.

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/mux1.circom";

template MerkleVerify(depth) {
    signal input leaf;
    signal input path[depth];
    signal input indices[depth];
    signal output root;

    component muxLeft[depth];
    component muxRight[depth];
    component hashers[depth];

    signal cur[depth + 1];
    cur[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        // indices[i] must be a bit
        indices[i] * (indices[i] - 1) === 0;

        // (left, right) = indices[i] == 0 ? (cur[i], path[i]) : (path[i], cur[i])
        muxLeft[i]  = Mux1();
        muxRight[i] = Mux1();
        muxLeft[i].c[0]  <== cur[i];
        muxLeft[i].c[1]  <== path[i];
        muxLeft[i].s     <== indices[i];

        muxRight[i].c[0] <== path[i];
        muxRight[i].c[1] <== cur[i];
        muxRight[i].s    <== indices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== muxLeft[i].out;
        hashers[i].inputs[1] <== muxRight[i].out;

        cur[i + 1] <== hashers[i].out;
    }

    root <== cur[depth];
}
