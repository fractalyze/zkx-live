pragma circom 2.1.6;

// =============================================================================
// star_bounty.circom — real-time demo with EdDSA-BabyJubjub
//
// Same architecture / invariants as V4 (composed verification) but the
// attestor signature scheme is BabyJubjub EdDSA + Poseidon — SNARK-native,
// ~3.5k constraints instead of 1.5M for in-circuit secp256k1.
//
// Use case: self-attestor demo (we own the attestor key). For Reclaim
// integration, swap to V4 (in-circuit secp256k1). Same gateway, different
// VK.
//
// vk_id binding for the attestation circuit
// =============================================================================

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/eddsaposeidon.circom";
include "lib/merkle.circom";
include "lib/instruction_encode.circom";

template StarBounty(merkleDepth) {
    // ---- PUBLIC OUTPUTS (same shape as V2/V4 for gateway compatibility) ----
    signal output vk_id;                          // = 4
    signal output intent_root;
    signal output nullifier;
    signal output attestor_pubkey_out[2];         // 2 elems (Ax, Ay), not 8 for ECDSA
    signal output instruction_program_id[2];
    signal output instruction_accounts_hash[2];
    signal output instruction_data[8];

    // ---- PUBLIC INPUTS ----
    signal input intent_root_pub;
    signal input recipient[2];
    signal input amount;
    signal input now;
    signal input attestor_Ax;                     // BabyJubjub pubkey x
    signal input attestor_Ay;                     // BabyJubjub pubkey y

    // ---- PRIVATE WITNESS — attestation ----
    signal input claim_user_id;                   // GitHub user_id (or hash)
    signal input claim_repo_hash;                 // Poseidon-hashed repo identifier
    signal input claim_timestamp;                 // when attestor observed
    signal input sig_R8x;                         // EdDSA sig point x
    signal input sig_R8y;                         // EdDSA sig point y
    signal input sig_S;                           // EdDSA sig scalar

    // ---- PRIVATE WITNESS — intent ----
    signal input intent_recipients_root;
    signal input intent_amount_cap;
    signal input intent_max_per_recipient;
    signal input intent_window_start;
    signal input intent_expiry;
    signal input intent_asset[2];
    signal input intent_salt;
    signal input merkle_path[merkleDepth];
    signal input merkle_path_indices[merkleDepth];
    signal input wallet_pda[2];
    signal input recipient_token_account[2];

    // -------------------------------------------------------------------------
    // C1. Compress claim into a single Poseidon field element (= EdDSA message)
    //     M = Poseidon(user_id, repo_hash, timestamp)
    // -------------------------------------------------------------------------
    component msg_hash = Poseidon(3);
    msg_hash.inputs[0] <== claim_user_id;
    msg_hash.inputs[1] <== claim_repo_hash;
    msg_hash.inputs[2] <== claim_timestamp;

    // -------------------------------------------------------------------------
    // C2. EdDSA verify (BabyJubjub + Poseidon-5 hash) — ~3.5k constraints
    // -------------------------------------------------------------------------
    component eddsa = EdDSAPoseidonVerifier();
    eddsa.enabled <== 1;
    eddsa.Ax <== attestor_Ax;
    eddsa.Ay <== attestor_Ay;
    eddsa.R8x <== sig_R8x;
    eddsa.R8y <== sig_R8y;
    eddsa.S <== sig_S;
    eddsa.M <== msg_hash.out;

    // -------------------------------------------------------------------------
    // C3. Intent integrity (Poseidon(9) — same shape as V4 with window_start)
    // -------------------------------------------------------------------------
    component intent_hash = Poseidon(9);
    intent_hash.inputs[0] <== intent_recipients_root;
    intent_hash.inputs[1] <== intent_amount_cap;
    intent_hash.inputs[2] <== intent_max_per_recipient;
    intent_hash.inputs[3] <== intent_window_start;
    intent_hash.inputs[4] <== intent_expiry;
    intent_hash.inputs[5] <== intent_asset[0];
    intent_hash.inputs[6] <== intent_asset[1];
    intent_hash.inputs[7] <== intent_salt;
    intent_hash.inputs[8] <== 4; // vk_id
    intent_root_pub === intent_hash.out;

    // -------------------------------------------------------------------------
    // C4. recipient ∈ allowlist (Merkle)
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
    // C5. amount ≤ cap, ≤ max_per_recipient
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
    // C6. bounty window: window_start ≤ now < expiry
    // -------------------------------------------------------------------------
    component expiry_check = LessThan(64);
    expiry_check.in[0] <== now;
    expiry_check.in[1] <== intent_expiry;
    expiry_check.out === 1;
    component window_start_check = LessEqThan(64);
    window_start_check.in[0] <== intent_window_start;
    window_start_check.in[1] <== now;
    window_start_check.out === 1;

    // -------------------------------------------------------------------------
    // C7. nullifier = Poseidon(claim_user_id, claim_repo_hash) — per-user-per-repo replay
    // -------------------------------------------------------------------------
    component null_hash = Poseidon(2);
    null_hash.inputs[0] <== claim_user_id;
    null_hash.inputs[1] <== claim_repo_hash;

    // -------------------------------------------------------------------------
    // C8. instruction encoding (SPL Transfer)
    // -------------------------------------------------------------------------
    component spl_encode = EncodeSplTransfer();
    spl_encode.amount <== amount;
    for (var i = 0; i < 2; i++) {
        spl_encode.from_pda[i] <== wallet_pda[i];
        spl_encode.recipient_ata[i] <== recipient_token_account[i];
        spl_encode.mint[i] <== intent_asset[i];
    }

    // ---- wire outputs ----
    vk_id <== 4;
    intent_root <== intent_root_pub;
    nullifier <== null_hash.out;
    attestor_pubkey_out[0] <== attestor_Ax;
    attestor_pubkey_out[1] <== attestor_Ay;
    instruction_program_id[0] <== spl_encode.program_id[0];
    instruction_program_id[1] <== spl_encode.program_id[1];
    instruction_accounts_hash[0] <== spl_encode.accounts_hash[0];
    instruction_accounts_hash[1] <== spl_encode.accounts_hash[1];
    for (var i = 0; i < 8; i++) instruction_data[i] <== spl_encode.data[i];
}

component main {
    public [intent_root_pub, recipient, amount, now, attestor_Ax, attestor_Ay]
} = StarBounty(8);
