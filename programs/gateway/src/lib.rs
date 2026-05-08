// gateway — V3 universal proof-verified intent execution layer.
//
// One Solana program. Verifier-agnostic. CPI dispatches proof verification
// to a separately-deployed verifier program (e.g. verifier-groth16-bn254).
// Then the gateway enforces an ERC-8150-style intent commitment + atomic
// sibling-instruction policy (modular `verifiers/` reused from V1.7).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    hash::hash,
    program::{get_return_data, invoke},
    instruction::{Instruction, AccountMeta},
};

pub mod policy;
pub mod verifiers;

declare_id!("3FYPieR6NZiQYGUx9TNeXGWwaV6ntD6ig2hu9jLi69ZQ");

const SCHEMA_PAYMENT: u8 = 0;
const SCHEMA_RECLAIM_PAYMENT: u8 = 1;
const SCHEMA_SELF_ATTEST: u8 = 2;

#[program]
pub mod gateway {
    use super::*;

    /// Owner-signed intent registration. ERC-8150-shaped bundle, hashed off-chain
    /// into `intent_root`; the chain stores the verifier binding + policy
    /// parameters needed at execution time.
    pub fn register_intent(
        ctx: Context<RegisterIntent>,
        salt: [u8; 32],
        verifier_program: Pubkey,
        verifier_config: [u8; 32],
        schema_id: u8,
        intent_root: [u8; 32],
        nullifier_seed: [u8; 32],
        cluster_id: u8,
        expiry: i64,
        // Action-policy commitment (hash of policy params off-chain; re-checked at execute).
        action_policy_root: [u8; 32],
    ) -> Result<()> {
        require!(
            schema_id == SCHEMA_PAYMENT
                || schema_id == SCHEMA_RECLAIM_PAYMENT
                || schema_id == SCHEMA_SELF_ATTEST,
            GatewayError::UnsupportedSchema
        );
        let intent = &mut ctx.accounts.intent_pda;
        intent.owner = ctx.accounts.owner.key();
        intent.salt = salt;
        intent.verifier_program = verifier_program;
        intent.verifier_config = verifier_config;
        intent.schema_id = schema_id;
        intent.intent_root = intent_root;
        intent.nullifier_seed = nullifier_seed;
        intent.cluster_id = cluster_id;
        intent.expiry = expiry;
        intent.action_policy_root = action_policy_root;
        let nset = &mut ctx.accounts.nullifier_set_pda;
        nset.intent = intent.key();
        nset.used = Vec::new();
        msg!(
            "Intent registered owner={} verifier={} schema={}",
            intent.owner,
            verifier_program,
            schema_id
        );
        Ok(())
    }

    /// Stage a proof + public_inputs into a temp PDA in a single tx (works
    /// when `proof + public_inputs ≤ ~1100 B`, e.g. the intent circuit).
    ///
    /// For circuits whose proof+pubs exceed a single tx's 1232 B data limit
    /// (V2 the in-circuit Reclaim variant (deferred) has 1408 B of blob), use `stage_chunk` instead —
    /// each call init-allocates a fresh small PDA so init-time writes
    /// (which persist reliably) are sufficient. `execute_chunked_intent`
    /// then concatenates the chunk PDAs in order.
    pub fn stage_proof(
        ctx: Context<StageProof>,
        _tag: [u8; 32],
        proof: Vec<u8>,
        public_inputs: Vec<u8>,
    ) -> Result<()> {
        require!(proof.len() == MAX_STAGED_PROOF, GatewayError::SiblingMalformed);
        require!(
            public_inputs.len() <= MAX_STAGED_PUBS,
            GatewayError::SiblingMalformed
        );
        let buf = &mut ctx.accounts.proof_pda;
        buf.payer = ctx.accounts.payer.key();
        buf.intent = ctx.accounts.intent_pda.key();
        buf.pubs_size = public_inputs.len() as u32;
        let mut blob = Vec::with_capacity(MAX_STAGED_PROOF + public_inputs.len());
        blob.extend_from_slice(&proof);
        blob.extend_from_slice(&public_inputs);
        buf.blob = blob;
        Ok(())
    }

