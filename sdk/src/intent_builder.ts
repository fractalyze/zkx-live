// IntentBuilder — convenience factories for IntentBundle.
// V1: staticAllowlistPay only.
// V2: bountyForGitHubStar, reclaimSourcedPay (no SDK breaking change).
// V3: jupiterSwap, marinadeStake, etc.

import type { PublicKey } from '@solana/web3.js';
import type { IntentBundle } from './types';

export const IntentBuilder = {
  // ===== V1 =====
  staticAllowlistPay(_args: {
    recipients: PublicKey[];
    amountCap: bigint;
    maxPerRecipient: bigint;
    asset: PublicKey;
    expiry: bigint;
  }): IntentBundle {
    // TODO W3 d1:
    //   1. Build Merkle tree from recipients (depth 8 → 256 max recipients)
    //   2. Compute Poseidon hash of intent fields
    //   3. Return IntentBundle ready for user to sign
    throw new Error('not implemented');
  },

  // ===== V2 (post-hackathon) =====
  bountyForGitHubStar(_args: {
    repo: string;
    amountPerClaim: bigint;
    totalBudget: bigint;
    expiry: bigint;
  }): IntentBundle {
    throw new Error('V2 — not implemented yet');
  },

  reclaimSourcedPay(_args: {
    sourceUrl: string;
    fieldPath: string;
    amountPerRecipient: bigint;
    maxTotal: bigint;
    expiry: bigint;
  }): IntentBundle {
    throw new Error('V2 — not implemented yet');
  },

  // ===== V3 =====
  jupiterSwap(_args: {
    fromAsset: PublicKey;
    toAsset: PublicKey;
    maxInput: bigint;
    slippageBps: number;
    expiry: bigint;
  }): IntentBundle {
    throw new Error('V3 — not implemented yet');
  },
};
