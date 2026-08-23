import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'NexaConnect AI Support Assistant',
  description:
    'First-line customer support for NexaConnect: grounded answers, deterministic escalation, full audit trail.',
};

const NAV = [
  { href: '/', label: 'Customer chat' },
  { href: '/agent', label: 'Agent console' },
  { href: '/analytics', label: 'Analytics' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans">
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="border-b border-rule bg-card">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <span className="flex items-center gap-2 font-semibold tracking-tight">
              <span
                aria-hidden
                className="inline-block h-4 w-4 rounded-sm bg-accent"
              />
              NexaConnect
              <span className="font-normal text-muted">Support</span>
            </span>
            <nav aria-label="Main" className="flex gap-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded px-2.5 py-1.5 text-muted hover:bg-accent-soft hover:text-accent-deep"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
