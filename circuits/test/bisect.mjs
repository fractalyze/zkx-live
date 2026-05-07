// Bisect what circomlib pattern breaks zkX prover.
// Generates 3 circuits of increasing complexity and reports zkX prove → snarkjs verify.

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const CIRCUITS = {
  // Smallest possible — just a single multiplication (no circomlib)
  trivial: `
pragma circom 2.1.6;
template Trivial() {
  signal input a;
  signal input b;
  signal output c;
  c <== a * b;
}
component main {public [a]} = Trivial();
  `,
  // A single Num2Bits (range check)
  num2bits: `
pragma circom 2.1.6;
include "circomlib/circuits/bitify.circom";
template N2B() {
  signal input x;
  signal output bits[8];
  component n = Num2Bits(8);
  n.in <== x;
  for (var i = 0; i < 8; i++) { bits[i] <== n.out[i]; }
}
component main {public [x]} = N2B();
  `,
  // A single comparator
  lessthan: `
pragma circom 2.1.6;
include "circomlib/circuits/comparators.circom";
template LT() {
  signal input a;
  signal input b;
  signal output out;
  component c = LessThan(64);
  c.in[0] <== a;
  c.in[1] <== b;
  out <== c.out;
}
component main {public [a, b]} = LT();
  `,
};

const INPUTS = {
  trivial:  { a: '7', b: '6' },
  num2bits: { x: '42' },
  lessthan: { a: '5', b: '10' },
};

const SOLVER = '/data/a41/bazel/a2888a4cffa9ac602adfb78d336aa5fd/execroot/rabbitsnark/bazel-out/k8-opt/bin/external/r1cs_solver/solver/libr1cs_solver.so';

mkdirSync('/home/a41/Workspace/zkx-snap/circuits/build/bisect', { recursive: true });

for (const [name, src] of Object.entries(CIRCUITS)) {
  console.log(`\n=== ${name} ===`);
  const dir = `/home/a41/Workspace/zkx-snap/circuits/build/bisect/${name}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${name}.circom`, src);
  writeFileSync(`${dir}/input.json`, JSON.stringify(INPUTS[name]));

  try {
    execSync(`circom ${dir}/${name}.circom --r1cs --wasm --sym -l /home/a41/Workspace/zkx-snap/circuits/node_modules -o ${dir}/`, { stdio: 'pipe' });
    const info = execSync(`npx --prefix /home/a41/Workspace/zkx-snap/circuits snarkjs r1cs info ${dir}/${name}.r1cs 2>&1`).toString();
    const constraints = info.match(/# of Constraints:\s+(\d+)/)?.[1] ?? '?';
    console.log(`  constraints: ${constraints}`);

    execSync(`npx --prefix /home/a41/Workspace/zkx-snap/circuits snarkjs groth16 setup ${dir}/${name}.r1cs /home/a41/Workspace/zkx-snap/circuits/ptau/pot15_hez.ptau ${dir}/0.zkey 2>&1`, { stdio: 'pipe' });
    execSync(`npx --prefix /home/a41/Workspace/zkx-snap/circuits snarkjs zkey contribute ${dir}/0.zkey ${dir}/final.zkey -e=dev 2>&1`, { stdio: 'pipe' });
    execSync(`npx --prefix /home/a41/Workspace/zkx-snap/circuits snarkjs zkey export verificationkey ${dir}/final.zkey ${dir}/vk.json 2>&1`, { stdio: 'pipe' });
    execSync(`npx --prefix /home/a41/Workspace/zkx-snap/circuits snarkjs wtns calculate ${dir}/${name}_js/${name}.wasm ${dir}/input.json ${dir}/wtns.wtns 2>&1`, { stdio: 'pipe' });

    // Vanilla
    execSync(`npx --prefix /home/a41/Workspace/zkx-snap/circuits snarkjs groth16 prove ${dir}/final.zkey ${dir}/wtns.wtns ${dir}/proof_v.json ${dir}/pub_v.json 2>&1`, { stdio: 'pipe' });
    const vanV = execSync(`npx --prefix /home/a41/Workspace/zkx-snap/circuits snarkjs groth16 verify ${dir}/vk.json ${dir}/pub_v.json ${dir}/proof_v.json 2>&1`).toString();
    console.log(`  vanilla → snarkjs verify: ${vanV.includes('OK') ? '✓' : '✗ ' + vanV.split('\n')[0]}`);

    // zkX
    execSync(`R1CS_SOLVER_LIB=${SOLVER} /tmp/zkx-guardrail-venv/bin/rabbitsnark circom prove ${dir}/final.zkey ${dir}/proof_z.json ${dir}/pub_z.json --wtns ${dir}/wtns.wtns 2>&1`, { stdio: 'pipe' });
    const zkxV = execSync(`npx --prefix /home/a41/Workspace/zkx-snap/circuits snarkjs groth16 verify ${dir}/vk.json ${dir}/pub_z.json ${dir}/proof_z.json 2>&1`).toString();
    console.log(`  zkX     → snarkjs verify: ${zkxV.includes('OK') ? '✓' : '✗ ' + zkxV.split('\n')[0]}`);
  } catch (e) {
    console.log(`  FAIL: ${(e.message || String(e)).split('\n')[0]}`);
  }
}
