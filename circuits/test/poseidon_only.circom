pragma circom 2.1.6;

// Minimal bisect circuit: just Poseidon(2 inputs) — to test if zkX proof
// generation works on circomlib Poseidon at all.

include "circomlib/circuits/poseidon.circom";

template PoseidonOnly() {
    signal input a;
    signal input b;
    signal output h;

    component p = Poseidon(2);
    p.inputs[0] <== a;
    p.inputs[1] <== b;
    h <== p.out;
}

component main {public [a, b]} = PoseidonOnly();
