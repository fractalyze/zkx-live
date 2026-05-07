// System Program verifier — extracts (recipient, lamports) from SystemProgram::Transfer.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;

use crate::GuardRailError;
use super::ExtractedAction;

pub const PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("11111111111111111111111111111111");

// SystemInstruction discriminator: u32 LE in data[0..4]
const TRANSFER_DISCRIMINATOR: u32 = 2;

/// Returns `Some(action)` for a Transfer (lamports moved to a non-self recipient).
/// Returns `None` for benign system ix (CreateAccount, Allocate, Assign, etc.) — these
/// don't move existing lamports to outside the user's control, so they're allowed
/// without policy match.
pub fn extract(ix: &Instruction) -> Result<Option<ExtractedAction>> {
    require!(ix.data.len() >= 4, GuardRailError::SiblingMalformed);

    let disc = u32::from_le_bytes(ix.data[0..4].try_into().unwrap());
    if disc != TRANSFER_DISCRIMINATOR {
        // CreateAccount, Allocate, Assign, etc.
        return Ok(None);
    }

    // Transfer:  [2 (u32 LE)] [lamports (u64 LE)]
    //            accounts[0]=from, [1]=to
    require!(ix.data.len() >= 12, GuardRailError::SiblingMalformed);
    require!(ix.accounts.len() >= 2, GuardRailError::SiblingMalformed);

    Ok(Some(ExtractedAction {
        recipient: ix.accounts[1].pubkey,
        amount: u64::from_le_bytes(ix.data[4..12].try_into().unwrap()),
    }))
}
