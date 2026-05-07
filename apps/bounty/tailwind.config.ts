import type { Config } from 'tailwindcss';

const config: Config = {
    content: ['./src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            colors: {
                bg: '#0a0a0b',
                fg: '#fafafa',
                muted: '#52525b',
                accent: '#a78bfa',
                ok: '#34d399',
                warn: '#fbbf24',
                err: '#f87171',
            },
            fontFamily: {
                sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto'],
                mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
            },
        },
    },
    plugins: [],
};

export default config;
