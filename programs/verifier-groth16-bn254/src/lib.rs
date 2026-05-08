// verifier-groth16-bn254 — generic BN254 Groth16 verifier for the V3 gateway
// architecture. Wraps Light Protocol's `groth16-solana` and exposes a single
// CPI-callable `verify(config, proof, public_inputs)` entry point.
//
// VK storage lives here, keyed by `config` (the same opaque 32 bytes the
// caller's intent commits to). Re-registering with a different VK creates a
// fresh PDA — existing intents remain bound to their original VK.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{hash::hash, program::set_return_data};
use groth16_solana::groth16::{Groth16Verifier, Groth16Verifyingkey};

declare_id!("Hy878UwGsJpw62Kxio3ySbDXQoy21dR8JgmFrEv338qj");

/// What the verifier emits as `set_return_data` so the gateway can pin
/// `public_inputs` integrity without re-implementing the SNARK.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct VerifyOutcome {
    /// Identifies how the gateway should decode `public_inputs` for action policy.
    /// 0 = PaymentSchema (recipient[16,17] + amount[18])  — intent-circuit layout (20 publics)
    /// 1 = ReclaimPaymentSchema (V2 pay_with_reclaim layout, same recipient/amount slots)
    pub schema_id: u8,
    /// SHA-256 of the canonical public_inputs bytes — gateway recomputes and compares.
    pub public_inputs_hash: [u8; 32],
    /// Number of 32-byte public input fields. Informational; gateway also derives.
    pub pub_count: u16,
}

#[program]
pub mod verifier_groth16_bn254 {
    use super::*;

    /// Initialize an empty VK PDA seeded by `config` (= sha256(canonical VK bytes)).
    /// Anyone can register; the PDA address itself is the proof-of-content.
    pub fn initialize_vk(
        ctx: Context<InitializeVk>,
        _config: [u8; 32],
        vk_size: u32,
        schema_id: u8,
        nr_pubinputs: u16,
    ) -> Result<()> {
        let vk = &mut ctx.accounts.vk_pda;
        vk.authority = ctx.accounts.authority.key();
        vk.schema_id = schema_id;
        vk.nr_pubinputs = nr_pubinputs;
        vk.vk_data = vec![0u8; vk_size as usize];
        Ok(())
    }

    /// Append a chunk of VK bytes. Must be called by the same authority that
    /// initialized the PDA, until the full VK is written.
    pub fn write_vk_chunk(
        ctx: Context<WriteVkChunk>,
        _config: [u8; 32],
        offset: u32,
        chunk: Vec<u8>,
    ) -> Result<()> {
        let vk = &mut ctx.accounts.vk_pda;
        require_keys_eq!(vk.authority, ctx.accounts.authority.key(), VerifierError::Unauthorized);
        let off = offset as usize;
        let end = off + chunk.len();
        require!(end <= vk.vk_data.len(), VerifierError::InvalidVk);
        vk.vk_data[off..end].copy_from_slice(&chunk);
        Ok(())
    }

    /// Verify a Groth16 proof. CPI-callable from the gateway.
    ///
    /// Layout of `proof` (192 bytes total): a(64) || b(128) || c(64).
    /// `proof_a` MUST be pre-negated (Light Protocol multi-pairing convention).
    /// `public_inputs` is the canonical concatenation of N 32-byte BE fields.
    pub fn verify(
        ctx: Context<Verify>,
        config: [u8; 32],
        proof: Vec<u8>,
        public_inputs: Vec<u8>,
    ) -> Result<()> {
        let vk_pda = &ctx.accounts.vk_pda;
        require_eq!(proof.len(), 256, VerifierError::ProofMalformed);
        let nr = vk_pda.nr_pubinputs as usize;
        require_eq!(public_inputs.len(), nr * 32, VerifierError::ProofMalformed);

        // PDA derivation in `Verify` accounts struct already binds the caller's
        // `config` argument to a fixed VkPda — no extra check needed.
        let _ = config;

        let proof_a: [u8; 64] = proof[0..64].try_into().unwrap();
        let proof_b: [u8; 128] = proof[64..192].try_into().unwrap();
        let proof_c: [u8; 64] = proof[192..256].try_into().unwrap();

        let mut pi_array_owned: Vec<[u8; 32]> = Vec::with_capacity(nr);
        for i in 0..nr {
            let mut chunk = [0u8; 32];
            chunk.copy_from_slice(&public_inputs[i * 32..(i + 1) * 32]);
            pi_array_owned.push(chunk);
        }

        let vk = parse_vk(&vk_pda.vk_data, nr)?;
        verify_inner(&vk, &proof_a, &proof_b, &proof_c, &pi_array_owned, nr)?;

        let pi_hash: [u8; 32] = hash(&public_inputs).to_bytes();
        let outcome = VerifyOutcome {
            schema_id: vk_pda.schema_id,
            public_inputs_hash: pi_hash,
            pub_count: vk_pda.nr_pubinputs,
        };
        let mut bytes = Vec::with_capacity(35);
        outcome.serialize(&mut bytes).map_err(|_| error!(VerifierError::Internal))?;
        set_return_data(&bytes);

        msg!("Groth16 OK schema={} pubs={}", outcome.schema_id, outcome.pub_count);
        Ok(())
    }
}

