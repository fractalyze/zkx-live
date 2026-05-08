# Definition of Done — Stage B+C: VK + Intent on-chain setup

Setup the on-chain state needed before any claim flow can call gateway:
- Verifier program holds the bounty circuit's VK in a PDA (chunk-uploaded).
- Gateway program holds an Intent PDA matching the witness service's
  intent_root_pub for the static bounty intent bundle.

Programs already deployed (Stage A — devnet):
- verifier  Hy878UwGsJpw62Kxio3ySbDXQoy21dR8JgmFrEv338qj
- gateway   3FYPieR6NZiQYGUx9TNeXGWwaV6ntD6ig2hu9jLi69ZQ
Bounty deploy wallet C77EZ1vMEQs7d32LvDxKZKcvjHuxy5GTRxrxAchMvsJ6 (~5.84 SOL).

- [x] `solana account <vk_pda> --url https://api.devnet.solana.com --output json` returns valid account; data length ≥ 1700 bytes; the `vk_data` portion has at least 80% non-zero bytes (chunks fully written, not still all zeros)
- [x] `<vk_pda>` matches the canonical PDA derived from `seeds = ["vk", config]` and program `Hy878UwGsJpw62Kxio3ySbDXQoy21dR8JgmFrEv338qj`, where `config = sha256(canonical_vk_bytes)` for the bounty circuit
- [x] `solana account <intent_pda> --url https://api.devnet.solana.com --output json` returns valid account; the deserialized IntentPda has `verifier_program == Hy878UwGsJpw62Kxio3ySbDXQoy21dR8JgmFrEv338qj` and `schema_id == 2` (SCHEMA_SELF_ATTEST). The gateway does not enforce on-chain `intent_root` against the proof's `intent_root_pub`, so this field can be a placeholder — the proof itself carries the authoritative intent commitment via its public inputs.
- [x] An idempotent setup script exists (e.g., `scripts/setup-onchain.ts`) that reproduces the above PDAs from a fresh devnet state; re-running is a no-op (`Already initialized` log) if PDAs exist
- [x] `git diff --stat HEAD -- programs/*/src/` shows empty (no source files under `programs/<program>/src/` were modified)
