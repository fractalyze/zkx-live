use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;

use crate::GatewayError;
use super::ExtractedAction;

pub const PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("11111111111111111111111111111111");

const TRANSFER_DISCRIMINATOR: u32 = 2;

pub fn extract(ix: &Instruction) -> Result<Option<ExtractedAction>> {
    require!(ix.data.len() >= 4, GatewayError::SiblingMalformed);
    let disc = u32::from_le_bytes(ix.data[0..4].try_into().unwrap());
    if disc != TRANSFER_DISCRIMINATOR {
        return Ok(None);
    }
    require!(ix.data.len() >= 12, GatewayError::SiblingMalformed);
    require!(ix.accounts.len() >= 2, GatewayError::SiblingMalformed);
    Ok(Some(ExtractedAction {
        recipient: ix.accounts[1].pubkey,
        amount: u64::from_le_bytes(ix.data[4..12].try_into().unwrap()),
    }))
}
