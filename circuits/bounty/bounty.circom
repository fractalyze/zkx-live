pragma circom 2.1.6;

// =============================================================================
// bounty.circom — pay action gated by intent + an attested off-chain claim
//
// Same intent layer as intent.circom, plus the proof binds to a generic
// (subject, object, timestamp) claim signed by an attestor's BabyJubjub key.
// EdDSA-BabyJubjub + Poseidon is SNARK-native (~3.5k constraints) vs ~1.5M
// for in-circuit secp256k1.
//
// The (subject, object) pair is generic — works for any attested claim:
//   GitHub star  : (user_id,         repo_hash      )
//   Twitter follow: (twitter_id,     target_hash    )
//   Plaid balance: (account_id,      bucket_hash    )
//   KYC attribute: (provider_user,   attribute_hash )
//
// Public inputs (6, ERC-8150 minimal): intent_root_pub, recipient[2], amount,
// attestor_Ax, attestor_Ay. Everything else (now, intent fields, claim, EdDSA
// signature, Merkle path) is private witness — the gateway only ever needs to
// see the values it cryptographically enforces. See programs/gateway/src/lib.rs
// `decode_payment_schema` for the on-chain layout this matches.
//
// vk_id = 4
// =============================================================================

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/eddsaposeidon.circom";
include "../lib/merkle.circom";

template Bounty(merkleDepth) {
    // ---- PUBLIC INPUTS (6 total — see component main `public [...]` below) -----
    signal input intent_root_pub;
    signal input recipient[2];
    signal input amount;
    signal input attestor_Ax;                     // BabyJubjub pubkey x
    signal input attestor_Ay;                     // BabyJubjub pubkey y

    // ---- PRIVATE WITNESS — claim ----
    signal input claim_subject;                   // claim subject (e.g., GitHub user_id)
    signal input claim_object;                    // claim object hash (e.g., Poseidon-hashed repo)
    signal input claim_timestamp;                 // when attestor observed
    signal input sig_R8x;                         // EdDSA sig point x
    signal input sig_R8y;                         // EdDSA sig point y
    signal input sig_S;                           // EdDSA sig scalar

    // ---- PRIVATE WITNESS — intent + freshness ----
    signal input now;                             // unix sec, enforced in [window_start, expiry)
    signal input intent_recipients_root;
    signal input intent_amount_cap;
    signal input intent_max_per_recipient;
    signal input intent_window_start;
    signal input intent_expiry;
    signal input intent_asset[2];
    signal input intent_salt;
    signal input merkle_path[merkleDepth];
    signal input merkle_path_indices[merkleDepth];

    // -------------------------------------------------------------------------
    // C1. Compress claim into a single Poseidon field element (= EdDSA message)
    //     M = Poseidon(subject, object_hash, timestamp)
    // -------------------------------------------------------------------------
    component msg_hash = Poseidon(3);
    msg_hash.inputs[0] <== claim_subject;
    msg_hash.inputs[1] <== claim_object;
    msg_hash.inputs[2] <== claim_timestamp;

    // -------------------------------------------------------------------------
    // C2. EdDSA verify (BabyJubjub + Poseidon hash) — ~3.5k constraints
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
    // C3. Intent integrity (Poseidon(9) over the bundle, vk_id baked in)
    //     intent_root_pub === H(recipients_root, caps..., asset, salt, vk_id=4)
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
    intent_hash.inputs[8] <== 4;                  // vk_id
    intent_root_pub === intent_hash.out;

    // -------------------------------------------------------------------------
    // C4. recipient ∈ allowlist (Merkle, depth-8)
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
    //     `now` is private — chain trusts the prover's claim it was in window
    //     at proof-gen time. The nullifier (C7) prevents replay regardless.
    // -------------------------------------------------------------------------
    component expiry_check = LessThan(64);
    expiry_check.in[0] <== now;
    expiry_check.in[1] <== intent_expiry;
    expiry_check.out === 1;
    component window_start_check = LessEqThan(64);
    window_start_check.in[0] <== intent_window_start;
    window_start_check.in[1] <== now;
    window_start_check.out === 1;

    // Nullifier note: the gateway derives a per-claim nullifier from
    // sha256(public_inputs) + intent.nullifier_seed + schema_id (see
    // gateway::compute_nullifier). With our 6-public layout (intent_root_pub,
    // recipient[2], amount, attestor_Ax/Ay), the chain enforces "one payout
    // per (intent, recipient, amount, attestor)" — exactly one bounty per
    // recipient address under this intent. Different (subject, object) claim
    // values change the proof but NOT the public inputs, so they nullify to
    // the same value — which is what we want for a per-recipient bounty.
}

component main {
    public [intent_root_pub, recipient, amount, attestor_Ax, attestor_Ay, claim_subject]
} = Bounty(8);
