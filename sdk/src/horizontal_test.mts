// Horizontal-module e2e + V1.5 security tests.
//
// Tx flow:
//   Tx1 stage_proof(tag, proof, pubs)             → ProofBuffer PDA
//   Tx2 [assert_staged_proof + spl_transfer]      → atomic
//                                                   PDA closed on success
//
// Verifies:
//   - Scenario A: assert alone (no sibling)        → SiblingMissing
//   - Scenario B: wrong recipient                  → PolicyRecipientMismatch
//   - Scenario C: correct recipient + amount       → PASS
//   - Scenario D (V1.5): replay same staged proof  → AccountNotInitialized
//   - Scenario E (V1.5): non-SPL sibling injection → SiblingDisallowed

import {
  PublicKey, Keypair, Connection, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, ComputeBudgetProgram, SystemProgram,
} from '@solana/web3.js';
import { createTransferInstruction } from '@solana/spl-token';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const PROGRAM_ID = new PublicKey('w9TPDtPfL14jsapHoS7k1bokwFwNt9V9w7uzhkNyMgv');
const SYSVAR_INSTRUCTIONS_PUBKEY = new PublicKey('Sysvar1nstructions1111111111111111111111111');
const RPC = 'http://127.0.0.1:8899';
const FQ_MOD = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

function bigIntToBe32(v: bigint): Buffer {
  const buf = Buffer.alloc(32);
  let h = v.toString(16);
  if (h.length % 2) h = '0' + h;
  Buffer.from(h, 'hex').copy(buf, 32 - h.length / 2);
  return buf;
}
const g1 = (c: string[]) => Buffer.concat([bigIntToBe32(BigInt(c[0])), bigIntToBe32(BigInt(c[1]))]);
const g1Neg = (c: string[]) => {
  const y = BigInt(c[1]); const negY = (FQ_MOD - (y % FQ_MOD)) % FQ_MOD;
  return Buffer.concat([bigIntToBe32(BigInt(c[0])), bigIntToBe32(negY)]);
};
const g2 = (c: string[][]) => Buffer.concat([
  bigIntToBe32(BigInt(c[0][1])), bigIntToBe32(BigInt(c[0][0])),
  bigIntToBe32(BigInt(c[1][1])), bigIntToBe32(BigInt(c[1][0])),
]);
const disc = (n: string) => createHash('sha256').update(`global:${n}`).digest().slice(0, 8);

const [, , vkPath, proofPath, pubPath] = process.argv;
const vkJson = JSON.parse(readFileSync(vkPath, 'utf8'));
const proofJson = JSON.parse(readFileSync(proofPath, 'utf8'));
const pubJson: string[] = JSON.parse(readFileSync(pubPath, 'utf8'));
const proofA = g1Neg(proofJson.pi_a);
const proofB = g2(proofJson.pi_b);
const proofC = g1(proofJson.pi_c);
const publicInputs = pubJson.map(s => bigIntToBe32(BigInt(s)));

const recHi = publicInputs[16].subarray(16, 32);
const recLo = publicInputs[17].subarray(16, 32);
const expectedRecipient = new PublicKey(Buffer.concat([recHi, recLo]));
const expectedAmount = publicInputs[18].subarray(24, 32).readBigUInt64BE(0);
console.log(`Policy: recipient=${expectedRecipient.toBase58()} amount=${expectedAmount}`);

const conn = new Connection(RPC, 'confirmed');
const wallet = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, 'utf8')))
);

const CIRCUIT_ID = 0;
const [vkPda] = PublicKey.findProgramAddressSync([Buffer.from('vk'), Buffer.from([CIRCUIT_ID])], PROGRAM_ID);

async function stageProof(tag: Buffer): Promise<PublicKey> {
  const [proofPda] = PublicKey.findProgramAddressSync([Buffer.from('proof'), tag], PROGRAM_ID);
  const data = Buffer.concat([
    disc('stage_proof'),
    tag,
    Buffer.from([CIRCUIT_ID]),
    proofA, proofB, proofC,
    Buffer.from(new Uint32Array([publicInputs.length]).buffer),
    ...publicInputs,
  ]);
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: proofPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  await sendAndConfirmTransaction(conn, new Transaction().add(ix), [wallet]);
  return proofPda;
}

function buildAssertIx(proofPda: PublicKey) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: vkPda, isSigner: false, isWritable: false },
      { pubkey: proofPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: false, isWritable: true },  // rent_recipient
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: disc('assert_staged_proof'),
  });
}

const cuLimit = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });
const fakeFromAta = Keypair.generate();

