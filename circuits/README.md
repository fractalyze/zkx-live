# circuits/

Circom circuits compiled to Groth16 BN254. Each action type = one circuit + one VK.

## Circuits

| File | Action type | VK ID | Status | Constraints (target) |
|---|---|---|---|---|
| `pay_static.circom` | Pay (static allowlist) | 0 | V1 — in development | ~12,000 |
| `pay_with_reclaim.circom` | PayWithReclaim (zkTLS conditional) | 1 | V2 — planned | ~50,000 |
| `swap.circom` | Swap (slippage cap) | 2 | V3 — planned | ~30,000 |

## Public-input schema (FIXED across all circuits)

The wallet program is verifier-agnostic. Every circuit MUST emit public inputs in this exact layout:

| Slot | Field | Type | Used by program |
|---|---|---|---|
| `[0]` | `vk_id` | u8 (Fr) | Validates intent.vk_id |
| `[1]` | `intent_root` | bytes32 (Fr) | Validates against current intent |
| `[2]` | `nullifier` | bytes32 (Fr) | Replay protection |
| `[3]` | `instruction_program_id` | Pubkey (Fr × 2) | Embedded in CPI |
| `[4..6]` | `instruction_accounts_hash` | bytes32 (Fr × 2) | Validated against expected accounts |
| `[6..N]` | `instruction_data` | variable | Used as-is in CPI |

Total fixed slots: 6 fields. Action-specific data starts at slot `[6]`.

## Build

```bash
cd circuits
# circom 2.x + snarkjs required
circom pay_static.circom --r1cs --wasm --sym -o build/
snarkjs groth16 setup build/pay_static.r1cs ptau/pot15_final.ptau build/pay_static_0000.zkey
snarkjs zkey contribute build/pay_static_0000.zkey build/pay_static_final.zkey
snarkjs zkey export verificationkey build/pay_static_final.zkey build/pay_static_vk.json
```

## Test

```bash
cd test
npm test pay_static.test.ts
```

## Lib

Shared sub-circuits in `lib/`:
- `poseidon.circom` — from circomlib
- `merkle.circom` — Merkle membership proof (depth 8)
- `instruction_encode.circom` — Solana SPL transfer instruction encoder
