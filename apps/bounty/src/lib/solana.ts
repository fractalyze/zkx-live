// Solana submit. The agent (bounty wallet) signs and sends a SystemProgram
// transfer to the recipient — the simplest possible payment.
//
// In a fully on-chain version we'd build a gateway-program ix that includes
// the proof + verifier CPI; for the demo we keep it as a plain transfer so
// the focus stays on the witness/proof timing. The proof is still generated
// (and could be archived alongside the tx) — it just isn't enforced on-chain.

import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

const RPC = process.env.SOLANA_RPC_URL || 'http://127.0.0.1:8899';

export function loadBountyWallet(): Keypair {
    const secret = process.env.BOUNTY_WALLET_SECRET;
    if (!secret) {
        throw new Error('BOUNTY_WALLET_SECRET env var not set (see .env.example)');
    }
    // Try JSON array first (solana-keygen export format).
    if (secret.trim().startsWith('[')) {
        const arr = JSON.parse(secret) as number[];
        return Keypair.fromSecretKey(Uint8Array.from(arr));
    }
    // Fallback to base58 (Phantom export format).
    return Keypair.fromSecretKey(bs58.decode(secret));
}

export async function sendBounty(
    recipient_b58: string,
    lamports: number,
): Promise<string> {
    const wallet = loadBountyWallet();
    const conn = new Connection(RPC, 'confirmed');
    const recipient = new PublicKey(recipient_b58);
    const tx = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: recipient,
            lamports,
        }),
    );
    return sendAndConfirmTransaction(conn, tx, [wallet]);
}

export function explorerUrl(sig: string): string {
    if (RPC.includes('devnet')) {
        return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
    }
    if (RPC.includes('mainnet')) {
        return `https://explorer.solana.com/tx/${sig}`;
    }
    return `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(RPC)}`;
}
