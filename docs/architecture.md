# Architecture

## Verifier-agnostic dispatch (the core trick)

The Anchor program never matches on action type. It only:
1. Looks up the VK by `current_intent.vk_id`
2. Verifies the Groth16 proof against that VK
3. Checks fixed public-input invariants (`vk_id`, `intent_root`, `nullifier`)
4. Extracts a Solana instruction from the rest of public inputs
5. PDA-signs and CPI-invokes that instruction

This means **adding a new action type requires zero program code changes**:
- Off-chain: write a new Circom circuit emitting the same fixed public-input schema
- Off-chain: generate the new VK
- On-chain: call `register_vk(new_vk_id, vk_data)` — single instruction call

The circuit itself enforces the policy. The wallet program is just a verifier + executor.

## Why Groth16 over PLONK (deviation from ERC-8150)

ERC-8150 spec recommends PLONK to defeat proof malleability (third party can re-randomize a Groth16 proof and it still verifies). We chose Groth16 because zkX is 2x faster on it.

Mitigation for malleability: every proof is bound to a unique `nullifier` in public inputs. Even if a Groth16 proof is malleable, the nullifier makes each proof one-shot — re-using a proof tries to reuse the nullifier and the program rejects.

This is a documented trade-off, not a vulnerability.

## ERC-8150 mapping

See [`spec.md` §2](../spec.md#2-erc-8150--solana-native-mapping) for the full element-by-element mapping.

## Trust model (V1)

| Component | Trust assumption |
|---|---|
| User intent signature | User's Phantom keypair |
| Circuit correctness | Open-source Circom code, audit before mainnet |
| zkX prover | Self-hosted (no liveness dependency on third party) |
| Light Protocol verifier | Open-source, audited (~280k CU per verify) |
| Solana network | Standard Solana liveness assumptions |
| **(V2) Reclaim attestor** | Reclaim's MPC committee or self-hosted attestor |

## Failure modes

| Failure | Impact |
|---|---|
| zkX prover down | Can fall back to vanilla snarkjs (slower, but works) |
| Solana RPC down | Standard Solana outage; reverts when chain resumes |
| Circuit bug | Could allow invalid policy to pass; mitigation = audit + formal verification before V2 mainnet |
| VK registration with malicious VK | Guardrail authority compromise → can drain. Mitigation: VK registration timelock in V2 |
| Phantom compromise | Standard wallet compromise; intent signing requires user approval |

## V2/V3 evolution

- V2: add `pay_with_reclaim.circom` + register_vk(1). No program change.
- V3: add `swap.circom` + register_vk(2). Plus extend ALLOWED_PROGRAMS list (this IS a program change — see notes below).

### One V3 caveat

V1 hardcodes ALLOWED_PROGRAMS to just SPL token. V3 needs to add Jupiter, Marinade, etc. Two options:
1. **Hardcode V3 program list at V1 time** (preferred — make ALLOWED_PROGRAMS large from day 1)
2. **Add a `register_allowed_program(program_id)` instruction in V1** — keeps program upgrade unnecessary forever

We pick option 2 in V1 design — small extra cost, future-proof.
