use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;

use crate::GatewayError;
use super::ExtractedAction;

pub const PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const TRANSFER_DISCRIMINATOR: u8 = 3;
const TRANSFER_CHECKED_DISCRIMINATOR: u8 = 12;

pub fn extract(ix: &Instruction) -> Result<ExtractedAction> {
    let (amount, recipient_idx) = match ix.data[0] {
        TRANSFER_DISCRIMINATOR => {
            require!(ix.data.len() >= 9, GatewayError::SiblingMalformed);
            (u64::from_le_bytes(ix.data[1..9].try_into().unwrap()), 1usize)
        }
        TRANSFER_CHECKED_DISCRIMINATOR => {
            require!(ix.data.len() >= 9, GatewayError::SiblingMalformed);
            (u64::from_le_bytes(ix.data[1..9].try_into().unwrap()), 2usize)
        }
        _ => return err!(GatewayError::SiblingDisallowed),
    };
    require!(
        ix.accounts.len() > recipient_idx,
        GatewayError::SiblingMalformed
    );
    Ok(ExtractedAction {
        recipient: ix.accounts[recipient_idx].pubkey,
        amount,
    })
}
