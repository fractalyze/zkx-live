// E2E test: serialize VK + proof + public_inputs in the format expected
// by the on-chain guardrail program, then send initialize_vk + verify_proof
// transactions and assert they succeed.
//
// Usage:
//   ts-node sdk/src/onchain_test.ts <vk.json> <proof.json> <public.json>
//
// PROOF_A IS NEGATED HERE (Light Protocol multi-pairing convention).

import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Keypair, Connection } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { exit } from 'node:process';
import * as ffjavascript from 'ffjavascript';

const PROGRAM_ID = new PublicKey('w9TPDtPfL14jsapHoS7k1bokwFwNt9V9w7uzhkNyMgv');
const RPC = process.env.SOLANA_RPC ?? 'http://127.0.0.1:8899';

// ---- BN254 curve helpers ----
const bn128 = await ffjavascript.getCurveFromName('bn128');
const G1 = bn128.G1;
const Fr = bn128.Fr;

function fqToBigInt(s: string): bigint {
  return BigInt(s);
}

// Convert (x, y) decimal strings → 64-byte BE [x|y]
function g1ToBe64(coords: string[]): Buffer {
  const xBytes = bigIntToBe32(BigInt(coords[0]));
  const yBytes = bigIntToBe32(BigInt(coords[1]));
  return Buffer.concat([xBytes, yBytes]);
}

// Negate G1 point: (x, y) -> (x, -y mod p)
const FQ_MODULUS = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
function g1ToBe64Negated(coords: string[]): Buffer {
  const x = BigInt(coords[0]);
  const y = BigInt(coords[1]);
  const negY = (FQ_MODULUS - (y % FQ_MODULUS)) % FQ_MODULUS;
  return Buffer.concat([bigIntToBe32(x), bigIntToBe32(negY)]);
}

// G2: snarkjs format [[x_c0, x_c1], [y_c0, y_c1], [1, 0]]
// Light Protocol expects: [x_c1 (32 BE) | x_c0 (32 BE) | y_c1 (32 BE) | y_c0 (32 BE)]
function g2ToBe128(coords: string[][]): Buffer {
  const x_c0 = BigInt(coords[0][0]);
  const x_c1 = BigInt(coords[0][1]);
  const y_c0 = BigInt(coords[1][0]);
  const y_c1 = BigInt(coords[1][1]);
  return Buffer.concat([
    bigIntToBe32(x_c1),
    bigIntToBe32(x_c0),
    bigIntToBe32(y_c1),
    bigIntToBe32(y_c0),
  ]);
}

function bigIntToBe32(v: bigint): Buffer {
  const buf = Buffer.alloc(32);
  let h = v.toString(16);
  if (h.length > 64) throw new Error('value > 256 bits');
  if (h.length % 2) h = '0' + h;
  const bytes = Buffer.from(h, 'hex');
  bytes.copy(buf, 32 - bytes.length);
  return buf;
}

function publicInputsToBe(pubs: string[]): Buffer[] {
  return pubs.map((s) => bigIntToBe32(BigInt(s)));
}

// VK serialization for our on-chain layout:
//   alpha_g1 (64) | beta_g2 (128) | gamma_g2 (128) | delta_g2 (128)
//   | nr_ic (u32 LE) | ic_0..ic_n (each 64)
function serializeVk(vkJson: any): Buffer {
  const alpha = g1ToBe64(vkJson.vk_alpha_1);
  const beta = g2ToBe128(vkJson.vk_beta_2);
  const gamma = g2ToBe128(vkJson.vk_gamma_2);
  const delta = g2ToBe128(vkJson.vk_delta_2);

  const nrIc = vkJson.IC.length;
  const nrIcLe = Buffer.alloc(4);
  nrIcLe.writeUInt32LE(nrIc, 0);

  const icBufs = vkJson.IC.map((p: string[]) => g1ToBe64(p));

  return Buffer.concat([alpha, beta, gamma, delta, nrIcLe, ...icBufs]);
}

// ---- Anchor instruction discriminators (Anchor uses sha256("global:<name>")[0..8]) ----
import { createHash } from 'node:crypto';
function discriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

// ---- main ----
const [, , vkPath, proofPath, pubPath] = process.argv;
if (!vkPath || !proofPath || !pubPath) {
  console.error('usage: onchain_test.ts <vk.json> <proof.json> <public.json>');
  exit(2);
}

const vkJson = JSON.parse(readFileSync(vkPath, 'utf8'));
const proofJson = JSON.parse(readFileSync(proofPath, 'utf8'));
const pubJson = JSON.parse(readFileSync(pubPath, 'utf8'));

