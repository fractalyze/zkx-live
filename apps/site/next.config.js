/** @type {import('next').NextConfig} */
// Reverse-proxy approach: the inline demo POSTs to same-origin /api/claim
// (and uses /api/auth/* for OAuth state). All of those route into the
// already-running apps/bounty Next.js server on :3000. SSE works fine
// through Next's rewrite layer.
const BOUNTY_ORIGIN = process.env.BOUNTY_ORIGIN || 'http://127.0.0.1:3002';

const nextConfig = {
    reactStrictMode: true,
    async rewrites() {
        return [
            { source: '/api/claim',         destination: `${BOUNTY_ORIGIN}/api/claim` },
            { source: '/api/auth/:path*',   destination: `${BOUNTY_ORIGIN}/api/auth/:path*` },
            { source: '/api/star-state',    destination: `${BOUNTY_ORIGIN}/api/star-state` },
        ];
    },
};

module.exports = nextConfig;
