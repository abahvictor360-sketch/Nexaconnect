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
        urgency: {
          low: '#4E7C8A',
          medium: '#B07515',
          high: '#C4531B',
          critical: '#A11B2B',
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
