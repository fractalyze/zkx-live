// @zkx/guardrail — public exports
// Implementations land in W3 d1-3 of the build sequence.

export { GuardRail } from './guardrail';
export { IntentBuilder } from './intent_builder';
export { resolveConfig, buildConnection, CLUSTER_ID } from './config';
export type { Cluster, ClusterConfig } from './config';
export type { IntentBundle, ActionType, ActionRequest, ProverProof } from './types';
