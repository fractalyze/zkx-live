// guardrail — ZK-verified policy enforcement for Solana AI agents.
//
// Modular architecture (V1.7):
//   lib.rs         — Anchor entry points, accounts, errors
//   proof.rs       — Groth16 verify + VK parsing + policy extraction
//   policy.rs      — Sibling instruction walk + policy match
//   verifiers/     — Per-action-type extractors (one file per protocol)
//     mod.rs       — Dispatch table
//     spl_token.rs — V1: SPL Token Transfer / TransferChecked
//     system.rs    — V1.6: SystemProgram::Transfer (SOL native)
//     <V2 ...>     — Jupiter, Marinade, etc. — add files, register in mod.rs
//
// Common infrastructure (ZK verify, sysvar walk, PDA mgmt) is reused across
// all action types — only the per-protocol extraction is per-module.

use anchor_lang::prelude::*;

pub mod policy;
pub mod proof;
pub mod verifiers;

declare_id!("w9TPDtPfL14jsapHoS7k1bokwFwNt9V9w7uzhkNyMgv");

pub const PAY_STATIC_NR_INPUTS: usize = 20;

#[program]
pub mod guardrail {
    use super::*;

    /// Initialize an empty Verifying-Key PDA with `vk_size` bytes reserved.
    /// VK is then uploaded via 1+ `write_vk_chunk` calls (Solana tx-data limit).
    pub fn initialize_vk(
        ctx: Context<InitializeVk>,
        circuit_id: u8,
        vk_size: u32,
    ) -> Result<()> {
        let vk_pda = &mut ctx.accounts.vk_pda;
        vk_pda.authority = ctx.accounts.authority.key();
        vk_pda.circuit_id = circuit_id;
        vk_pda.vk_data = vec![0u8; vk_size as usize];
        Ok(())
    }

    /// Append a chunk of VK bytes at the given offset. Authority only.
    pub fn write_vk_chunk(
        ctx: Context<WriteVkChunk>,
        _circuit_id: u8,
        offset: u32,
        chunk: Vec<u8>,
    ) -> Result<()> {
        let vk_pda = &mut ctx.accounts.vk_pda;
        require_keys_eq!(
            vk_pda.authority,
            ctx.accounts.authority.key(),
            GuardRailError::Unauthorized
        );
        let off = offset as usize;
        let end = off + chunk.len();
        require!(end <= vk_pda.vk_data.len(), GuardRailError::InvalidVk);
        vk_pda.vk_data[off..end].copy_from_slice(&chunk);
        Ok(())
    }

    /// Verify a Groth16 proof against the registered VK (no sibling check).
    /// For verification-only flows (e.g., logging, off-chain composition).
    pub fn verify_proof(
        ctx: Context<VerifyProof>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        public_inputs: Vec<[u8; 32]>,
    ) -> Result<()> {
        let vk_pda = &ctx.accounts.vk_pda;
        require_eq!(vk_pda.circuit_id, 0, GuardRailError::UnsupportedCircuit);
        proof::verify_pay_static(&vk_pda.vk_data, &proof_a, &proof_b, &proof_c, &public_inputs)?;
        msg!(
            "ZK proof verified: nullifier_hi={}",
            u64::from_be_bytes(public_inputs[2][24..32].try_into().unwrap())
        );
        Ok(())
    }

    /// Stage proof + public_inputs into a temp PDA so the next atomic tx can
    /// reference it without exceeding Solana's 1232-byte tx limit. The PDA is
    /// CLOSED automatically when `assert_staged_proof` succeeds — V1.5 replay
    /// protection (one stage = one assert).
    pub fn stage_proof(
        ctx: Context<StageProof>,
        _tag: [u8; 32],
        circuit_id: u8,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        public_inputs: Vec<[u8; 32]>,
    ) -> Result<()> {
        require_eq!(public_inputs.len(), PAY_STATIC_NR_INPUTS, GuardRailError::InvalidPublicInputCount);
        let buf = &mut ctx.accounts.proof_pda;
        buf.authority = ctx.accounts.payer.key();
        buf.circuit_id = circuit_id;
        buf.proof_a = proof_a;
        buf.proof_b = proof_b;
        buf.proof_c = proof_c;
        buf.public_inputs = public_inputs;
        Ok(())
    }

    /// Atomic assertion using a previously staged proof PDA. On success:
    ///   1. Groth16 verify passes
    ///   2. Sibling instructions match the policy (recipient + sum amount)
    ///   3. Sibling allowlist holds (only known fund-moving programs)
    ///   4. Staged proof PDA is closed → rent refunded → replay impossible
    pub fn assert_staged_proof(ctx: Context<AssertStagedProof>) -> Result<()> {
        let vk_pda = &ctx.accounts.vk_pda;
        let buf = &ctx.accounts.proof_pda;
        require_eq!(vk_pda.circuit_id, buf.circuit_id, GuardRailError::UnsupportedCircuit);

        proof::verify_pay_static(&vk_pda.vk_data, &buf.proof_a, &buf.proof_b, &buf.proof_c, &buf.public_inputs)?;
        let (recipient, amount) = proof::extract_policy(&buf.public_inputs);
        policy::enforce_sibling_policy(
            &ctx.accounts.instructions_sysvar.to_account_info(),
            recipient,
            amount,
            buf.public_inputs[2],
        )
    }