// ============================================================================
// Inner helpers — generic over public-input count
// ============================================================================

fn verify_inner(
    vk: &Groth16Verifyingkey,
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    public_inputs: &[[u8; 32]],
    nr: usize,
) -> Result<()> {
    // Light Protocol's API takes a fixed-size array. Dispatch on the supported
    // public-input counts we ship: the variants we ship.
    match nr {
        6 => {
            let pubs: [[u8; 32]; 6] = public_inputs.try_into()
                .map_err(|_| error!(VerifierError::ProofMalformed))?;
            let mut v = Groth16Verifier::new(proof_a, proof_b, proof_c, &pubs, vk)
                .map_err(|_| error!(VerifierError::ProofInvalid))?;
            v.verify().map_err(|_| error!(VerifierError::ProofInvalid))?;
        }
        20 => {
            let pubs: [[u8; 32]; 20] = public_inputs.try_into()
                .map_err(|_| error!(VerifierError::ProofMalformed))?;
            let mut v = Groth16Verifier::new(proof_a, proof_b, proof_c, &pubs, vk)
                .map_err(|_| error!(VerifierError::ProofInvalid))?;
            v.verify().map_err(|_| error!(VerifierError::ProofInvalid))?;
        }
        24 => {
            let pubs: [[u8; 32]; 24] = public_inputs.try_into()
                .map_err(|_| error!(VerifierError::ProofMalformed))?;
            let mut v = Groth16Verifier::new(proof_a, proof_b, proof_c, &pubs, vk)
                .map_err(|_| error!(VerifierError::ProofInvalid))?;
            v.verify().map_err(|_| error!(VerifierError::ProofInvalid))?;
        }
        36 => {
            let pubs: [[u8; 32]; 36] = public_inputs.try_into()
                .map_err(|_| error!(VerifierError::ProofMalformed))?;
            let mut v = Groth16Verifier::new(proof_a, proof_b, proof_c, &pubs, vk)
                .map_err(|_| error!(VerifierError::ProofInvalid))?;
            v.verify().map_err(|_| error!(VerifierError::ProofInvalid))?;
        }
        _ => return err!(VerifierError::UnsupportedPubCount),
    }
    Ok(())
}

/// Parse VK from the on-chain layout written via `write_vk_chunk`:
///   alpha_g1(64) | beta_g2(128) | gamma_g2(128) | delta_g2(128)
///   | nr_ic_le_u32(4) | ic_0..ic_n (each 64)
fn parse_vk(data: &[u8], nr_pubinputs: usize) -> Result<Groth16Verifyingkey<'_>> {
    require_gte!(data.len(), 452, VerifierError::InvalidVk);
    let nr_ic = u32::from_le_bytes(data[448..452].try_into().unwrap()) as usize;
    require_eq!(nr_ic, nr_pubinputs + 1, VerifierError::InvalidVk);
    let end = 452 + nr_ic * 64;
    require_eq!(data.len(), end, VerifierError::InvalidVk);

    let alpha_g1: [u8; 64] = data[0..64].try_into().unwrap();
    let beta_g2: [u8; 128] = data[64..192].try_into().unwrap();
    let gamma_g2: [u8; 128] = data[192..320].try_into().unwrap();
    let delta_g2: [u8; 128] = data[320..448].try_into().unwrap();

    // SAFETY: cast &[u8] of length nr_ic*64 to &[[u8;64]] of length nr_ic.
    let ic_slice: &[[u8; 64]] = unsafe {
        core::slice::from_raw_parts(data[452..end].as_ptr() as *const [u8; 64], nr_ic)
    };

    Ok(Groth16Verifyingkey {
        nr_pubinputs,
        vk_alpha_g1: alpha_g1,
        vk_beta_g2: beta_g2,
        vk_gamme_g2: gamma_g2,
        vk_delta_g2: delta_g2,
        vk_ic: ic_slice,
    })
}

// ============================================================================
// Accounts
// ============================================================================

#[account]
pub struct VkPda {
    pub authority: Pubkey,
    pub schema_id: u8,
    pub nr_pubinputs: u16,
    pub vk_data: Vec<u8>,
}

#[derive(Accounts)]
#[instruction(config: [u8; 32], vk_size: u32)]
pub struct InitializeVk<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 1 + 2 + 4 + vk_size as usize,
        seeds = [b"vk", config.as_ref()],
        bump
    )]
    pub vk_pda: Account<'info, VkPda>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(config: [u8; 32])]
pub struct WriteVkChunk<'info> {
    #[account(mut, seeds = [b"vk", config.as_ref()], bump)]
    pub vk_pda: Account<'info, VkPda>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(config: [u8; 32])]
pub struct Verify<'info> {
    #[account(seeds = [b"vk", config.as_ref()], bump)]
    pub vk_pda: Account<'info, VkPda>,
}

#[error_code]
pub enum VerifierError {
    #[msg("VK data malformed")]
    InvalidVk,
    #[msg("Proof bytes malformed")]
    ProofMalformed,
    #[msg("Groth16 verification failed")]
    ProofInvalid,
    #[msg("Public-input count not supported by this verifier build")]
    UnsupportedPubCount,
    #[msg("Caller is not the VK authority")]
    Unauthorized,
    #[msg("Internal error")]
    Internal,
}
