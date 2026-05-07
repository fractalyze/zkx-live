// Cluster-specific configuration for @zkx/guardrail.
// Used by SDK + demo apps so a single env var switches all of:
//   - Solana RPC endpoint
//   - Guardrail program ID
//   - Default SPL asset (USDC mint per cluster)
//   - cluster_id field bound into IntentBundle (matches circuit constraint)

import { Connection, PublicKey } from '@solana/web3.js';

export type Cluster = 'localnet' | 'devnet' | 'testnet' | 'mainnet';

export const CLUSTER_ID: Record<Cluster, number> = {
  localnet: 0,
  devnet:   1,
  testnet:  2,
  mainnet:  3,
};

export type ClusterConfig = {
  cluster: Cluster;
  clusterId: number;          // bound into intent commitment (replay protection across clusters)
  rpcUrl: string;
  guardrailProgramId: PublicKey;
  usdcMint: PublicKey;
  zkxEndpoint: string;
};

// Defaults per cluster — override any field via env vars (see env_loader below).
const DEFAULTS: Record<Cluster, Omit<ClusterConfig, 'cluster' | 'clusterId'>> = {
  localnet: {
    rpcUrl: 'http://127.0.0.1:8899',
    guardrailProgramId: new PublicKey('GRdRL11111111111111111111111111111111111111'),
    // Use any pre-minted SPL on local validator
    usdcMint: new PublicKey('USDCxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'),
    zkxEndpoint: 'http://127.0.0.1:7000',
  },
  devnet: {
    rpcUrl: 'https://api.devnet.solana.com',
    guardrailProgramId: new PublicKey('GRdRL11111111111111111111111111111111111111'),
    // Devnet USDC (Circle dev mint); request from faucet at https://spl-token-faucet.com
    usdcMint: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
    zkxEndpoint: 'https://prove-dev.zkx.example',
  },
  testnet: {
    rpcUrl: 'https://api.testnet.solana.com',
    guardrailProgramId: new PublicKey('GRdRL11111111111111111111111111111111111111'),
    usdcMint: new PublicKey('USDCxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'),
    zkxEndpoint: 'https://prove-dev.zkx.example',
  },
  mainnet: {
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    guardrailProgramId: new PublicKey('GRdRL11111111111111111111111111111111111111'),
    // USDC mainnet (Circle): EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
    usdcMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    zkxEndpoint: 'https://prove.zkx.example',
  },
};

/**
 * Resolve cluster config. Reads env vars (in priority order):
 *   ZKX_GUARDRAIL_CLUSTER       — cluster name override
 *   ZKX_GUARDRAIL_RPC_URL       — RPC endpoint override
 *   ZKX_GUARDRAIL_PROGRAM_ID    — program ID override
 *   ZKX_GUARDRAIL_USDC_MINT     — asset override
 *   ZKX_GUARDRAIL_ZKX_ENDPOINT  — prover endpoint override
 *
 * Pass an explicit cluster to bypass env.
 */
export function resolveConfig(explicit?: Cluster): ClusterConfig {
  const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
  const cluster = (explicit ?? (env.ZKX_GUARDRAIL_CLUSTER as Cluster) ?? 'devnet');
  if (!(cluster in DEFAULTS)) {
    throw new Error(`Unknown cluster '${cluster}'. Expected one of: ${Object.keys(DEFAULTS).join(', ')}`);
  }
  const d = DEFAULTS[cluster];
  return {
    cluster,
    clusterId: CLUSTER_ID[cluster],
    rpcUrl:             env.ZKX_GUARDRAIL_RPC_URL       ?? d.rpcUrl,
    guardrailProgramId: env.ZKX_GUARDRAIL_PROGRAM_ID    ? new PublicKey(env.ZKX_GUARDRAIL_PROGRAM_ID) : d.guardrailProgramId,
    usdcMint:           env.ZKX_GUARDRAIL_USDC_MINT     ? new PublicKey(env.ZKX_GUARDRAIL_USDC_MINT)  : d.usdcMint,
    zkxEndpoint:        env.ZKX_GUARDRAIL_ZKX_ENDPOINT  ?? d.zkxEndpoint,
  };
}

export function buildConnection(cfg: ClusterConfig): Connection {
  return new Connection(cfg.rpcUrl, 'confirmed');
}