async function expectFail(label: string, expected: string, fn: () => Promise<string>) {
  console.log(`\n=== ${label} ===`);
  console.log(`Expected: ${expected}`);
  try {
    const sig = await fn();
    console.log(`  unexpected SUCCESS: ${sig}`);
  } catch (e: any) {
    const msg = e.message ?? String(e);
    const logs = e.logs ?? [];
    const matched = logs.some((l: string) => l.includes(expected)) || msg.includes(expected);
    if (matched) {
      console.log(`  [OK] correctly rejected: ${expected}`);
    } else {
      console.log('  failed (other reason):', msg.split('\n')[0]);
      logs.filter((l: string) => l.includes('GuardRail') || l.includes('Error')).slice(-3).forEach((l: string) => console.log('    ' + l));
    }
  }
}

// === Scenario A: assertion alone (no sibling) ===
{
  const tag = randomBytes(32);
  const proofPda = await stageProof(tag);
  await expectFail('Scenario A: assert alone', 'SiblingMissing', async () => {
    return await sendAndConfirmTransaction(conn, new Transaction().add(cuLimit).add(buildAssertIx(proofPda)), [wallet]);
  });
}

// === Scenario B: wrong recipient ===
{
  const tag = randomBytes(32);
  const proofPda = await stageProof(tag);
  await expectFail('Scenario B: wrong recipient', 'PolicyRecipientMismatch', async () => {
    const wrongRecipient = Keypair.generate().publicKey;
    const wrongIx = createTransferInstruction(fakeFromAta.publicKey, wrongRecipient, wallet.publicKey, expectedAmount);
    return await sendAndConfirmTransaction(conn, new Transaction().add(cuLimit).add(buildAssertIx(proofPda)).add(wrongIx), [wallet]);
  });
}

// === Scenario C: correct policy ===
{
  const tag = randomBytes(32);
  const proofPda = await stageProof(tag);
  console.log('\n=== Scenario C: correct recipient + amount ===');
  console.log('Expected: GuardRail OK + PDA closed (rent refunded)');
  try {
    const correctIx = createTransferInstruction(fakeFromAta.publicKey, expectedRecipient, wallet.publicKey, expectedAmount);
    const tx = new Transaction().add(cuLimit).add(buildAssertIx(proofPda)).add(correctIx);
    const sig = await sendAndConfirmTransaction(conn, tx, [wallet]);
    console.log(`  unexpected full success: ${sig}`);
  } catch (e: any) {
    const logs = e.logs ?? [];
    const guardOk = logs.some((l: string) => l.includes('GuardRail OK'));
    if (guardOk) {
      console.log('  [OK] guardrail PASSED (logs:)');
      logs.filter((l: string) => l.includes('GuardRail')).forEach((l: string) => console.log('    ' + l));
      // Check PDA was closed
      const acct = await conn.getAccountInfo(proofPda);
      if (acct === null) {
        console.log('  [OK] proof PDA closed (replay protection active)');
      } else {
        console.log('  [WARN] proof PDA still exists');
      }
    } else {
      console.log('  failed:', e.message?.split('\n')[0]);
      logs.slice(-5).forEach((l: string) => console.log('    ' + l));
    }
  }
}

// === Scenario D (V1.5): replay protection ===
{
  console.log('\n=== Scenario D (V1.5): replay attempt on same staged proof ===');
  console.log('Expected: AccountNotInitialized (PDA already closed)');
  const tag = randomBytes(32);
  const proofPda = await stageProof(tag);
  // First assert: should pass (then close)
  let firstRan = true;
  try {
    const correctIx = createTransferInstruction(fakeFromAta.publicKey, expectedRecipient, wallet.publicKey, expectedAmount);
    await sendAndConfirmTransaction(conn, new Transaction().add(cuLimit).add(buildAssertIx(proofPda)).add(correctIx), [wallet]);
  } catch (e: any) {
    const logs = e.logs ?? [];
    if (!logs.some((l: string) => l.includes('GuardRail OK'))) {
      console.log('  setup: first assert did NOT run guardrail logic — skip D');
      firstRan = false;
    }
  }
  if (firstRan) {
    // Second assert: PDA should be gone (closed by first)
    await expectFail('  D-replay attempt', 'AccountNotInitialized', async () => {
      const correctIx = createTransferInstruction(fakeFromAta.publicKey, expectedRecipient, wallet.publicKey, expectedAmount);
      return await sendAndConfirmTransaction(conn, new Transaction().add(cuLimit).add(buildAssertIx(proofPda)).add(correctIx), [wallet]);
    });
  }
}

// === Scenario E (V1.5): non-SPL sibling injection ===
{
  console.log('\n=== Scenario E (V1.5): non-SPL sibling injection ===');
  console.log('Expected: SiblingDisallowed (SystemProgram::Transfer rejected)');
  const tag = randomBytes(32);
  const proofPda = await stageProof(tag);
  await expectFail('  E-block', 'SiblingDisallowed', async () => {
    // Inject a SystemProgram::Transfer (drains SOL) — must be blocked.
    const sysTransferIx = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    });
    return await sendAndConfirmTransaction(conn, new Transaction().add(cuLimit).add(buildAssertIx(proofPda)).add(sysTransferIx), [wallet]);
  });
}

console.log('\n=== All scenarios complete ===');
