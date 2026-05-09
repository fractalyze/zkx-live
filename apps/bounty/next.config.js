/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    // Emit a self-contained server bundle so the production Docker image
    // can run from .next/standalone/ without dragging full node_modules.
    output: 'standalone',
};

module.exports = nextConfig;
