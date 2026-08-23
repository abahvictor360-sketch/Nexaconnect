'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLinkStatus } from 'next/link';
import { useEffect, useRef, useState } from 'react';

const NAV = [
  { href: '/', label: 'Customer chat', short: 'Chat', icon: ChatIcon },
  { href: '/agent', label: 'Agent console', short: 'Queue', icon: QueueIcon },
  { href: '/analytics', label: 'Analytics', short: 'Stats', icon: ChartIcon },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-dvh bg-brand-900">
      <nav
        aria-label="Main"
        className="sticky top-0 flex h-dvh w-[4.5rem] shrink-0 flex-col gap-1 bg-brand-900 px-2 py-4 lg:w-52 lg:px-3"
      >
        <Link
          href="/"
          className="mb-4 flex flex-col items-center gap-1 rounded-xl px-2 py-1 text-brand-100 lg:flex-row lg:gap-2"
          aria-label="NexaConnect home"
        >
          <span
            aria-hidden
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-400 text-sm font-bold text-brand-900"
          >
            N
          </span>
          <span className="hidden text-sm font-semibold tracking-tight lg:inline">NexaConnect</span>
        </Link>

        {NAV.map((item) => (
          <NavLink key={item.href} item={item} active={pathname === item.href} />
        ))}

        <div className="mt-auto">
          <ProfileMenu />
        </div>
      </nav>

      <div className="min-w-0 flex-1 bg-paper">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Every item keeps a text label at every width — an icon-only rail leaves the
 * user guessing — and shows a pending dot the moment it is clicked, so a slow
 * route never reads as a dead link.
 */
function NavLink({
  item,
  active,
}: {
  item: (typeof NAV)[number];
  active: boolean;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={item.label}
      className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] transition-colors lg:flex-row lg:gap-3 lg:px-3 lg:py-2.5 lg:text-sm ${
        active
          ? 'bg-brand-200 font-medium text-brand-900'
          : 'text-brand-100/80 hover:bg-white/10 hover:text-white'
      }`}
    >
      <span className="relative grid place-items-center">
        <Icon />
        <Pending />
      </span>
      <span className="lg:hidden">{item.short}</span>
      <span className="hidden lg:inline">{item.label}</span>
    </Link>
  );
}

/** Renders only while its parent Link's navigation is in flight. */
function Pending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="absolute -right-1.5 -top-1 h-2 w-2 animate-pulse rounded-full bg-brand-400 ring-2 ring-brand-900"
    />
  );
}

/* ------------------------------------------------------------------ */

const AGENT = {
  name: 'Ada Okonkwo',
  role: 'Support agent',
  desk: 'Payments & Fraud Desk',
  email: 'ada.okonkwo@nexaconnect.ng',
  shift: '08:00–16:00 WAT, Mon–Sat',
  handle: 'payments.ada',
};

function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`flex w-full flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] transition-colors lg:flex-row lg:gap-2 lg:text-left ${
          open ? 'bg-white/15 text-white' : 'text-brand-100 hover:bg-white/10'
        }`}
      >
        <span
          aria-hidden
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-700 text-xs font-semibold text-brand-100"
        >
          AO
        </span>
        <span className="hidden min-w-0 leading-tight lg:block">
          <span className="block truncate text-xs font-medium">{AGENT.name}</span>
          <span className="block truncate text-[11px] text-brand-300">{AGENT.role}</span>
        </span>
        <span className="lg:hidden">You</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Your profile"
          className="absolute bottom-0 left-full z-20 ml-2 w-64 rounded-2xl border border-rule bg-card p-4 shadow-lift"
        >
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-bold text-accent-deep"
            >
              AO
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{AGENT.name}</p>
              <p className="truncate text-xs text-muted">{AGENT.role}</p>
            </div>
          </div>

          <dl className="mt-3 space-y-2 border-t border-rule pt-3 text-xs">
            <div>
              <dt className="text-muted">Desk</dt>
              <dd className="font-medium text-ink">{AGENT.desk}</dd>
            </div>
            <div>
              <dt className="text-muted">Assignment handle</dt>
              <dd className="font-mono text-ink">{AGENT.handle}</dd>
            </div>
            <div>
              <dt className="text-muted">Email</dt>
              <dd className="truncate text-ink">{AGENT.email}</dd>
            </div>
            <div>
              <dt className="text-muted">Shift</dt>
              <dd className="text-ink">{AGENT.shift}</dd>
            </div>
          </dl>

          <div className="mt-3 space-y-1.5 border-t border-rule pt-3">
            <Link
              href={`/agent?unresolved=true&route=${encodeURIComponent(AGENT.desk)}`}
              onClick={() => setOpen(false)}
              className="block rounded-xl border border-rule px-3 py-2 text-xs text-ink hover:border-accent/50 hover:bg-accent-soft"
            >
              My desk&apos;s open cases
            </Link>
            <Link
              href="/analytics"
              onClick={() => setOpen(false)}
              className="block rounded-xl border border-rule px-3 py-2 text-xs text-ink hover:border-accent/50 hover:bg-accent-soft"
            >
              Team analytics
            </Link>
          </div>

          <p className="mt-3 border-t border-rule pt-3 text-[11px] leading-relaxed text-muted">
            This prototype has no authentication, so the agent above is a fixed demo identity.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

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
