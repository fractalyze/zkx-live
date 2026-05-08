// GET /api/auth/callback?code=... → exchange code for token, set cookie, redirect /
import type { NextApiRequest, NextApiResponse } from 'next';
import { setSessionCookieHeader } from '@/lib/session';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) {
        res.status(400).send('missing ?code');
        return;
    }

    const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'zkx-snap-bounty',
        },
        body: JSON.stringify({
            client_id: process.env.GITHUB_CLIENT_ID,
            client_secret: process.env.GITHUB_CLIENT_SECRET,
            code,
        }),
    });
    const tokenData = (await tokenResp.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
        res.status(500).send(`OAuth token exchange failed: ${JSON.stringify(tokenData)}`);
        return;
    }

    const userResp = await fetch('https://api.github.com/user', {
        headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'zkx-snap-bounty',
        },
    });
    if (!userResp.ok) {
        res.status(500).send(`GitHub /user fetch failed: ${userResp.status}`);
        return;
    }
    const user = (await userResp.json()) as { login: string; id: number };

    res.setHeader('Set-Cookie', setSessionCookieHeader({
        access_token: tokenData.access_token,
        login: user.login,
        id: user.id,
    }));
    res.redirect('/');
}
