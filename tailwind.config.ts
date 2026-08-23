import type { Config } from 'tailwindcss';

/**
 * NexaConnect design language, taken from the reference set:
 *   - the pill bubbles, mint-on-green gradient card and circular send button
 *     of the customer widget,
 *   - the icon rail plus list / thread / detail three-column console,
 *   - the quick replies, agent handoff card, closure summary and CSAT step
 *     of the support-bot flow.
 *
 * One green family carries the brand; the four urgency steps are a separate,
 * validated categorical palette and are not part of it.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#EFFBF3',
          100: '#D7F5E4',
          200: '#B6EFCE', // assistant bubble, composer
          300: '#8AE3B4',
          400: '#3FC48C',
          500: '#12996B', // gradient start
          600: '#0F8A5F',
          700: '#0F6D5A', // accent, gradient end
          800: '#0B4F3E',
          900: '#0A3B2E', // customer bubble, icon rail
        },
        paper: '#F4FAF6',
        card: '#FFFFFF',
        ink: '#0F1A16',
        muted: '#5B6B64',
        rule: '#E2EDE7',
        accent: { DEFAULT: '#0F6D5A', soft: '#D7F5E4', deep: '#0B4F3E' },
        // Validated as a four-slot categorical palette against the paper
        // surface: lightness band, chroma floor, CVD separation (worst
        // adjacent pair deutan dE 13.4) and normal-vision separation
        // (dE 20.1) all pass. Do not hand-tune without re-validating.
        urgency: {
          low: '#2A7BA8',
          medium: '#D6A400',
          high: '#DC4A16',
          critical: '#93174F',
        },
        // Darker steps of the same hues for text: each clears 4.5:1 on paper
        // and on card, which the fills do not (amber is 2.16:1).
        'urgency-ink': {
          low: '#1F5E80',
          medium: '#7A5E00',
          high: '#A5350E',
          critical: '#7A1244',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.25rem',
        bubble: '1.75rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(10,59,46,0.05), 0 2px 12px rgba(10,59,46,0.05)',
        lift: '0 8px 30px rgba(10,59,46,0.10)',
        bubble: '0 2px 10px rgba(10,59,46,0.10)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(150deg, #12996B 0%, #0F8A5F 45%, #0B6B4C 100%)',
      },
    },
  },
  plugins: [],
};

export default config;
