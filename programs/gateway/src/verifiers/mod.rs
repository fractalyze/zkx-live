// Sibling instruction verifiers — modular dispatch over supported actions.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;

use crate::GatewayError;

pub mod spl_token;
pub mod system;

pub struct ExtractedAction {
    pub recipient: Pubkey,
    pub amount: u64,
}

pub enum Outcome {
    Extracted(ExtractedAction),
    Skip,
}

const COMPUTE_BUDGET_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("ComputeBudget111111111111111111111111111111");
// Self-program: chained gateway ix in the same tx are safe to skip.
const SELF_PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("3FYPieR6NZiQYGUx9TNeXGWwaV6ntD6ig2hu9jLi69ZQ");

pub fn dispatch(ix: &Instruction) -> Result<Outcome> {
    if ix.program_id == COMPUTE_BUDGET_ID || ix.program_id == SELF_PROGRAM_ID {
        return Ok(Outcome::Skip);
    }
    if ix.data.is_empty() {
        return Ok(Outcome::Skip);
    }

    if ix.program_id == spl_token::PROGRAM_ID {
        return spl_token::extract(ix).map(Outcome::Extracted);
    }
    if ix.program_id == system::PROGRAM_ID {
        return system::extract(ix).map(|maybe| match maybe {
            Some(action) => Outcome::Extracted(action),
            None => Outcome::Skip,
        });
    }

    err!(GatewayError::SiblingDisallowed)
}
