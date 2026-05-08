import type { NextApiRequest, NextApiResponse } from 'next';
import { startSseResponse, writeSse } from '@/lib/sse';
import { getSession } from '@/lib/session';
import { buildWitness, generateProof } from '@/lib/services';
import { submitClaimTx } from '@/lib/txBuilder';
import { hasClaimed, markClaimed } from '@/lib/claimed';

const REPO = process.env.GITHUB_REPO || 'octocat/Hello-World';
const AMOUNT = parseInt(process.env.BOUNTY_AMOUNT || '5000000', 10);  // lamports
const AMOUNT_HUMAN = process.env.BOUNTY_AMOUNT_HUMAN || '5 USDC';

const STATIC_INTENT = {
    amount_cap: '100000000',
    max_per_recipient: '10000000',
    window_start: '1',
    expiry: '1778648989',
    asset: ['24197857200151252728969465429440056815',
            '338769989521388930494245921488005055265'] as [string, string],
    salt: '16045690984503098046',
};
const ATTESTOR_PRIV_HEX = process.env.ATTESTOR_PRIV_HEX || '11'.repeat(32);

// PUT /user/starred — idempotent. Returns 204 whether or not the user had
// already starred. We use the *user's* OAuth token (not our app credentials)
// so the star is attributed to them.
async function autoStar(token: string, repo: string): Promise<void> {
    const r = await fetch(`https://api.github.com/user/starred/${repo}`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'Content-Length': '0',
            'User-Agent': 'zkx-snap-bounty',
        },
    });
    if (r.status !== 204) {
        throw new Error(`Failed to star ${repo}: ${r.status} ${await r.text()}`);
    }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'method not allowed' });
        return;
    }
    const session = getSession(req);
    if (!session) {
        res.status(401).json({ error: 'not logged in — sign in with GitHub first' });
        return;
    }
    const { recipient } = (req.body ?? {}) as { recipient?: string };
    if (typeof recipient !== 'string' || recipient.length < 32) {
        res.status(400).json({ error: 'recipient (Solana base58 address) required' });
        return;
    }

    // Replay guard. Same (subject, object) the circuit's nullifier covers.
    if (hasClaimed(session.id, REPO)) {
        res.status(409).json({
            error: `@${session.login} already claimed the bounty for ${REPO}.`,
        });
        return;
    }

    startSseResponse(res);
    const t0 = Date.now();
    let proofMsInternal = 0;

    try {
        // ── Step 1: auto-star on user's behalf ──────────────────────────────
        writeSse(res, 'step', { key: 'star', state: 'running' });
        const tStar = Date.now();
        await autoStar(session.access_token, REPO);
        const starMs = Date.now() - tStar;
        writeSse(res, 'step', { key: 'star', state: 'done', timing_ms: starMs });

        // ── Step 2: build witness ───────────────────────────────────────────
        writeSse(res, 'step', { key: 'witness', state: 'running' });
        const tWit = Date.now();
        const wit = await buildWitness({
            recipient_b58: recipient,
            amount: String(AMOUNT),
            now: Math.floor(Date.now() / 1000),
            intent: { ...STATIC_INTENT, allowlist: [recipient] },
            claim: {
                subject: String(session.id),       // GitHub numeric user id from session
                object: REPO,
                timestamp: Math.floor(Date.now() / 1000),
            },
            attestor_priv_hex: ATTESTOR_PRIV_HEX,
            wallet_pda: ['11111111111111111111', '22222222222222222222'],
            recipient_token_account: ['33333333333333333333', '44444444444444444444'],
        });
        const witMs = Date.now() - tWit;
        writeSse(res, 'step', { key: 'witness', state: 'done', timing_ms: witMs });

        // ── Step 3: generate ZK proof ───────────────────────────────────────
        writeSse(res, 'step', { key: 'prove', state: 'running' });
        const proof = await generateProof(wit.wtns_path);
        proofMsInternal = proof.timing_ms?.proof ?? proof.timing_ms?.wall ?? 0;
        writeSse(res, 'step', { key: 'prove', state: 'done', timing_ms: proofMsInternal });

        // ── Step 4: submit Solana tx via gateway ────────────────────────────
        // Hands the proof + public_signals to the local tx_builder service
        // which encodes them into the gateway program's expected format
        // (proof_a pre-negation, BE field encoding), stages the chunks, and
        // submits the execute_chunked_intent + sibling System.transfer in a
        // single tx. The gateway CPIs into the verifier program — proof
        // verification + nullifier are enforced **on-chain**.
        writeSse(res, 'step', { key: 'submit', state: 'running' });
        const tSubmit = Date.now();
        const submit = await submitClaimTx({
            recipient_b58: recipient,
            proof: proof.proof,
            public_signals: proof.public_signals,
        });
        const submitMs = Date.now() - tSubmit;
        writeSse(res, 'step', { key: 'submit', state: 'done', timing_ms: submitMs });

        // Mark claimed only AFTER the on-chain tx confirmed.
        markClaimed(session.id, REPO);

        writeSse(res, 'done', {
            tx_sig: submit.tx_sig,
            explorer_url: submit.explorer_url,
            total_ms: Date.now() - t0,
            proof_ms: proofMsInternal,
            recipient,
            amount_human: AMOUNT_HUMAN,
        });
    } catch (e: unknown) {
        const msg = (e as Error)?.message ?? String(e);
        writeSse(res, 'error', { message: msg });
    } finally {
        res.end();
    }
}
