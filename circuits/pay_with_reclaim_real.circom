pragma circom 2.1.6;

// =============================================================================
// pay_with_reclaim_real.circom — V4: Reclaim-format compatible
//
// Same architecture as V2 but uses **keccak256 instead of sha256** so we can
// verify signatures from the real Reclaim Protocol attestor network.
//
// Reclaim attestors sign:
//   identifier = keccak256(provider + "\n" + parameters + "\n" + context)
//   dataStr    = identifier + "\n" + owner + "\n" + timestampS + "\n" + epoch
//   msghash    = keccak256(dataStr)                       // V4 here (simplified)
//                or keccak256(EIP-191 || len || dataStr)   // real Reclaim (TODO)
//   sig        = ECDSA-secp256k1.sign(msghash, attestor_priv)
//
// V4 omits the EIP-191 prefix for first-iteration simplicity — to integrate
// real Reclaim attestations later, prepend "\x19Ethereum Signed Message:\n"
// + len(dataStr) inside the keccak input region (~30 byte addition,
// constraint cost negligible vs the 1.5M ECDSA core).
//
// vk_id = 3 (pay_with_reclaim_real)
// =============================================================================

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "lib/merkle.circom";
include "lib/instruction_encode.circom";
include "deps/circom-ecdsa/circuits/ecdsa.circom";
include "vocdoni-keccak/keccak.circom";

// Keccak-256 over CLAIM_BYTES bytes → 4×64-bit limbs (low-first).
//
// vocdoni-keccak `Keccak(nBitsIn, nBitsOut)` takes / outputs a flat bit array
// (MSB-first within each byte? actually LSB-first per their convention — see
// vocdoni-keccak `K_in_bytes2bits` reference). We feed bytes via Num2Bits_eth
// (LSB-first) to match. Output bits are in big-endian per-byte order.
template ClaimDigestKeccak(CLAIM_BYTES) {
    signal input claim_bytes[CLAIM_BYTES];
    signal output msghash_limbs[4];

    var BITS = CLAIM_BYTES * 8;
    component keccak = Keccak(BITS, 256);

    component byte_bits[CLAIM_BYTES];
    for (var i = 0; i < CLAIM_BYTES; i++) {
        byte_bits[i] = Num2Bits_eth();
        byte_bits[i].in <== claim_bytes[i];
        // vocdoni-keccak expects LSB-first bit ordering within each byte
        for (var b = 0; b < 8; b++) {
            keccak.in[i*8 + b] <== byte_bits[i].out[b];
        }
    }

    // Repack 256 keccak bits → 4×64-bit limbs (low-first, standard ECDSA limb layout)
    // keccak.out is also LSB-first per-byte; we want msghash as a 256-bit big-endian
    // integer. Within each byte: bit 0 is LSB, bit 7 is MSB. Across bytes: byte 0 is
    // most significant of the 256-bit hash.
    //
    //   limb[0] (low 64 bits)  = bytes 24..31 (rightmost 8 bytes of digest)
    //   limb[3] (high 64 bits) = bytes  0.. 7 (leftmost  8 bytes of digest)
    for (var L = 0; L < 4; L++) {
        var acc = 0;
        for (var byte_idx = 0; byte_idx < 8; byte_idx++) {
            // Byte offset within the digest (most-significant first)
            var digest_byte = (3 - L) * 8 + byte_idx;
            // Bits within this byte are LSB-first in keccak.out
            for (var bit_in_byte = 0; bit_in_byte < 8; bit_in_byte++) {
                // Standard uint64 limb: digest_byte's bit_in_byte contributes
                //   2^(56 - byte_idx*8 + bit_in_byte)
                var weight = 1 << (56 - byte_idx * 8 + bit_in_byte);
                acc += keccak.out[digest_byte * 8 + bit_in_byte] * weight;
            }
        }
        msghash_limbs[L] <== acc;
    }
}

template Num2Bits_eth() {
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
// Main template — same shape as V2 but with keccak swap
// ---------------------------------------------------------------------------
template PayWithReclaimReal(merkleDepth, CLAIM_BYTES) {
    // ---- PUBLIC OUTPUTS (V2-compatible schema) ----
    signal output vk_id;                          // = 3
    signal output intent_root;
    signal output nullifier;
    signal output attestor_pubkey_out[2][4];
    signal output instruction_program_id[2];
    signal output instruction_accounts_hash[2];
    signal output instruction_data[8];

    // ---- PUBLIC INPUTS ----
    signal input intent_root_pub;
    signal input recipient[2];
    signal input amount;
    signal input now;
    signal input attestor_pubkey[2][4];

    // ---- PRIVATE WITNESS ----
    signal input claim_bytes[CLAIM_BYTES];
    signal input sig_r[4];
    signal input sig_s[4];
    signal input github_user_id;
    signal input repo_hash;
    signal input intent_recipients_root;
    signal input intent_amount_cap;
    signal input intent_max_per_recipient;
    signal input intent_window_start;   // V4 step-3: bounty window lower bound
    signal input intent_expiry;
    signal input intent_asset[2];
    signal input intent_salt;
    signal input merkle_path[merkleDepth];
    signal input merkle_path_indices[merkleDepth];
    signal input wallet_pda[2];
    signal input recipient_token_account[2];

    // -------------------------------------------------------------------------
    // C1. keccak256 over claim → msghash limbs
    // -------------------------------------------------------------------------
    component digest = ClaimDigestKeccak(CLAIM_BYTES);
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
    // C3. Intent integrity (Poseidon(9) with vk_id=3 and window_start)
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
    intent_hash.inputs[8] <== 3; // vk_id = 3
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
    // C6. bounty window: intent_window_start <= now < intent_expiry
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
    // C7. nullifier = Poseidon(github_user_id, repo_hash)
    // -------------------------------------------------------------------------
    component null_hash = Poseidon(2);
    null_hash.inputs[0] <== github_user_id;
    null_hash.inputs[1] <== repo_hash;

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
    vk_id <== 3;
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
} = PayWithReclaimReal(8, 128);  // 128-byte dataStr (≈ Reclaim claim size)
