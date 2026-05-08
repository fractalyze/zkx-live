// GET /api/auth/login → 302 to GitHub OAuth authorize.
import type { NextApiRequest, NextApiResponse } from 'next';

const SCOPES = 'public_repo';   // needed for PUT /user/starred (auto-star)

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const appUrl = process.env.APP_URL ?? 'http://localhost:13000';
    if (!clientId) {
        res.status(500).send('GITHUB_CLIENT_ID env not set');
        return;
    }
    const params = new URLSearchParams({
        client_id: clientId,
        scope: SCOPES,
        redirect_uri: `${appUrl}/api/auth/callback`,
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
}
