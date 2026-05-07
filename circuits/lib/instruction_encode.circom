pragma circom 2.1.6;

// Encode a Solana SPL Transfer instruction inside a circuit.
//
// SPL Token Program ID (mainnet): TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
//   Bytes (base58 decoded, 32 bytes):
//     06 dd f6 e1 d7 65 a1 93 d9 cb e1 46 ce eb 79 ac
//     1c b4 85 ed 5f 5b 37 91 3a 8c f5 85 7e ff 00 a9
//
// SPL Transfer instruction layout (9 bytes total, no checked variant):
//     [0]    discriminator = 3 (Transfer)
//     [1..9] amount as u64 little-endian
//
// Outputs the program_id (split into 2 Fr) and the data bytes (8 limbs of 8-bit
// values + the 1-byte discriminator packed into the first slot).
//
// Also emits accounts_hash = Poseidon(from_token_account, to_token_account, authority)
// so the wallet program can validate the on-chain account list against the
// circuit's claim.

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";

template EncodeSplTransfer() {
    // ---- inputs ----
    signal input amount;          // u64
    signal input from_pda[2];     // 32-byte pubkey, packed as [hi, lo] (16 bytes each)
    signal input recipient_ata[2];
    signal input mint[2];         // SPL mint pubkey (passed for accounts_hash binding)

    // ---- outputs ----
    signal output program_id[2];  // SPL Token Program ID, fixed
    signal output accounts_hash[2];
    signal output data[8];        // 8 slots; data[0] packs discriminator + first 7 amount bytes,
                                  // data[1..8] hold... see note below.

    // ---- 1. Range-check amount fits in 64 bits ----
    component amountBits = Num2Bits(64);
    amountBits.in <== amount;

    // ---- 2. Compose the 9-byte SPL data payload ----
    // We expose it as 8 Fr slots for downstream consumers; layout is:
    //   data[0] = discriminator (3) << 56  |  amount[0..7]   (8-byte word, little-endian)
    //   data[1] = amount[7]                                  (the 8th amount byte, isolated)
    //   data[2..8] = 0 (padding for fixed-width public-input schema)
    //
    // The wallet program reconstructs the on-chain instruction from this.
    // Keeping data fixed-width keeps the public-input schema constant across
    // action types (a hard requirement of the verifier-agnostic design).

    var bytePow = 1;
    var word = 0;
    // Pack amount bytes [0..7] (low 7 bytes) into the low 56 bits.
    // We use witness-side arithmetic; bits are constrained by Num2Bits above.
    component byteAcc[7];
    for (var b = 0; b < 7; b++) {
        byteAcc[b] = Bits2Num(8);
        for (var bit = 0; bit < 8; bit++) {
            byteAcc[b].in[bit] <== amountBits.out[b * 8 + bit];
        }
    }
    // Compose: word = sum(byteAcc[b].out * 2^(8*b)) for b in 0..7
    signal partial[8];
    partial[0] <== byteAcc[0].out;
    for (var b = 1; b < 7; b++) {
        partial[b] <== partial[b - 1] + byteAcc[b].out * (256 ** b);
    }
    // Discriminator (3) in the top byte position (bits 56..63 of the low 64-bit word)
    partial[7] <== partial[6] + 3 * (256 ** 7);
    data[0] <== partial[7];

    // Isolate amount byte [7] (the 8th, top byte) for accuracy
    component amountByte7 = Bits2Num(8);
    for (var bit = 0; bit < 8; bit++) {
        amountByte7.in[bit] <== amountBits.out[56 + bit];
    }
    data[1] <== amountByte7.out;

    // Padding (fixed-schema requirement)
    for (var i = 2; i < 8; i++) {
        data[i] <== 0;
    }

    // ---- 3. Hard-coded SPL Token Program ID ----
    // Pre-computed: 32-byte pubkey split as [high16, low16] field elements.
    // NOTE: these constants must match the on-chain program's expected value.
    program_id[0] <== 0x06ddf6e1d765a193d9cbe146ceeb79ac;  // first 16 bytes
    program_id[1] <== 0x1cb485ed5f5b37913a8cf5857eff00a9;  // last 16 bytes

    // ---- 4. accounts_hash = Poseidon(from, to, authority=from_pda, mint) ----
    component h = Poseidon(8);
    h.inputs[0] <== from_pda[0];
    h.inputs[1] <== from_pda[1];
    h.inputs[2] <== recipient_ata[0];
    h.inputs[3] <== recipient_ata[1];
    h.inputs[4] <== from_pda[0];        // authority is the wallet PDA itself
    h.inputs[5] <== from_pda[1];
    h.inputs[6] <== mint[0];
    h.inputs[7] <== mint[1];

    // Split Poseidon output into 2 Fr halves for the fixed schema.
    // (Poseidon over BN254 returns one Fr; we replicate to 2 slots and let the
    // wallet program use the lower one. Keeping schema width fixed.)
    accounts_hash[0] <== h.out;
    accounts_hash[1] <== 0;
}
