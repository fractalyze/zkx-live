// Sibling instruction verifiers — modular dispatch over supported actions.
//
// Each verifier maps a (program_id, ix_data, accounts) into an `ExtractedAction`
// that the policy layer can match against the ZK proof's public_inputs.
//
// Adding a new action type (V2: Jupiter swap, Marinade stake, etc.) is a 3-step
// recipe:
//   1. Create `verifiers/<name>.rs` with `pub fn extract(ix) -> Result<Outcome>`
//   2. Add the `program_id` arm to `dispatch()` below
//   3. Re-deploy the program
//
// Common infrastructure (ZK verify, sysvar walk, policy match, PDA mgmt) is
// reused — only the per-protocol extraction is per-module.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;

use crate::GuardRailError;

pub mod spl_token;
pub mod system;

/// What a verifier reports back to the policy layer.
pub struct ExtractedAction {
    pub recipient: Pubkey,
    pub amount: u64,
}

/// What `dispatch()` returns when classifying a sibling ix.
pub enum Outcome {
    /// Sibling moves funds — verifier extracted (recipient, amount). Policy must
    /// match.
    Extracted(ExtractedAction),
    /// Sibling is structurally allowed (e.g., ComputeBudget) and contributes
    /// nothing to the policy match. Skip without rejecting.
    Skip,
}

// Allowed siblings that don't need extraction:
const COMPUTE_BUDGET_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("ComputeBudget111111111111111111111111111111");
// Self-program: chained guardrail ix in the same tx are safe.
const SELF_PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("w9TPDtPfL14jsapHoS7k1bokwFwNt9V9w7uzhkNyMgv");

/// Classify and extract from a sibling instruction.
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

    err!(GuardRailError::SiblingDisallowed)
}
