pragma circom 2.1.6;

// =============================================================================
// intent.circom — pay action gated by an intent-bound spending policy
//
// Statement: An SPL token transfer of `amount` to `recipient` satisfies the
// owner-signed IntentBundle: recipient ∈ allowlist (Merkle), amount ≤ caps,
// not expired, nonce ≥ floor, not replayed.
//
// vk_id = 0
// =============================================================================

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "../lib/merkle.circom";
include "../lib/instruction_encode.circom";

template Intent(merkleDepth) {
    // ---- PUBLIC OUTPUTS (fixed schema across all circuits) ----
    signal output vk_id;                          // [0]
    signal output intent_root;                    // [1]
    signal output nullifier;                      // [2]
    signal output instruction_program_id[2];      // [3..5] — SPL token program ID
    signal output instruction_accounts_hash[2];   // [5..7]
    signal output instruction_data[8];            // [7..15] — encoded SPL Transfer ix

    // ---- PUBLIC INPUTS (driven by caller) ----
    signal input intent_root_pub;
    signal input recipient[2];                    // 32-byte pubkey as 2 Fr (16 bytes each)
    signal input amount;                          // u64
    signal input now;                             // unix timestamp

    // ---- PRIVATE WITNESS ----
    signal input nonce;
    signal input min_valid_nonce;                 // ERC-8150: monotonic floor; circuit checks nonce >= floor
    signal input cluster_id;                      // ERC-8150 chainId equivalent: 0=localnet, 1=devnet, 2=mainnet
    signal input intent_recipients_root;
    signal input intent_amount_cap;
    signal input intent_max_per_recipient;
    signal input intent_expiry;
    signal input intent_asset[2];
    signal input intent_salt;
    signal input merkle_path[merkleDepth];
    signal input merkle_path_indices[merkleDepth];
    signal input wallet_pda[2];
    signal input recipient_token_account[2];

    // -------------------------------------------------------------------------
    // Constraint 1: intent integrity — Poseidon hash of all intent fields
    // (ERC-8150 IntentBundle commitment, with cluster_id binding)
    // -------------------------------------------------------------------------
    component intent_hash_left = Poseidon(8);
    intent_hash_left.inputs[0] <== intent_recipients_root;
    intent_hash_left.inputs[1] <== intent_amount_cap;
    intent_hash_left.inputs[2] <== intent_max_per_recipient;
    intent_hash_left.inputs[3] <== intent_expiry;
    intent_hash_left.inputs[4] <== intent_asset[0];
    intent_hash_left.inputs[5] <== intent_asset[1];
    intent_hash_left.inputs[6] <== intent_salt;
    intent_hash_left.inputs[7] <== 0;  // vk_id = 0 (Pay), reserved slot

    // Bind cluster_id and min_valid_nonce into the commitment
    component intent_hash = Poseidon(3);
    intent_hash.inputs[0] <== intent_hash_left.out;
    intent_hash.inputs[1] <== cluster_id;
    intent_hash.inputs[2] <== min_valid_nonce;
    intent_root_pub === intent_hash.out;

    // -------------------------------------------------------------------------
    // Constraint 2: recipient ∈ allowlist (Merkle)
    // -------------------------------------------------------------------------
    component recipient_leaf = Poseidon(2);
    recipient_leaf.inputs[0] <== recipient[0];
    recipient_leaf.inputs[1] <== recipient[1];

    component merkle = MerkleVerify(merkleDepth);
    merkle.leaf <== recipient_leaf.out;
    for (var i = 0; i < merkleDepth; i++) {
        merkle.path[i] <== merkle_path[i];
        merkle.indices[i] <== merkle_path_indices[i];
    }
    merkle.root === intent_recipients_root;

    // -------------------------------------------------------------------------
    // Constraint 3: amount ≤ cap (and ≤ max_per_recipient)
    // -------------------------------------------------------------------------
    component amount_cap_check = LessEqThan(64);
    amount_cap_check.in[0] <== amount;
    amount_cap_check.in[1] <== intent_amount_cap;
    amount_cap_check.out === 1;

    component max_per_recipient_check = LessEqThan(64);
    max_per_recipient_check.in[0] <== amount;
    max_per_recipient_check.in[1] <== intent_max_per_recipient;
    max_per_recipient_check.out === 1;

    // -------------------------------------------------------------------------
    // Constraint 4: not expired
    // -------------------------------------------------------------------------
    component expiry_check = LessThan(64);
    expiry_check.in[0] <== now;
    expiry_check.in[1] <== intent_expiry;
    expiry_check.out === 1;

    // -------------------------------------------------------------------------
    // Constraint 4b: ERC-8150 monotonic nonce floor — nonce >= min_valid_nonce
    // -------------------------------------------------------------------------
    component nonce_floor_check = LessEqThan(64);
    nonce_floor_check.in[0] <== min_valid_nonce;
    nonce_floor_check.in[1] <== nonce;
    nonce_floor_check.out === 1;

    // -------------------------------------------------------------------------
    // Constraint 5: nullifier = Poseidon(intent_root, nonce, recipient[0], recipient[1])
    // -------------------------------------------------------------------------
    component nullifier_hash = Poseidon(4);
    nullifier_hash.inputs[0] <== intent_root_pub;
    nullifier_hash.inputs[1] <== nonce;
    nullifier_hash.inputs[2] <== recipient[0];
    nullifier_hash.inputs[3] <== recipient[1];

    // -------------------------------------------------------------------------
    // Constraint 6: instruction encoding (SPL Transfer)
    // -------------------------------------------------------------------------
    component spl_encode = EncodeSplTransfer();
    spl_encode.amount <== amount;
    for (var i = 0; i < 2; i++) {
        spl_encode.from_pda[i] <== wallet_pda[i];
        spl_encode.recipient_ata[i] <== recipient_token_account[i];
        spl_encode.mint[i] <== intent_asset[i];
    }

    // -------------------------------------------------------------------------
    // Wire public outputs
    // -------------------------------------------------------------------------
    vk_id <== 0;
    intent_root <== intent_root_pub;
    nullifier <== nullifier_hash.out;
    instruction_program_id[0] <== spl_encode.program_id[0];
    instruction_program_id[1] <== spl_encode.program_id[1];
    instruction_accounts_hash[0] <== spl_encode.accounts_hash[0];
    instruction_accounts_hash[1] <== spl_encode.accounts_hash[1];
    for (var i = 0; i < 8; i++) {
        instruction_data[i] <== spl_encode.data[i];
    }
}

component main {
    public [intent_root_pub, recipient, amount, now]
} = Intent(8);
