// ZK proof verification — wraps Light Protocol's groth16-solana behind a single
// `verify(...)` entry point and a fixed VK serialization layout.

use anchor_lang::prelude::*;
use groth16_solana::groth16::{Groth16Verifier, Groth16Verifyingkey};

use crate::{GuardRailError, PAY_STATIC_NR_INPUTS};

/// Verify a Groth16 proof for the V1 pay_static circuit.
///
/// `proof_a` MUST be pre-negated by the SDK (Light Protocol multi-pairing
/// convention). Returns Ok if both `Groth16Verifier::new` and `verify` succeed.
pub fn verify_pay_static(
    vk_data: &[u8],
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    public_inputs: &[[u8; 32]],
) -> Result<()> {
    require_eq!(
        public_inputs.len(),
        PAY_STATIC_NR_INPUTS,
        GuardRailError::InvalidPublicInputCount
    );

    let vk = parse_vk(vk_data)?;
    let pubs_array: [[u8; 32]; PAY_STATIC_NR_INPUTS] = public_inputs
        .try_into()
        .map_err(|_| error!(GuardRailError::InvalidPublicInputCount))?;

    let mut verifier = Groth16Verifier::new(proof_a, proof_b, proof_c, &pubs_array, &vk)
        .map_err(|_| error!(GuardRailError::ProofInvalid))?;
    verifier
        .verify()
        .map_err(|_| error!(GuardRailError::ProofInvalid))?;

    Ok(())
}

/// Extract (recipient, amount) from the V1 pay_static public_inputs layout.
///
/// public_inputs slots:
///   [16..18] = recipient pubkey, split as 2x 16-byte BE limbs in slot[16][16..32], slot[17][16..32]
///   [18]     = amount (u64 in last 8 bytes BE)
pub fn extract_policy(public_inputs: &[[u8; 32]]) -> (Pubkey, u64) {
    let mut recipient_bytes = [0u8; 32];
    recipient_bytes[..16].copy_from_slice(&public_inputs[16][16..32]);
    recipient_bytes[16..].copy_from_slice(&public_inputs[17][16..32]);
    let recipient = Pubkey::new_from_array(recipient_bytes);
    let amount = u64::from_be_bytes(public_inputs[18][24..32].try_into().unwrap());
    (recipient, amount)
}

/// Parse a serialized VK out of the on-chain layout written by the SDK:
///   bytes 0..64    alpha_g1
///   bytes 64..192  beta_g2
///   bytes 192..320 gamma_g2
///   bytes 320..448 delta_g2
///   bytes 448..452 nr_ic (u32 LE)
///   bytes 452..    ic_0..ic_n (each 64 bytes)
fn parse_vk(data: &[u8]) -> Result<Groth16Verifyingkey<'_>> {
    require_gte!(data.len(), 452, GuardRailError::InvalidVk);
    let nr_ic = u32::from_le_bytes(data[448..452].try_into().unwrap()) as usize;
    let ic_bytes_end = 452 + nr_ic * 64;
    require_eq!(data.len(), ic_bytes_end, GuardRailError::InvalidVk);

    let alpha_g1: [u8; 64] = data[0..64].try_into().unwrap();
    let beta_g2: [u8; 128] = data[64..192].try_into().unwrap();
    let gamma_g2: [u8; 128] = data[192..320].try_into().unwrap();
    let delta_g2: [u8; 128] = data[320..448].try_into().unwrap();

    // SAFETY: cast &[u8] of length nr_ic*64 to &[[u8;64]] of length nr_ic. The slice
    // lifetime is tied to `data` so the resulting Verifyingkey can't outlive it.
    let ic_slice: &[[u8; 64]] =
        unsafe { core::slice::from_raw_parts(data[452..ic_bytes_end].as_ptr() as *const [u8; 64], nr_ic) };

    Ok(Groth16Verifyingkey {
        nr_pubinputs: PAY_STATIC_NR_INPUTS,
        vk_alpha_g1: alpha_g1,
        vk_beta_g2: beta_g2,
        vk_gamme_g2: gamma_g2,
        vk_delta_g2: delta_g2,
        vk_ic: ic_slice,
    })
}
