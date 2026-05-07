import type { NextApiRequest, NextApiResponse } from 'next';
import { startSseResponse, writeSse } from '@/lib/sse';
import { getUserId, isStarred } from '@/lib/github';
import { buildWitness, generateProof } from '@/lib/services';
import { explorerUrl, sendBounty } from '@/lib/solana';

const REPO = process.env.GITHUB_REPO || 'octocat/Hello-World';
const AMOUNT = parseInt(process.env.BOUNTY_AMOUNT || '5000000', 10);  // lamports for SOL transfer demo
const AMOUNT_HUMAN = process.env.BOUNTY_AMOUNT_HUMAN || '5 USDC';

const STAR_TIMEOUT_MS = 60_000;
const STAR_POLL_INTERVAL_MS = 1500;

// Static intent bundle for the demo — in production this would come from a
// signed intent the bounty creator authored. The recipient is appended to
// the allowlist per-request so the witness builder accepts it.
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'method not allowed' });
        return;
    }
    const { username, recipient } = req.body ?? {};
    if (typeof username !== 'string' || typeof recipient !== 'string') {
        res.status(400).json({ error: 'username and recipient (string) required' });
        return;
    }

    startSseResponse(res);

    const t0 = Date.now();
    let proofMsInternal = 0;

    try {
        // ── Step 1: poll GitHub for the star ────────────────────────────────
        writeSse(res, 'step', { key: 'star', state: 'running' });

        const tStar = Date.now();
        let starred = false;
        while (Date.now() - tStar < STAR_TIMEOUT_MS) {
            try {
                if (await isStarred(username, REPO)) {
                    starred = true;
                    break;
                }
            } catch (e: unknown) {
                writeSse(res, 'error', { message: String((e as Error)?.message ?? e) });
                res.end();
                return;
            }
            const checkAge = Date.now() - tStar;
            writeSse(res, 'star_polling', { last_check_ago_ms: checkAge });
            await sleep(STAR_POLL_INTERVAL_MS);
        }
        if (!starred) {
            writeSse(res, 'error', {
                message: `Star not detected within ${STAR_TIMEOUT_MS / 1000}s. Did you star ${REPO}?`,
            });
            res.end();
            return;
        }
        const starMs = Date.now() - tStar;
        writeSse(res, 'step', { key: 'star', state: 'done', timing_ms: starMs });

        // ── Step 2: build witness ───────────────────────────────────────────
        writeSse(res, 'step', { key: 'witness', state: 'running' });
        const tWit = Date.now();
        const userId = await getUserId(username);
        const wit = await buildWitness({
            recipient_b58: recipient,
            amount: String(AMOUNT),
            now: Math.floor(Date.now() / 1000),
            intent: { ...STATIC_INTENT, allowlist: [recipient] },
            claim: {
                subject: userId,
                object: REPO,
                timestamp: Math.floor(Date.now() / 1000),
            },
            attestor_priv_hex: ATTESTOR_PRIV_HEX,
            wallet_pda: ['11111111111111111111', '22222222222222222222'],
            recipient_token_account: ['33333333333333333333', '44444444444444444444'],
        });
        const witMs = Date.now() - tWit;
        writeSse(res, 'step', { key: 'witness', state: 'done', timing_ms: witMs });

        // ── Step 3: generate proof ──────────────────────────────────────────
        writeSse(res, 'step', { key: 'prove', state: 'running' });
        const proof = await generateProof(wit.wtns_path);
        proofMsInternal = proof.timing_ms?.proof ?? proof.timing_ms?.wall ?? 0;
        writeSse(res, 'step', { key: 'prove', state: 'done', timing_ms: proofMsInternal });

        // ── Step 4: submit Solana tx ────────────────────────────────────────
        writeSse(res, 'step', { key: 'submit', state: 'running' });
        const tSubmit = Date.now();
        const sig = await sendBounty(recipient, AMOUNT);
        const submitMs = Date.now() - tSubmit;
        writeSse(res, 'step', { key: 'submit', state: 'done', timing_ms: submitMs });

        writeSse(res, 'done', {
            tx_sig: sig,
            explorer_url: explorerUrl(sig),
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

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}
