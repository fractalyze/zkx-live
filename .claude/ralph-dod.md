# Definition of Done — Stage D+E+F+G: full on-chain claim flow (v2 lean-6)

Replace the apps/bounty `SystemProgram.transfer` shortcut with a real
gateway-routed tx so the bounty payment is gated by **on-chain** proof
verification + **on-chain** nullifier enforcement. Then collapse the
chunked staging path into a single tx by slimming the bounty circuit
to ERC-8150-minimal public inputs (24 → 6).

What's already in place (Stages A+B+C, devnet):
- gateway program  3FYPieR6NZiQYGUx9TNeXGWwaV6ntD6ig2hu9jLi69ZQ
- verifier program Hy878UwGsJpw62Kxio3ySbDXQoy21dR8JgmFrEv338qj
- v2 VK PDA        6j6k3ZqvHumwTwFWFFA3xX2YDZMHS8mWRV4u8iEJnKv9
- v2 Intent PDA    2stqky6ve3jPz6eWw3oPaqXWEutSj1cp4TavzU6peZSd
                   (owner=C77EZ..., schema_id=2, verifier_config=1bc5e8...bd7b)
- Bounty wallet    C77EZ1vMEQs7d32LvDxKZKcvjHuxy5GTRxrxAchMvsJ6 (~5+ SOL)

- [x] `POST /api/claim` (with a logged-in GitHub session + valid recipient pubkey) returns HTTP 200 with `tx_sig`. The corresponding tx, fetched via `solana confirm <tx_sig> --url https://api.devnet.solana.com`, reports `Confirmation Status: Confirmed` (or Finalized) and `Status: Success` / no `Err:` line
- [x] The same tx, fetched via `solana confirm -v <tx_sig> --url https://api.devnet.solana.com`, shows the gateway program id `3FYPieR6NZiQYGUx9TNeXGWwaV6ntD6ig2hu9jLi69ZQ` invoked as a top-level instruction AND the verifier program id `Hy878UwGsJpw62Kxio3ySbDXQoy21dR8JgmFrEv338qj` invoked as an inner instruction (CPI). Logs include `Groth16 OK schema=2 pubs=6` (v2: 6 publics)
- [x] The recipient pubkey passed to `/api/claim` shows a balance increase equal to `BOUNTY_AMOUNT` (10000000 lamports) on devnet after the tx is confirmed
- [x] A second `POST /api/claim` for the same logged-in GitHub user fails on chain with the gateway's `NullifierUsed` error (Anchor error 6012 = 0x177c, msg "Nullifier already used (replay rejected)") in the failed tx's logs
- [x] `apps/bounty/src/pages/api/claim.ts` no longer imports `sendBounty` from `@/lib/solana`; the on-chain step goes through `submitClaimTx` (TS) → `scripts/tx_builder.py` (Python helper) → gateway `execute_intent` ix + sibling `SystemProgram.transfer` in a single tx
- [x] v2 circuit slim: `circuits/bounty/bounty.circom` declares 6 public inputs (intent_root_pub, recipient[2], amount, attestor_Ax, attestor_Ay) and 0 public outputs. `solana confirm -v <v2 tx>` shows `Groth16 OK schema=2 pubs=6`
- [x] Submit wall-clock on devnet (warm prover) is < 1.5 s — single-tx claim, no chunked staging