    /// Atomic execute using a previously staged proof PDA. Same end-to-end
    /// guarantees as `execute_intent`, but reads proof/public_inputs from
    /// the staged PDA rather than the tx data.
    pub fn execute_staged_intent(ctx: Context<ExecuteStagedIntent>) -> Result<()> {
        let intent = &ctx.accounts.intent_pda;
        let now = Clock::get()?.unix_timestamp;
        require!(now < intent.expiry, GatewayError::IntentExpired);
        require_keys_eq!(
            intent.verifier_program,
            ctx.accounts.verifier_program.key(),
            GatewayError::VerifierMismatch
        );
        let buf = &ctx.accounts.proof_pda;
        require_keys_eq!(buf.intent, intent.key(), GatewayError::VerifierMismatch);
        let pubs_size = buf.pubs_size as usize;
        let proof = &buf.blob[..MAX_STAGED_PROOF];
        let pubs = &buf.blob[MAX_STAGED_PROOF..MAX_STAGED_PROOF + pubs_size];
        verify_and_enforce(
            intent,
            &mut ctx.accounts.nullifier_set_pda,
            &ctx.accounts.verifier_program,
            &ctx.accounts.verifier_vk_pda,
            &ctx.accounts.instructions_sysvar.to_account_info(),
            proof,
            pubs,
        )
    }

    /// Stage a single chunk of the proof+pubs blob into a fresh init-only PDA.
    /// Each chunk is its own PDA seeded by (intent, tag, chunk_idx). Works
    /// reliably because init-time writes always persist — we never mutate an
    /// already-existing PDA across tx boundaries.
    ///
    /// Wire format expected by `execute_chunked_intent`:
    ///   - `total_chunks`: same on every chunk_idx for this tag
    ///   - chunks 0..total_chunks must each be staged (in any order)
    ///   - concatenation gives `proof(256) || public_inputs(N)`
    pub fn stage_chunk(
        ctx: Context<StageChunk>,
        _tag: [u8; 32],
        chunk_idx: u8,
        total_chunks: u8,
        chunk: Vec<u8>,
    ) -> Result<()> {
        require!(chunk_idx < total_chunks, GatewayError::SiblingMalformed);
        require!(chunk.len() <= MAX_CHUNK_LEN, GatewayError::SiblingMalformed);
        let buf = &mut ctx.accounts.chunk_pda;
        buf.payer = ctx.accounts.payer.key();
        buf.intent = ctx.accounts.intent_pda.key();
        buf.idx = chunk_idx;
        buf.total = total_chunks;
        buf.data = chunk;
        Ok(())
    }

