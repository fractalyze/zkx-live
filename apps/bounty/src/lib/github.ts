// Public GitHub API helpers. Unauth — 60 req/hr per IP, fine for one-user
// demos. For higher rate limits, add a token via env (GITHUB_TOKEN) and pass
// it in the Authorization header.

const TOKEN = process.env.GITHUB_TOKEN;

function headers(): HeadersInit {
    const h: Record<string, string> = {
        'User-Agent': 'zkx-snap-bounty',
        Accept: 'application/vnd.github+json',
    };
    if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
    return h;
}

export async function getUserId(username: string): Promise<string> {
    const r = await fetch(`https://api.github.com/users/${username}`, { headers: headers() });
    if (!r.ok) throw new Error(`GitHub user "${username}" not found (${r.status})`);
    const data = (await r.json()) as { id: number };
    return String(data.id);
}

// Pagewise scan of a user's starred list. Returns true on first match.
// Cap pages to avoid abusing the API for bogus inputs.
export async function isStarred(username: string, repo: string): Promise<boolean> {
    const target = repo.toLowerCase();
    const MAX_PAGES = 5;  // up to 500 starred repos
    for (let page = 1; page <= MAX_PAGES; page++) {
        const url = `https://api.github.com/users/${username}/starred?per_page=100&page=${page}`;
        const r = await fetch(url, { headers: headers() });
        if (!r.ok) {
            if (r.status === 404) return false;
            throw new Error(`GitHub starred lookup ${r.status}: ${await r.text()}`);
        }
        const repos = (await r.json()) as Array<{ full_name?: string }>;
        if (!Array.isArray(repos) || repos.length === 0) return false;
        for (const repoObj of repos) {
            if (repoObj.full_name?.toLowerCase() === target) return true;
        }
        if (repos.length < 100) return false;
    }
    return false;
}
