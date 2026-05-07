// Shared types for @zkx/guardrail.
// Mirror programs/guardrail/src/state/mod.rs.

import type { PublicKey } from '@solana/web3.js';

export type IntentBundle = {
  action: ActionType;
  global: GlobalConstraints;
  // signature added when serialized for on-chain registration
};

export type ActionType =
  // V1
  | { kind: 'Pay'; recipientsMerkleRoot: Uint8Array; amountCap: bigint; asset: PublicKey; maxPerRecipient: bigint }
  // V2 (no contract upgrade — circuit + register_vk only)
  | { kind: 'PayWithReclaim'; condition: ReclaimCondition; amountPerClaim: bigint; totalBudget: bigint }
  // V3
  | { kind: 'Swap'; fromAsset: PublicKey; toAsset: PublicKey; maxInput: bigint; slippageBps: number; allowedDexesRoot: Uint8Array }
  | { kind: 'Stake'; validatorAllowlistRoot: Uint8Array; minAmount: bigint; maxAmount: bigint; maxLockPeriod: bigint }
  | { kind: 'Vote'; proposalAllowlistRoot: Uint8Array; maxVotingPower: bigint }
  | { kind: 'Compose'; subIntents: IntentBundle[]; order: 'Sequential' | 'Parallel' };

export type ReclaimCondition =
  | { kind: 'GitHubStar'; repo: string }
  | { kind: 'NotionAttendee'; pageHash: Uint8Array; fieldPath: string }
  | { kind: 'GenericJsonPath'; urlHash: Uint8Array; path: string; expectedHash: Uint8Array };

export type GlobalConstraints = {
  expiry: bigint;        // unix seconds
  totalValueCap: bigint;
  nonceWindowStart: bigint;
};

export type ActionRequest = {
  // V1: { recipient, amount }
  // V2+: dispatched per ActionType
  [key: string]: unknown;
};

export type ProverProof = {
  proof: Uint8Array;        // 192 bytes Groth16
  publicInputs: Uint8Array; // serialized field elements
  proofTimeMs: number;
};
