// GET /api/star-state → check if signed-in user has already starred GITHUB_REPO.
//
// GitHub: GET /user/starred/{owner}/{repo}
//   204 → starred
//   404 → not starred
//
// Returns { logged_in: bool, starred?: bool, repo: string }
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '@/lib/session';

const REPO = process.env.GITHUB_REPO || 'fractalyze/zkx-snap';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Tell client (and intermediate caches) not to cache star state — it
    // changes when the user (un)stars on GitHub and we want fresh reads.
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    const session = getSession(req);
    if (!session) {
        res.status(200).json({ logged_in: false, repo: REPO });
        return;
    }
    try {
        const r = await fetch(`https://api.github.com/user/starred/${REPO}`, {
            headers: {
                Authorization: `Bearer ${session.access_token}`,
                Accept: 'application/vnd.github+json',
                'User-Agent': 'zkx-snap-bounty',
            },
            cache: 'no-store',
        });
        // 204 = starred, 404 = not starred. Anything else = unknown.
        if (r.status === 204) {
            res.status(200).json({ logged_in: true, starred: true, repo: REPO });
            return;
        }
        if (r.status === 404) {
            res.status(200).json({ logged_in: true, starred: false, repo: REPO });
            return;
        }
        res.status(200).json({
            logged_in: true,
            starred: null,
            repo: REPO,
            error: `github returned ${r.status}`,
        });
    } catch (e) {
        res.status(200).json({
            logged_in: true,
            starred: null,
            repo: REPO,
            error: String((e as Error)?.message ?? e),
        });
    }
}
