// POST /api/auth/logout → clear cookie
import type { NextApiRequest, NextApiResponse } from 'next';
import { clearSessionCookieHeader } from '@/lib/session';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
    res.setHeader('Set-Cookie', clearSessionCookieHeader());
    res.json({ ok: true });
}
