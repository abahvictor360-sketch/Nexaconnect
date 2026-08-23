import type { Metadata } from 'next';
import AppShell from '@/components/app-shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'NexaConnect AI Support Assistant',
  description:
    'First-line customer support for NexaConnect: grounded answers, deterministic escalation, full audit trail.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <AppShell>
          <main id="main" className="min-w-0">
            {children}
          </main>
        </AppShell>
      </body>
    </html>
  );
}
