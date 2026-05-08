// GET /api/auth/me → {logged_in, login?, id?}
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '@/lib/session';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    const session = getSession(req);
    if (!session) {
        res.json({ logged_in: false });
        return;
    }
    res.json({ logged_in: true, login: session.login, id: session.id });
}
