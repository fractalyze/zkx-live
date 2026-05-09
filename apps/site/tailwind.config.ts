import type { Config } from 'tailwindcss';

/*
 * Product page palette — light only. Inter for body, JetBrains Mono for
 * numerals, identifiers, diagram labels. Single accent color (an
 * engineering blue with enough saturation to read as a deliberate
 * choice rather than a default link color), used sparingly: hero
 * diagram accent stroke, focal "242 ms" / "86×" stats, demo callout
 * border, grant strip rule.
 */
const config: Config = {
    content: ['./src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            colors: {
                page: 'rgb(var(--c-page) / <alpha-value>)',
                surface: 'rgb(var(--c-surface) / <alpha-value>)',
                rule: 'rgb(var(--c-rule) / <alpha-value>)',
                ruleStrong: 'rgb(var(--c-rule-strong) / <alpha-value>)',
                ink: 'rgb(var(--c-ink) / <alpha-value>)',
                ink2: 'rgb(var(--c-ink2) / <alpha-value>)',
                muted: 'rgb(var(--c-muted) / <alpha-value>)',
                faint: 'rgb(var(--c-faint) / <alpha-value>)',
                accent: 'rgb(var(--c-accent) / <alpha-value>)',
                accentSoft: 'rgb(var(--c-accent-soft) / <alpha-value>)',
                ok: 'rgb(var(--c-ok) / <alpha-value>)',
                warn: 'rgb(var(--c-warn) / <alpha-value>)',
                err: 'rgb(var(--c-err) / <alpha-value>)',
            },
            fontFamily: {
                sans: [
                    'Inter',
                    'ui-sans-serif',
                    'system-ui',
                    '-apple-system',
                    'Segoe UI',
                    'Roboto',
                    'sans-serif',
                ],
                mono: [
                    'JetBrains Mono',
                    'IBM Plex Mono',
                    'ui-monospace',
                    'SFMono-Regular',
                    'Menlo',
                    'Consolas',
                    'monospace',
                ],
            },
            fontSize: {
                'xs':   ['11.5px', { lineHeight: '16px' }],
                'sm':   ['13px',   { lineHeight: '20px' }],
                'base': ['15px',   { lineHeight: '24px' }],
                'lg':   ['17px',   { lineHeight: '26px' }],
                'xl':   ['20px',   { lineHeight: '28px' }],
                '2xl':  ['24px',   { lineHeight: '32px' }],
                '3xl':  ['30px',   { lineHeight: '38px' }],
                '4xl':  ['36px',   { lineHeight: '44px' }],
                '5xl':  ['48px',   { lineHeight: '56px' }],
                '6xl':  ['60px',   { lineHeight: '66px' }],
            },
            maxWidth: {
                // Page container — fills viewport up to 1440px, then caps and
                // centers with the section's px-* gutters. Below 1440 the
                // sections use the full available width.
                'page': '1376px',
                'prose': '720px',
            },
        },
    },
    plugins: [],
};

export default config;