console.log(`VK nPublic: ${vkJson.nPublic}`);
console.log(`Public signals: ${pubJson.length}`);
if (pubJson.length !== 20) {
  console.error('V1 program hardcodes nPublic=20 — circuit must match');
  exit(2);
}

const vkBytes = serializeVk(vkJson);
console.log(`Serialized VK: ${vkBytes.length} bytes`);

const proofA = g1ToBe64Negated(proofJson.pi_a);    // NEGATED
const proofB = g2ToBe128(proofJson.pi_b);
const proofC = g1ToBe64(proofJson.pi_c);
const publicInputs = publicInputsToBe(pubJson);

console.log(`proofA: ${proofA.length}B, proofB: ${proofB.length}B, proofC: ${proofC.length}B, pubs: ${publicInputs.length}*32B`);

const conn = new Connection(RPC, 'confirmed');
const wallet = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, 'utf8')))
);
console.log(`wallet: ${wallet.publicKey.toBase58()}`);
console.log(`balance: ${await conn.getBalance(wallet.publicKey)} lamports`);

const CIRCUIT_ID = 0;
const [vkPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('vk'), Buffer.from([CIRCUIT_ID])],
  PROGRAM_ID,
);
console.log(`vk_pda: ${vkPda.toBase58()}`);

// ---- 1. initialize_vk + chunked write_vk_chunk ----
const existing = await conn.getAccountInfo(vkPda);
if (existing) {
  console.log('vk_pda already exists, skipping init+chunks');
} else {
  console.log('Sending initialize_vk (empty alloc)...');
  const initData = Buffer.concat([
    discriminator('initialize_vk'),
    Buffer.from([CIRCUIT_ID]),
    Buffer.from(new Uint32Array([vkBytes.length]).buffer),
  ]);
  const initIx = new anchor.web3.TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: vkPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: initData,
  });
  let sig = await anchor.web3.sendAndConfirmTransaction(
    conn,
    new anchor.web3.Transaction().add(initIx),
    [wallet],
  );
  console.log(`  initialize_vk tx: ${sig}`);

  // Upload VK in chunks
  const CHUNK_SIZE = 800;
  for (let off = 0; off < vkBytes.length; off += CHUNK_SIZE) {
    const chunk = vkBytes.subarray(off, Math.min(off + CHUNK_SIZE, vkBytes.length));
    const chunkData = Buffer.concat([
      discriminator('write_vk_chunk'),
      Buffer.from([CIRCUIT_ID]),
      Buffer.from(new Uint32Array([off]).buffer),
      Buffer.from(new Uint32Array([chunk.length]).buffer),
      chunk,
    ]);
    const chunkIx = new anchor.web3.TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: vkPda, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      ],
      data: chunkData,
    });
    sig = await anchor.web3.sendAndConfirmTransaction(
      conn,
      new anchor.web3.Transaction().add(chunkIx),
      [wallet],
    );
    console.log(`  write_vk_chunk(off=${off}, len=${chunk.length}): ${sig.slice(0, 16)}...`);
  }
}

// ---- 2. verify_proof ----
console.log('Sending verify_proof...');
const verifyData = Buffer.concat([
  discriminator('verify_proof'),
  proofA,
  proofB,
  proofC,
  Buffer.from(new Uint32Array([publicInputs.length]).buffer),
  ...publicInputs,
]);
console.log(`  verify ix data: ${verifyData.length} bytes`);
const verifyIx = new anchor.web3.TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [{ pubkey: vkPda, isSigner: false, isWritable: false }],
  data: verifyData,
});

// Larger CU budget for groth16 verify (~280k CU per Light Protocol docs)
const cuLimitIx = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });

const verifyTx = new anchor.web3.Transaction().add(cuLimitIx).add(verifyIx);
const t0 = performance.now();
try {
  const sig = await anchor.web3.sendAndConfirmTransaction(conn, verifyTx, [wallet], { commitment: 'confirmed' });
  const elapsed = performance.now() - t0;
  console.log(`\n[OK] verify_proof tx: ${sig}`);
  console.log(`     elapsed: ${elapsed.toFixed(0)} ms (includes RPC RTT + slot wait)`);

  // Fetch tx logs
  const txInfo = await conn.getParsedTransaction(sig, { commitment: 'confirmed' });
  console.log('\n--- program logs ---');
  txInfo?.meta?.logMessages?.forEach((l) => console.log('  ' + l));
} catch (e: any) {
  console.error('\n[FAIL]', e.message ?? e);
  if (e.logs) e.logs.forEach((l: string) => console.error('  ' + l));
  exit(1);
}
