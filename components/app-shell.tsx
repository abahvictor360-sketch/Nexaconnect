'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLinkStatus } from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { initialsOf, type Viewer } from '@/lib/viewer';

const NAV = [
  { href: '/', label: 'Customer chat', short: 'Chat', icon: ChatIcon },
  { href: '/agent', label: 'Agent console', short: 'Queue', icon: QueueIcon },
  { href: '/analytics', label: 'Analytics', short: 'Stats', icon: ChartIcon },
];

export default function AppShell({
  children,
  viewer,
}: {
  children: React.ReactNode;
  viewer: Viewer;
}) {
  const pathname = usePathname();
  // Customers have no business seeing links to the agent surfaces.
  const nav = viewer.role === 'agent' ? NAV : NAV.filter((item) => item.href === '/');

  return (
    <div className="flex min-h-dvh bg-brand-900">
      <nav
        aria-label="Main"
        className="sticky top-0 flex h-dvh w-[4.5rem] shrink-0 flex-col gap-1 bg-brand-900 px-2 py-4 lg:w-52 lg:px-3"
      >
        <Link
          href="/"
          className="mb-4 flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl px-2 py-1 text-brand-100 lg:flex-row lg:justify-start lg:gap-2"
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

        {nav.map((item) => (
          <NavLink key={item.href} item={item} active={pathname === item.href} />
        ))}

        <div className="mt-auto">
          <ProfileMenu viewer={viewer} />
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
      className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-sm ${
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

function ProfileMenu({ viewer }: { viewer: Viewer }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initials = initialsOf(viewer);

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
        className={`flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] lg:flex-row lg:justify-start lg:gap-2 lg:text-left ${
          open ? 'bg-white/15 text-white' : 'text-brand-100 hover:bg-white/10'
        }`}
      >
        <span
          aria-hidden
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-700 text-xs font-semibold text-brand-100"
        >
          {initials}
        </span>
        <span className="hidden min-w-0 leading-tight lg:block">
          <span className="block truncate text-xs font-medium">
            {viewer.signedIn ? viewer.displayName : 'Sign in'}
          </span>
          <span className="block truncate text-[11px] text-brand-300">
            {viewer.signedIn ? viewer.role : viewer.authEnabled ? 'Not signed in' : 'No auth'}
          </span>
        </span>
        <span className="lg:hidden">You</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Your account"
          className="absolute bottom-0 left-full z-20 ml-2 w-64 rounded-2xl border border-rule bg-card p-4 shadow-lift"
        >
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-bold text-accent-deep"
            >
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">
                {viewer.email ?? viewer.displayName}
              </p>
              <p className="truncate text-xs text-muted">
                {viewer.signedIn
                  ? viewer.role === 'agent'
                    ? 'Support agent'
                    : 'Customer'
                  : 'Not signed in'}
              </p>
            </div>
          </div>

          {viewer.signedIn ? (
            <dl className="mt-3 space-y-2 border-t border-rule pt-3 text-xs">
              <div>
                <dt className="text-muted">Signed in as</dt>
                <dd className="truncate text-ink">{viewer.email}</dd>
              </div>
              <div>
                <dt className="text-muted">Role</dt>
                <dd className="text-ink">{viewer.role}</dd>
              </div>
              {viewer.role === 'agent' ? (
                <div>
                  <dt className="text-muted">Assignment handle</dt>
                  <dd className="truncate font-mono text-ink">{viewer.displayName}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          <div className="mt-3 space-y-1.5 border-t border-rule pt-3">
            {viewer.role === 'agent' ? (
              <Link
                href="/agent?unresolved=true"
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center rounded-xl border border-rule px-3 text-xs text-ink hover:border-accent/50 hover:bg-accent-soft"
              >
                Open unresolved cases
              </Link>
            ) : null}

            {viewer.signedIn ? (
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="flex min-h-11 w-full items-center rounded-xl border border-rule px-3 text-xs text-ink hover:border-accent/50 hover:bg-accent-soft"
                >
                  Sign out
                </button>
              </form>
            ) : viewer.authEnabled ? (
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center rounded-xl bg-brand-900 px-3 text-xs font-medium text-white hover:bg-brand-800"
              >
                Sign in
              </Link>
            ) : null}
          </div>

          {!viewer.authEnabled ? (
            <p className="mt-3 border-t border-rule pt-3 text-[11px] leading-relaxed text-muted">
              Sign-in is not configured on this instance, so the console is open to anyone who can
              reach it. Set the Supabase auth variables to turn it on.
            </p>
          ) : null}
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