    /// Inline-args variant of `assert_staged_proof` for circuits whose proof+pubs
    /// fit alongside sibling ix inside the 1232-byte tx limit. Skips the staging
    /// step.
    pub fn assert_zk_proof(
        ctx: Context<AssertZkProof>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        public_inputs: Vec<[u8; 32]>,
    ) -> Result<()> {
        let vk_pda = &ctx.accounts.vk_pda;
        require_eq!(vk_pda.circuit_id, 0, GuardRailError::UnsupportedCircuit);
        proof::verify_pay_static(&vk_pda.vk_data, &proof_a, &proof_b, &proof_c, &public_inputs)?;
        let (recipient, amount) = proof::extract_policy(&public_inputs);
        policy::enforce_sibling_policy(
            &ctx.accounts.instructions_sysvar.to_account_info(),
            recipient,
            amount,
            public_inputs[2],
        )
    }
}

// =================================================================
// Accounts
// =================================================================

#[account]
pub struct VkPda {
    pub authority: Pubkey,
    pub circuit_id: u8,
    pub vk_data: Vec<u8>,
}

#[derive(Accounts)]
#[instruction(circuit_id: u8, vk_size: u32)]
pub struct InitializeVk<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 1 + 4 + vk_size as usize,
        seeds = [b"vk", core::slice::from_ref(&circuit_id)],
        bump
    )]
    pub vk_pda: Account<'info, VkPda>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(circuit_id: u8)]
pub struct WriteVkChunk<'info> {
    #[account(mut, seeds = [b"vk", core::slice::from_ref(&circuit_id)], bump)]
    pub vk_pda: Account<'info, VkPda>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct VerifyProof<'info> {
    #[account(seeds = [b"vk", core::slice::from_ref(&vk_pda.circuit_id)], bump)]
    pub vk_pda: Account<'info, VkPda>,
}

#[derive(Accounts)]
pub struct AssertZkProof<'info> {
    #[account(seeds = [b"vk", core::slice::from_ref(&vk_pda.circuit_id)], bump)]
    pub vk_pda: Account<'info, VkPda>,
    /// CHECK: address-checked at runtime against SYSVAR_INSTRUCTIONS_ID
    pub instructions_sysvar: AccountInfo<'info>,
}

#[account]
pub struct ProofBuffer {
    pub authority: Pubkey,
    pub circuit_id: u8,
    pub proof_a: [u8; 64],
    pub proof_b: [u8; 128],
    pub proof_c: [u8; 64],
    pub public_inputs: Vec<[u8; 32]>,
}

#[derive(Accounts)]
#[instruction(tag: [u8; 32])]
pub struct StageProof<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 1 + 64 + 128 + 64 + 4 + (PAY_STATIC_NR_INPUTS * 32),
        seeds = [b"proof", tag.as_ref()],
        bump
    )]
    pub proof_pda: Account<'info, ProofBuffer>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AssertStagedProof<'info> {
    #[account(seeds = [b"vk", core::slice::from_ref(&vk_pda.circuit_id)], bump)]
    pub vk_pda: Account<'info, VkPda>,
    /// PDA is closed on success — rent refunded → replay impossible.
    #[account(mut, close = rent_recipient)]
    pub proof_pda: Account<'info, ProofBuffer>,
    /// CHECK: receives the closed-account rent refund.
    #[account(mut)]
    pub rent_recipient: AccountInfo<'info>,
    /// CHECK: address-checked at runtime against SYSVAR_INSTRUCTIONS_ID
    pub instructions_sysvar: AccountInfo<'info>,
}

#[error_code]
pub enum GuardRailError {
    #[msg("Circuit ID not supported")]
    UnsupportedCircuit,
    #[msg("Public input count mismatch")]
    InvalidPublicInputCount,
    #[msg("Verifying key data malformed")]
    InvalidVk,
    #[msg("Groth16 proof verification failed")]
    ProofInvalid,
    #[msg("Caller is not the VK authority")]
    Unauthorized,
    #[msg("Sibling instruction is malformed")]
    SiblingMalformed,
    #[msg("Sibling instruction kind not allowed")]
    SiblingDisallowed,
    #[msg("No sibling fund-moving instruction found")]
    SiblingMissing,
    #[msg("Sibling recipient does not match policy commitment")]
    PolicyRecipientMismatch,
    #[msg("Sum of sibling amounts does not match policy commitment")]
    PolicyAmountMismatch,
}
