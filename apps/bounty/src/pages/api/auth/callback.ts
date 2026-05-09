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
            'User-Agent': 'zkx-live-bounty',
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
            'User-Agent': 'zkx-live-bounty',
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

    // Render a tiny HTML page that:
    //   - if opened in a popup window: post a message to the parent and
    //     close itself (so the underlying page never navigates away)
    //   - otherwise (regular full-page nav): redirect to / so the user
    //     lands somewhere sensible. The page will pick up the cookie
    //     on next /api/auth/me probe.
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Signed in</title></head>
<body style="font-family:ui-monospace,monospace;background:#fafafa;color:#0b0f17;padding:24px">
<p>Signed in. You can close this window.</p>
<script>
  (function(){
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'zkx-auth-complete' }, '*');
        window.close();
        return;
      }
    } catch (e) { /* fall through to redirect */ }
    window.location.replace('/');
  })();
</script>
</body></html>`);
}
