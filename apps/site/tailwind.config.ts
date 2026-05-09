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
                page:    '#ffffff',
                surface: '#fafafa',
                rule:    '#e5e7eb',
                ruleStrong: '#cbd5e1',
                ink:     '#0b0f17',
                ink2:    '#1f2937',
                muted:   '#5b6473',
                faint:   '#8a93a3',
                accent:  '#1f5fa8',  // single accent
                accentSoft: '#eaf1fb',
                ok:      '#0a7d3a',
                warn:    '#a35a00',
                err:     '#b42318',
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
                'page': '1180px',
                'prose': '720px',
            },
        },
    },
    plugins: [],
};

export default config;