    /// Execute using N chunk PDAs passed via `remaining_accounts` in order
    /// chunk_idx = 0, 1, ..., total_chunks-1. Each chunk PDA is closed and
    /// rent refunded to `rent_recipient` (replay protection).
    pub fn execute_chunked_intent<'info>(
        ctx: Context<'_, '_, '_, 'info, ExecuteChunkedIntent<'info>>,
    ) -> Result<()> {
        let intent = &ctx.accounts.intent_pda;
        let now = Clock::get()?.unix_timestamp;
        require!(now < intent.expiry, GatewayError::IntentExpired);
        require_keys_eq!(
            intent.verifier_program,
            ctx.accounts.verifier_program.key(),
            GatewayError::VerifierMismatch
        );

        // Concatenate chunks 0..total in order. The remaining_accounts
        // ordering is the caller-provided proof; we re-validate via stored
        // (intent, idx) and `total` consistency.
        require!(!ctx.remaining_accounts.is_empty(), GatewayError::SiblingMalformed);
        let mut chunks: Vec<(u8, Vec<u8>)> = Vec::with_capacity(ctx.remaining_accounts.len());
        let mut expected_total: Option<u8> = None;
        let mut total_lamports: u64 = 0;
        for acc in ctx.remaining_accounts.iter() {
            let buf: ChunkBuffer = ChunkBuffer::try_deserialize(
                &mut acc.try_borrow_data()?.as_ref(),
            )
            .map_err(|_| error!(GatewayError::SiblingMalformed))?;
            require_keys_eq!(buf.intent, intent.key(), GatewayError::VerifierMismatch);
            match expected_total {
                None => expected_total = Some(buf.total),
                Some(t) => require!(t == buf.total, GatewayError::SiblingMalformed),
            }
            chunks.push((buf.idx, buf.data));
            total_lamports = total_lamports
                .checked_add(acc.lamports())
                .ok_or(error!(GatewayError::SiblingMalformed))?;
        }
        let total = expected_total.unwrap();
        require!(
            chunks.len() as u8 == total,
            GatewayError::SiblingMalformed
        );
        chunks.sort_by_key(|(idx, _)| *idx);
        for (i, (idx, _)) in chunks.iter().enumerate() {
            require!(i as u8 == *idx, GatewayError::SiblingMalformed);
        }
        let mut blob = Vec::new();
        for (_, data) in chunks.iter() {
            blob.extend_from_slice(data);
        }
        require!(blob.len() >= MAX_STAGED_PROOF, GatewayError::SiblingMalformed);
        let proof = &blob[..MAX_STAGED_PROOF];
        let pubs = &blob[MAX_STAGED_PROOF..];

        verify_and_enforce(
            intent,
            &mut ctx.accounts.nullifier_set_pda,
            &ctx.accounts.verifier_program,
            &ctx.accounts.verifier_vk_pda,
            &ctx.accounts.instructions_sysvar.to_account_info(),
            proof,
            pubs,
        )?;

        // Manual close of each chunk PDA (Anchor's `close` constraint can't be
        // applied to remaining_accounts — we drain lamports + zero the data).
        let rent_dst = &ctx.accounts.rent_recipient;
        for acc in ctx.remaining_accounts.iter() {
            require_keys_eq!(*acc.owner, *ctx.program_id, GatewayError::VerifierMismatch);
            let lamports = acc.lamports();
            **rent_dst.try_borrow_mut_lamports()? = rent_dst
                .lamports()
                .checked_add(lamports)
                .ok_or(error!(GatewayError::SiblingMalformed))?;
            **acc.try_borrow_mut_lamports()? = 0;
            let mut data = acc.try_borrow_mut_data()?;
            for b in data.iter_mut() {
                *b = 0;
            }
        }
        let _ = total_lamports;
        Ok(())
    }

    /// Atomic execute:
    ///   1. CPI to intent.verifier_program::verify(config, proof, public_inputs)
    ///   2. Read return data, assert public_inputs hash + schema_id match.
    ///   3. Compute nullifier and reject if used; record otherwise.
    ///   4. Decode public_inputs by schema → (recipient, amount).
    ///   5. Run sibling-ix policy enforcement (V1.7 modular verifiers).
    ///
    /// Inline variant — only fits if proof+pubs+sibling-ix ≤ 1232 tx-data limit.
    /// For larger circuits use `stage_proof` + `execute_staged_intent`.
    pub fn execute_intent(
        ctx: Context<ExecuteIntent>,
        proof: Vec<u8>,
        public_inputs: Vec<u8>,
    ) -> Result<()> {
        let intent = &ctx.accounts.intent_pda;

        let now = Clock::get()?.unix_timestamp;
        require!(now < intent.expiry, GatewayError::IntentExpired);
        require_keys_eq!(
            intent.verifier_program,
            ctx.accounts.verifier_program.key(),
            GatewayError::VerifierMismatch
        );
        verify_and_enforce(
            intent,
            &mut ctx.accounts.nullifier_set_pda,
            &ctx.accounts.verifier_program,
            &ctx.accounts.verifier_vk_pda,
            &ctx.accounts.instructions_sysvar.to_account_info(),
            &proof,
            &public_inputs,
        )
    }
}

