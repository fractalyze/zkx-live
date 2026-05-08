// Tiny signed-cookie session for the GitHub OAuth flow.
//
// We HMAC-sign the cookie payload so the client can't tamper with the access
// token / user_id. HTTP-only + SameSite=Lax for CSRF on the OAuth callback.
// Single-machine demo — no need for an external session store.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextApiRequest } from 'next';

export const COOKIE_NAME = 'gh_session';
const ONE_DAY = 60 * 60 * 24;

const SECRET = process.env.COOKIE_SECRET ?? 'dev-only-INSECURE-set-COOKIE_SECRET';

export type Session = {
    access_token: string;
    login: string;
    id: number;
};

export function signCookie(session: Session): string {
    const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
    const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
    return `${payload}.${sig}`;
}

export function verifyCookie(value: string | undefined): Session | null {
    if (!value) return null;
    const [payload, sig] = value.split('.');
    if (!payload || !sig) return null;
    const expected = createHmac('sha256', SECRET).update(payload).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        return null;
    }
    try {
        return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Session;
    } catch {
        return null;
    }
}

export function setSessionCookieHeader(session: Session): string {
    return [
        `${COOKIE_NAME}=${signCookie(session)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${ONE_DAY}`,
    ].join('; ');
}

export function clearSessionCookieHeader(): string {
    return [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'Max-Age=0'].join('; ');
}

export function getSession(req: NextApiRequest): Session | null {
    return verifyCookie(req.cookies[COOKIE_NAME]);
}
