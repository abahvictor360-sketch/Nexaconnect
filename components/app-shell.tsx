'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/', label: 'Customer chat', icon: ChatIcon },
  { href: '/agent', label: 'Agent console', icon: QueueIcon },
  { href: '/analytics', label: 'Analytics', icon: ChartIcon },
];

/**
 * The icon rail from the console reference: dark green, brand mark on top,
 * the signed-in agent at the bottom. The active item gets a filled pill, and
 * every item keeps a visible text label on wide screens so the icons are
 * never the only cue.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-dvh bg-brand-900">
      <nav
        aria-label="Main"
        className="sticky top-0 flex h-dvh w-16 shrink-0 flex-col items-center gap-1 bg-brand-900 py-4 xl:w-52 xl:items-stretch xl:px-3"
      >
        <Link
          href="/"
          className="mb-4 flex items-center gap-2 rounded-xl px-2 py-1 text-brand-100"
          aria-label="NexaConnect home"
        >
          <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-brand-400 text-sm font-bold text-brand-900">
            N
          </span>
          <span className="hidden text-sm font-semibold tracking-tight xl:inline">NexaConnect</span>
        </Link>

        {NAV.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              title={item.label}
              className={`flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-sm transition-colors xl:px-3 ${
                active
                  ? 'bg-brand-200 font-medium text-brand-900'
                  : 'text-brand-100/80 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon />
              <span className="hidden xl:inline">{item.label}</span>
            </Link>
          );
        })}

        <div className="mt-auto flex items-center gap-2 rounded-xl px-2 py-2 text-brand-100">
          <span
            aria-hidden
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-700 text-xs font-semibold text-brand-100"
          >
            AO
          </span>
          <span className="hidden text-xs leading-tight xl:block">
            Ada Okonkwo
            <span className="block text-brand-300">Support agent</span>
          </span>
        </div>
      </nav>

      <div className="min-w-0 flex-1 bg-paper">{children}</div>
    </div>
  );
}

function ChatIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M17 10c0 3.3-3.1 6-7 6-.9 0-1.7-.1-2.5-.4L4 17l1-2.8A5.9 5.9 0 0 1 3 10c0-3.3 3.1-6 7-6s7 2.7 7 6Z" strokeLinecap="round" />
    </svg>
  );
}

function QueueIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 5h14M3 10h14M3 15h9" strokeLinecap="round" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 17h14M6 17V9m4 8V4m4 13v-6" strokeLinecap="round" />
    </svg>
  );
}