// Internal — shared between inline + staged variants.
fn verify_and_enforce<'info>(
    intent: &Account<'info, IntentPda>,
    nset: &mut Account<'info, NullifierSetPda>,
    verifier_program: &AccountInfo<'info>,
    verifier_vk_pda: &AccountInfo<'info>,
    instructions_sysvar: &AccountInfo<'info>,
    proof: &[u8],
    public_inputs: &[u8],
) -> Result<()> {
    // CPI -> verifier_program::verify(config, proof, public_inputs)
    let mut data = Vec::with_capacity(8 + 32 + 4 + proof.len() + 4 + public_inputs.len());
    data.extend_from_slice(&VERIFY_DISCRIMINATOR);
    data.extend_from_slice(&intent.verifier_config);
    data.extend_from_slice(&(proof.len() as u32).to_le_bytes());
    data.extend_from_slice(proof);
    data.extend_from_slice(&(public_inputs.len() as u32).to_le_bytes());
    data.extend_from_slice(public_inputs);

    let cpi_ix = Instruction {
        program_id: intent.verifier_program,
        accounts: vec![AccountMeta::new_readonly(verifier_vk_pda.key(), false)],
        data,
    };
    invoke(&cpi_ix, &[verifier_vk_pda.clone()])?;

    let (returning_program, ret_bytes) =
        get_return_data().ok_or(error!(GatewayError::VerifierNoReturnData))?;
    require_keys_eq!(
        returning_program,
        intent.verifier_program,
        GatewayError::VerifierMismatch
    );
    let outcome = VerifyOutcome::try_from_slice(&ret_bytes)
        .map_err(|_| error!(GatewayError::VerifierBadReturnData))?;

    let pi_hash: [u8; 32] = hash(public_inputs).to_bytes();
    require!(
        outcome.public_inputs_hash == pi_hash,
        GatewayError::PublicInputsMismatch
    );
    require_eq!(
        outcome.schema_id,
        intent.schema_id,
        GatewayError::SchemaMismatch
    );

    let nullifier = compute_nullifier(&intent.nullifier_seed, outcome.schema_id, &pi_hash);
    require!(!nset.used.contains(&nullifier), GatewayError::NullifierUsed);
    nset.used.push(nullifier);

    let (recipient, amount) = decode_payment_schema(
        public_inputs,
        outcome.pub_count as usize,
        outcome.schema_id,
    )?;
    policy::enforce_sibling_policy(instructions_sysvar, recipient, amount, nullifier)?;

    msg!(
        "ExecuteOk intent={} recipient={} amount={}",
        intent.key(),
        recipient,
        amount
    );
    let _ = verifier_program;
    Ok(())
}

/// Anchor's `global:verify` instruction discriminator (sha256("global:verify")[0..8]).
/// Hardcoded so the gateway doesn't pull the verifier's IDL crate.
const VERIFY_DISCRIMINATOR: [u8; 8] = [0x85, 0xa1, 0x8d, 0x30, 0x78, 0xc6, 0x58, 0x96];

fn compute_nullifier(seed: &[u8; 32], schema_id: u8, pi_hash: &[u8; 32]) -> [u8; 32] {
    let mut buf = [0u8; 65];
    buf[..32].copy_from_slice(seed);
    buf[32] = schema_id;
    buf[33..65].copy_from_slice(pi_hash);
    hash(&buf).to_bytes()
}

/// Decode (recipient, amount) from canonical public_inputs bytes for the
/// supported schemas. Slots are dictated by the snarkjs convention of
/// "outputs first, then inputs":
///
/// schema 0 (PaymentSchema, intent circuit, 20 publics):
///   [16, 17] = recipient halves, [18] = amount
/// schema 1 (ReclaimPaymentSchema, the in-circuit Reclaim variant (deferred) V2, 36 publics):
///   The circuit injects 8 extra `attestor_pubkey_out` outputs before the
///   instruction-encoding outputs, AND 8 extra `attestor_pubkey` inputs at
///   the tail. So the recipient/amount triplet shifts by 8 → [24, 25, 26].
fn decode_payment_schema(
    public_inputs: &[u8],
    pub_count: usize,
    schema_id: u8,
) -> Result<(Pubkey, u64)> {
    let recipient_hi_slot = match schema_id {
        SCHEMA_PAYMENT => 16usize,
        SCHEMA_RECLAIM_PAYMENT => 24usize,
        // bounty circuit, ERC-8150-minimal layout (6 publics):
        //   0: intent_root_pub
        //   1: recipient_hi
        //   2: recipient_lo
        //   3: amount
        //   4: attestor_Ax
        //   5: attestor_Ay
        SCHEMA_SELF_ATTEST => 1usize,
        _ => return err!(GatewayError::UnsupportedSchema),
    };
    let amount_slot = recipient_hi_slot + 2;
    require!(pub_count > amount_slot, GatewayError::PublicInputsMismatch);
    require_eq!(
        public_inputs.len(),
        pub_count * 32,
        GatewayError::PublicInputsMismatch
    );
    let mut recipient_bytes = [0u8; 32];
    recipient_bytes[..16].copy_from_slice(
        &public_inputs[recipient_hi_slot * 32 + 16..recipient_hi_slot * 32 + 32],
    );
    recipient_bytes[16..].copy_from_slice(
        &public_inputs[(recipient_hi_slot + 1) * 32 + 16..(recipient_hi_slot + 1) * 32 + 32],
    );
    let amount_bytes: [u8; 8] = public_inputs[amount_slot * 32 + 24..amount_slot * 32 + 32]
        .try_into()
        .unwrap();
    let amount = u64::from_be_bytes(amount_bytes);
    Ok((Pubkey::new_from_array(recipient_bytes), amount))
}

