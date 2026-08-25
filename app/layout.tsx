import type { Metadata } from 'next';
import { Fira_Code, Fira_Sans } from 'next/font/google';
import './globals.css';

// Fira Sans / Fira Code: the pairing the UI/UX skill recommends for dashboards
// and admin panels. Loaded through next/font, so the files are self-hosted and
// there is no render-blocking request to Google in production.
const firaSans = Fira_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const firaCode = Fira_Code({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'NexaConnect AI Support Assistant',
  description:
    'First-line customer support for NexaConnect: grounded answers, deterministic escalation, full audit trail.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${firaSans.variable} ${firaCode.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
