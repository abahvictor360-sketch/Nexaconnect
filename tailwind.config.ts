import type { Config } from 'tailwindcss';

/**
 * NexaConnect design language: warm paper, ink text, a single deep-green
 * accent, and four fixed urgency colours reused across all three routes.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#FAF7F2',
        card: '#FFFFFF',
        ink: '#14181A',
        muted: '#5D6663',
        rule: '#E4DED4',
        accent: { DEFAULT: '#0F6D5A', soft: '#E3F0EB', deep: '#0A4D3F' },
        // Validated as a four-slot categorical palette against the paper
        // surface: lightness band, chroma floor, CVD separation (worst
        // adjacent pair deutan dE 13.4) and normal-vision separation
        // (dE 20.1) all pass. Do not hand-tune these without re-validating.
        urgency: {
          low: '#2A7BA8',
          medium: '#D6A400',
          high: '#DC4A16',
          critical: '#93174F',
        },
        // Darker steps of the same hues, for text: every one clears 4.5:1 on
        // paper, which the fills do not (amber is 2.14:1).
        'urgency-ink': {
          low: '#1F5E80',
          medium: '#7A5E00',
          high: '#A5350E',
          critical: '#7A1244',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: { xl: '0.625rem' },
      boxShadow: { card: '0 1px 2px rgba(20,24,26,0.06), 0 1px 8px rgba(20,24,26,0.04)' },
    },
  },
  plugins: [],
};

export default config;
