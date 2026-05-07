// SPL Token verifier — extracts (recipient, amount) from Transfer / TransferChecked.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;

use crate::GuardRailError;
use super::ExtractedAction;

pub const PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const TRANSFER_DISCRIMINATOR: u8 = 3;
const TRANSFER_CHECKED_DISCRIMINATOR: u8 = 12;

pub fn extract(ix: &Instruction) -> Result<ExtractedAction> {
    let (amount, recipient_idx) = match ix.data[0] {
        // Transfer:        [3]      [amount LE u64]
        //                  accounts[0]=source, [1]=destination, [2]=authority
        TRANSFER_DISCRIMINATOR => {
            require!(ix.data.len() >= 9, GuardRailError::SiblingMalformed);
            (u64::from_le_bytes(ix.data[1..9].try_into().unwrap()), 1usize)
        }
        // TransferChecked: [12]     [amount LE u64] [decimals u8]
        //                  accounts[0]=source, [1]=mint, [2]=destination, [3]=authority
        TRANSFER_CHECKED_DISCRIMINATOR => {
            require!(ix.data.len() >= 9, GuardRailError::SiblingMalformed);
            (u64::from_le_bytes(ix.data[1..9].try_into().unwrap()), 2usize)
        }
        _ => return err!(GuardRailError::SiblingDisallowed),
    };

    require!(
        ix.accounts.len() > recipient_idx,
        GuardRailError::SiblingMalformed
    );

    Ok(ExtractedAction {
        recipient: ix.accounts[recipient_idx].pubkey,
        amount,
    })
}
