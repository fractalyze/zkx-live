pragma circom 2.1.6;

// =============================================================================
// pay_with_reclaim.circom — V2: Reclaim-attested payment release
//
// Statement: A Reclaim attestor signed a claim (e.g. "user X starred repo Y"),
// AND the requested transfer satisfies the user-signed IntentBundle.
//
// Reclaim trust assumption: only the attestor's secp256k1 public key —
// forging a claim requires breaking ECDSA or compromising the attestor key.
//
// vk_id = 1 (PayWithReclaim)
// =============================================================================

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/sha256/sha256.circom";
include "lib/merkle.circom";
include "lib/instruction_encode.circom";
include "deps/circom-ecdsa/circuits/ecdsa.circom";

// SHA-256 over CLAIM_BYTES bytes of attestor-signed claim payload, output as
// 4×64-bit limbs in the standard secp256k1 ECDSA convention:
//   msghash_limbs[0] = low  64 bits of digest (bits 192..255)
//   msghash_limbs[3] = high 64 bits of digest (bits   0..63 )
// Within each limb: bit 63 is MSB, bit 0 is LSB (normal uint64).
template ClaimDigest(CLAIM_BYTES) {
    signal input claim_bytes[CLAIM_BYTES];
    signal output msghash_limbs[4];

    var BITS = CLAIM_BYTES * 8;
    component sha = Sha256(BITS);

    // Unpack each byte to 8 bits (MSB first), feed into Sha256
    component byte_bits[CLAIM_BYTES];
    for (var i = 0; i < CLAIM_BYTES; i++) {
        byte_bits[i] = Num2Bits_strict_le8();
        byte_bits[i].in <== claim_bytes[i];
        for (var b = 0; b < 8; b++) {
            sha.in[i*8 + b] <== byte_bits[i].out[7 - b];
        }
    }

    // sha.out is MSB-first (bit 0 = top of digest). Standard limb layout:
    // limb L (0=low, 3=high) covers digest bits [(3-L)*64 .. (3-L+1)*64-1],
    // and within limb the MSB (bit 63) is the first bit of that range.
    for (var L = 0; L < 4; L++) {
        var acc = 0;
        for (var j = 0; j < 64; j++) {
            // sha.out[(3-L)*64 + j] is the j-th MSB of this limb,
            // contributing 2^(63-j) to the limb value.
            acc += sha.out[(3 - L) * 64 + j] * (1 << (63 - j));
        }
        msghash_limbs[L] <== acc;
    }
}

// Range-checks an 8-bit signal and exposes its bits.
template Num2Bits_strict_le8() {
    signal input in;
    signal output out[8];
    var lc = 0;
    for (var i = 0; i < 8; i++) {
        out[i] <-- (in >> i) & 1;
        out[i] * (out[i] - 1) === 0;
        lc += out[i] * (1 << i);
    }
    lc === in;
}

// ---------------------------------------------------------------------------
// Main template
// ---------------------------------------------------------------------------
template PayWithReclaim(merkleDepth, CLAIM_BYTES) {
    // ---- PUBLIC OUTPUTS (fixed schema, V2 superset) ----
    signal output vk_id;                          // = 1
    signal output intent_root;
    signal output nullifier;                      // Poseidon(github_user_id, repo_hash)
    signal output attestor_pubkey_out[2][4];      // bind attestor pubkey into VK context
    signal output instruction_program_id[2];
    signal output instruction_accounts_hash[2];
    signal output instruction_data[8];

    // ---- PUBLIC INPUTS ----
    signal input intent_root_pub;
    signal input recipient[2];
    signal input amount;
    signal input now;
    signal input attestor_pubkey[2][4];           // hardcoded Reclaim attestor key

    // ---- PRIVATE WITNESS ----
    signal input claim_bytes[CLAIM_BYTES];        // raw signed claim
    signal input sig_r[4];
    signal input sig_s[4];
    signal input github_user_id;                  // extracted off-circuit, bound via nullifier
    signal input repo_hash;                       // expected repo (Poseidon-hashed)
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
    // C1. SHA-256 over claim → msghash limbs
    // -------------------------------------------------------------------------
    component digest = ClaimDigest(CLAIM_BYTES);
    for (var i = 0; i < CLAIM_BYTES; i++) digest.claim_bytes[i] <== claim_bytes[i];

    // -------------------------------------------------------------------------
    // C2. ECDSA verify (attestor_pubkey, msghash, sig)
    // -------------------------------------------------------------------------
    component ecdsa = ECDSAVerifyNoPubkeyCheck(64, 4);
    for (var k = 0; k < 4; k++) {
        ecdsa.r[k] <== sig_r[k];
        ecdsa.s[k] <== sig_s[k];
        ecdsa.msghash[k] <== digest.msghash_limbs[k];
        ecdsa.pubkey[0][k] <== attestor_pubkey[0][k];
        ecdsa.pubkey[1][k] <== attestor_pubkey[1][k];
    }
    ecdsa.result === 1;

    // -------------------------------------------------------------------------
    // C3. Intent integrity (same Poseidon binding as V1)
    // -------------------------------------------------------------------------
    component intent_hash = Poseidon(8);
    intent_hash.inputs[0] <== intent_recipients_root;
    intent_hash.inputs[1] <== intent_amount_cap;
    intent_hash.inputs[2] <== intent_max_per_recipient;
    intent_hash.inputs[3] <== intent_expiry;
    intent_hash.inputs[4] <== intent_asset[0];
    intent_hash.inputs[5] <== intent_asset[1];
    intent_hash.inputs[6] <== intent_salt;
    intent_hash.inputs[7] <== 1; // vk_id = 1
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
    // C6. not expired
    // -------------------------------------------------------------------------
    component expiry_check = LessThan(64);
    expiry_check.in[0] <== now;
    expiry_check.in[1] <== intent_expiry;
    expiry_check.out === 1;

    // -------------------------------------------------------------------------
    // C7. nullifier = Poseidon(github_user_id, repo_hash) — per-user replay
    // -------------------------------------------------------------------------
    component null_hash = Poseidon(2);
    null_hash.inputs[0] <== github_user_id;
    null_hash.inputs[1] <== repo_hash;

    // -------------------------------------------------------------------------
    // C8. instruction encoding (SPL Transfer to recipient)
    // -------------------------------------------------------------------------
    component spl_encode = EncodeSplTransfer();
    spl_encode.amount <== amount;
    for (var i = 0; i < 2; i++) {
        spl_encode.from_pda[i] <== wallet_pda[i];
        spl_encode.recipient_ata[i] <== recipient_token_account[i];
        spl_encode.mint[i] <== intent_asset[i];
    }

    // ---- wire outputs ----
    vk_id <== 1;
    intent_root <== intent_root_pub;
    nullifier <== null_hash.out;
    for (var i = 0; i < 4; i++) {
        attestor_pubkey_out[0][i] <== attestor_pubkey[0][i];
        attestor_pubkey_out[1][i] <== attestor_pubkey[1][i];
    }
    instruction_program_id[0] <== spl_encode.program_id[0];
    instruction_program_id[1] <== spl_encode.program_id[1];
    instruction_accounts_hash[0] <== spl_encode.accounts_hash[0];
    instruction_accounts_hash[1] <== spl_encode.accounts_hash[1];
    for (var i = 0; i < 8; i++) instruction_data[i] <== spl_encode.data[i];
}

component main {
    public [intent_root_pub, recipient, amount, now, attestor_pubkey]
} = PayWithReclaim(8, 256);  // 256-byte claim payload (~Reclaim claim JSON size)
