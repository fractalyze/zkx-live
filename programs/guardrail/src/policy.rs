// Policy enforcement — walks sibling instructions and matches against the
// (recipient, amount) committed to in the proven public_inputs.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked, ID as SYSVAR_INSTRUCTIONS_ID,
};

use crate::verifiers::{dispatch, Outcome};
use crate::GuardRailError;

/// Walks sibling instructions of the current tx, dispatches each to the right
/// verifier, and asserts:
///   - every fund-moving sibling targets `expected_recipient`
///   - the SUM of amounts equals `expected_amount`
///   - at least one sibling exists (otherwise the assert is meaningless)
///
/// Emits a `GuardRail OK ...` log on success.
pub fn enforce_sibling_policy(
    ix_sysvar: &AccountInfo,
    expected_recipient: Pubkey,
    expected_amount: u64,
    nullifier: [u8; 32],
) -> Result<()> {
    require_keys_eq!(*ix_sysvar.key, SYSVAR_INSTRUCTIONS_ID, GuardRailError::InvalidVk);

    let our_index = load_current_index_checked(ix_sysvar)? as usize;
    let mut total_amount: u64 = 0;
    let mut transfer_count: usize = 0;

    let mut i = our_index + 1;
    loop {
        let ix = match load_instruction_at_checked(i, ix_sysvar) {
            Ok(ix) => ix,
            Err(_) => break,
        };

        match dispatch(&ix)? {
            Outcome::Skip => {}
            Outcome::Extracted(action) => {
                require_keys_eq!(
                    action.recipient,
                    expected_recipient,
                    GuardRailError::PolicyRecipientMismatch
                );
                total_amount = total_amount
                    .checked_add(action.amount)
                    .ok_or(error!(GuardRailError::SiblingMalformed))?;
                transfer_count += 1;
            }
        }
        i += 1;
    }

    require!(transfer_count > 0, GuardRailError::SiblingMissing);
    require_eq!(total_amount, expected_amount, GuardRailError::PolicyAmountMismatch);

    msg!(
        "GuardRail OK: {} xfer(s), {} -> {} (nullifier_hi={})",
        transfer_count,
        total_amount,
        expected_recipient,
        u64::from_be_bytes(nullifier[24..32].try_into().unwrap())
    );
    Ok(())
}
