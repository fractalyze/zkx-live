# Definition of Done — Stage A: deploy gateway + verifier to devnet

- [x] `cargo-build-sbf --manifest-path programs/verifier-groth16-bn254/Cargo.toml` exits 0
- [x] `cargo-build-sbf --manifest-path programs/gateway/Cargo.toml` exits 0
- [x] Files `target/deploy/verifier_groth16_bn254.so` and `target/deploy/gateway.so` both exist (`ls -la`)
- [x] `solana program show Hy878UwGsJpw62Kxio3ySbDXQoy21dR8JgmFrEv338qj --url https://api.devnet.solana.com` exits 0 and the output's `Program Id` line equals `Hy878UwGsJpw62Kxio3ySbDXQoy21dR8JgmFrEv338qj`
- [x] `solana program show 3FYPieR6NZiQYGUx9TNeXGWwaV6ntD6ig2hu9jLi69ZQ --url https://api.devnet.solana.com` exits 0 and the output's `Program Id` line equals `3FYPieR6NZiQYGUx9TNeXGWwaV6ntD6ig2hu9jLi69ZQ`
- [x] On both `solana program show` outputs, the `Authority` line equals `C77EZ1vMEQs7d32LvDxKZKcvjHuxy5GTRxrxAchMvsJ6`
- [x] `git diff --stat HEAD -- programs/*/src/` shows no changes (no source files under `programs/<program>/src/` were modified)
