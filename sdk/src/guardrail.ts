// GuardRail — main SDK class.
// Implementation lands in W3 d1-3 of the build sequence.
// See ../../spec.md §6.

import type { PublicKey } from '@solana/web3.js';
import type { IntentBundle, ActionRequest, ProverProof } from './types';

export type GuardRailConfig = {
  wallet: unknown;            // Phantom-compatible wallet adapter
  intent: IntentBundle;
  zkxEndpoint: string;
  cluster: 'localnet' | 'devnet' | 'mainnet';
  programId?: PublicKey;
};

export class GuardRail {
  static async create(_cfg: GuardRailConfig): Promise<GuardRail> {
    // TODO W3 d1
    throw new Error('not implemented');
  }

  /** Fund the guardrail PDA-owned ATA with SPL tokens. */
  async fund(_amount: bigint): Promise<string> {
    // TODO W3 d1
    throw new Error('not implemented');
  }

  /** Generic action signing — V1 supports Pay only. */
  async signAction(_action: ActionRequest): Promise<{ txSignature: string; proofTimeMs: number; settleTimeMs: number }> {
    // TODO W3 d2
    // 1. checkPolicy(action) — off-chain pre-flight (~5 ms)
    // 2. buildWitness(action) — V2: includes Reclaim fetch
    // 3. requestProof(witness) — call zkX prover, ~250 ms target
    // 4. buildSolanaTx(action, proof) — verify_and_execute instruction
    // 5. wallet.signAndSend(tx)
    throw new Error('not implemented');
  }

  /** Convenience: V1 Pay action. */
  async requestPayment(_args: { recipient: PublicKey; amount: bigint }) {
    // TODO W3 d2: thin wrapper over signAction with Pay kind
    throw new Error('not implemented');
  }

  /** Off-chain pre-flight (no proof gen, no on-chain submit). */
  checkPolicy(_action: ActionRequest): void {
    // TODO W3 d2
  }

  private async _requestProof(_witness: unknown): Promise<ProverProof> {
    // TODO W3 d2: HTTP POST to zkxEndpoint/prove
    throw new Error('not implemented');
  }
}