// Mirror of verifier-groth16-bn254::VerifyOutcome — keep in sync with that
// crate. Defined here to avoid a heavy CPI crate dependency.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
struct VerifyOutcome {
    schema_id: u8,
    public_inputs_hash: [u8; 32],
    pub_count: u16,
}

// ============================================================================
// Accounts
// ============================================================================

#[account]
pub struct IntentPda {
    pub owner: Pubkey,
    pub salt: [u8; 32],
    pub verifier_program: Pubkey,
    pub verifier_config: [u8; 32],
    pub schema_id: u8,
    pub intent_root: [u8; 32],
    pub nullifier_seed: [u8; 32],
    pub cluster_id: u8,
    pub expiry: i64,
    pub action_policy_root: [u8; 32],
}

#[account]
pub struct NullifierSetPda {
    pub intent: Pubkey,
    pub used: Vec<[u8; 32]>,
}

#[derive(Accounts)]
#[instruction(salt: [u8; 32])]
pub struct RegisterIntent<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 32 + 32 + 32 + 1 + 32 + 32 + 1 + 8 + 32,
        seeds = [b"intent", owner.key().as_ref(), salt.as_ref()],
        bump
    )]
    pub intent_pda: Account<'info, IntentPda>,
    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 4 + (32 * MAX_NULLIFIERS),
        seeds = [b"nset", intent_pda.key().as_ref()],
        bump
    )]
    pub nullifier_set_pda: Account<'info, NullifierSetPda>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

const MAX_NULLIFIERS: usize = 64;

#[derive(Accounts)]
pub struct ExecuteIntent<'info> {
    pub intent_pda: Account<'info, IntentPda>,
    #[account(mut, seeds = [b"nset", intent_pda.key().as_ref()], bump)]
    pub nullifier_set_pda: Account<'info, NullifierSetPda>,
    /// CHECK: address-checked at runtime against intent.verifier_program.
    pub verifier_program: AccountInfo<'info>,
    /// CHECK: passed through to verifier CPI; verifier asserts its own seeds.
    pub verifier_vk_pda: AccountInfo<'info>,
    /// CHECK: address-checked at runtime against SYSVAR_INSTRUCTIONS_ID.
    pub instructions_sysvar: AccountInfo<'info>,
}

pub const MAX_STAGED_PROOF: usize = 256;       // a||b||c = 256
pub const MAX_STAGED_PUBS: usize = 36 * 32;    // V2 layout (36 publics)
pub const STAGED_BLOB_LEN: usize = MAX_STAGED_PROOF + MAX_STAGED_PUBS;

#[account]
pub struct ProofBuffer {
    pub payer: Pubkey,
    pub intent: Pubkey,
    pub pubs_size: u32,
    pub blob: Vec<u8>,
}

pub const MAX_CHUNK_LEN: usize = 768; // ix data fits with disc+tag+u8+u8+vec_len+chunk

