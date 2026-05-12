// GET /api/repo  →  cached metadata for the bounty repo (stars, name, url).
//
// Calling api.github.com/repos/<…> directly from every visitor's browser
// blows GitHub's unauth rate limit (60 req/hr per IP). One user repeatedly
// refreshing the demo page exhausts their own quota and the site shows
// "—" instead of a star count.
//
// This endpoint moves the call server-side. Origin shifts from "each
// user" to "the bounty box" (one shared IP, one shared 60/hr budget),
// and a 5-minute in-memory cache keeps GitHub hits at ~12/hr — way under
// the limit even without a token.
//
// If GITHUB_TOKEN is set in env, requests are authenticated (5000/hr
// instead of 60/hr) — useful if the box hosts other GH-touching
// services that also share the IP.
import type { NextApiRequest, NextApiResponse } from 'next';

const REPO = process.env.GITHUB_REPO || 'fractalyze/zkx-live';
const TOKEN = process.env.GITHUB_TOKEN;
const CACHE_TTL_MS = 5 * 60 * 1000;  // 5 minutes

type RepoCache = {
    fetchedAt: number;
    body: { stars: number; full_name: string; html_url: string };
};
let cache: RepoCache | null = null;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // ?refresh=1 bypasses both server cache and browser cache. Used by
    // the claim demo right after a successful auto-star, so the new
    // star count shows up immediately instead of waiting up to 5 min
    // for the cache to expire.
    const refresh = req.query.refresh === '1';
    res.setHeader(
        'Cache-Control',
        refresh
            ? 'no-store, max-age=0'
            : 'public, max-age=60, stale-while-revalidate=300',
    );

    const now = Date.now();
    if (!refresh && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
        res.status(200).json(cache.body);
        return;
    }

    try {
        const headers: Record<string, string> = {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'zkx-live-bounty',
        };
        if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

        const r = await fetch(`https://api.github.com/repos/${REPO}`, { headers });
        if (!r.ok) {
            // On rate-limit / network error, return stale cache if we have it.
            if (cache) {
                res.status(200).json(cache.body);
                return;
            }
            res.status(502).json({ error: `github ${r.status}` });
            return;
        }
        const d = await r.json() as {
            stargazers_count: number;
            full_name: string;
            html_url: string;
        };
        cache = {
            fetchedAt: now,
            body: {
                stars: d.stargazers_count,
                full_name: d.full_name,
                html_url: d.html_url,
            },
        };
        res.status(200).json(cache.body);
    } catch (e) {
        if (cache) {
            res.status(200).json(cache.body);
            return;
        }
        res.status(502).json({ error: String((e as Error)?.message ?? e) });
    }
}