#[account]
pub struct ChunkBuffer {
    pub payer: Pubkey,
    pub intent: Pubkey,
    pub idx: u8,
    pub total: u8,
    pub data: Vec<u8>,
}

#[derive(Accounts)]
#[instruction(tag: [u8; 32], chunk_idx: u8)]
pub struct StageChunk<'info> {
    pub intent_pda: Account<'info, IntentPda>,
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 32 + 1 + 1 + 4 + MAX_CHUNK_LEN,
        seeds = [b"chunk", intent_pda.key().as_ref(), tag.as_ref(), &[chunk_idx]],
        bump
    )]
    pub chunk_pda: Account<'info, ChunkBuffer>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteChunkedIntent<'info> {
    pub intent_pda: Account<'info, IntentPda>,
    #[account(mut, seeds = [b"nset", intent_pda.key().as_ref()], bump)]
    pub nullifier_set_pda: Account<'info, NullifierSetPda>,
    /// CHECK: receives the closed chunk-PDAs' rent refund.
    #[account(mut)]
    pub rent_recipient: AccountInfo<'info>,
    /// CHECK: address-checked at runtime against intent.verifier_program.
    pub verifier_program: AccountInfo<'info>,
    /// CHECK: passed through to verifier CPI; verifier asserts its own seeds.
    pub verifier_vk_pda: AccountInfo<'info>,
    /// CHECK: address-checked at runtime against SYSVAR_INSTRUCTIONS_ID.
    pub instructions_sysvar: AccountInfo<'info>,
    // remaining_accounts = chunk PDAs in any order (we sort by idx); each is mut
}

#[derive(Accounts)]
#[instruction(tag: [u8; 32])]
pub struct StageProof<'info> {
    pub intent_pda: Account<'info, IntentPda>,
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 32 + 4 + 4 + STAGED_BLOB_LEN,
        seeds = [b"proof", intent_pda.key().as_ref(), tag.as_ref()],
        bump
    )]
    pub proof_pda: Account<'info, ProofBuffer>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteStagedIntent<'info> {
    pub intent_pda: Account<'info, IntentPda>,
    #[account(mut, seeds = [b"nset", intent_pda.key().as_ref()], bump)]
    pub nullifier_set_pda: Account<'info, NullifierSetPda>,
    /// PDA closed on success → rent refunded → replay impossible.
    #[account(mut, close = rent_recipient)]
    pub proof_pda: Account<'info, ProofBuffer>,
    /// CHECK: receives the closed-account rent refund.
    #[account(mut)]
    pub rent_recipient: AccountInfo<'info>,
    /// CHECK: address-checked at runtime against intent.verifier_program.
    pub verifier_program: AccountInfo<'info>,
    /// CHECK: passed through to verifier CPI; verifier asserts its own seeds.
    pub verifier_vk_pda: AccountInfo<'info>,
    /// CHECK: address-checked at runtime against SYSVAR_INSTRUCTIONS_ID.
    pub instructions_sysvar: AccountInfo<'info>,
}

#[error_code]
pub enum GatewayError {
    #[msg("Intent expired")]
    IntentExpired,
    #[msg("Verifier program key does not match intent commitment")]
    VerifierMismatch,
    #[msg("Verifier returned no return-data")]
    VerifierNoReturnData,
    #[msg("Verifier return-data malformed")]
    VerifierBadReturnData,
    #[msg("public_inputs hash does not match verifier outcome")]
    PublicInputsMismatch,
    #[msg("schema_id mismatch between intent and verifier outcome")]
    SchemaMismatch,
    #[msg("Schema id not supported")]
    UnsupportedSchema,
    #[msg("Sibling instruction missing or malformed")]
    SiblingMissing,
    #[msg("Sibling instruction kind not allowed")]
    SiblingDisallowed,
    #[msg("Sibling instruction is malformed")]
    SiblingMalformed,
    #[msg("Sibling recipient does not match policy commitment")]
    PolicyRecipientMismatch,
    #[msg("Sum of sibling amounts does not match policy commitment")]
    PolicyAmountMismatch,
    #[msg("Nullifier already used (replay rejected)")]
    NullifierUsed,
    #[msg("InvalidVk")]
    InvalidVk,
}
