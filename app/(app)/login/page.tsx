import Link from 'next/link';
import { redirect } from 'next/navigation';
import LoginForm from '@/components/login-form';
import { authConfigured, getViewer, publicAuthConfig } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  // Only ever redirect within this app: an open redirect is a phishing gift.
  const next = params.next?.startsWith('/') ? params.next : '/chat';

  if (!authConfigured()) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold tracking-tight">Sign-in is not configured</h1>
        <p className="mt-2 text-sm text-muted">
          This instance has no Supabase auth credentials, so it runs open: anyone can chat as a
          guest and the agent console is unguarded. Set{' '}
          <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to turn sign-in
          on.
        </p>
        <Link
          href="/chat"
          className="mt-4 inline-flex min-h-11 items-center rounded-full bg-brand-900 px-4 text-sm font-medium text-white hover:bg-brand-800"
        >
          Continue as a guest
        </Link>
      </Shell>
    );
  }

  const viewer = await getViewer();
  if (viewer.signedIn) redirect(next);

  const { url, key } = publicAuthConfig();

  return (
    <Shell>
      <h1 className="text-lg font-semibold tracking-tight">NexaConnect support</h1>
      <p className="mt-1 text-sm text-muted">
        Sign in to keep your conversation and see the cases you have raised before.
      </p>
      <div className="mt-5">
        <LoginForm url={url} anonKey={key} next={next} />
      </div>
      <p className="mt-5 border-t border-rule pt-4 text-xs text-muted">
        You do not have to sign in to ask a question - the assistant answers guests too. Signing in
        links your cases to you so an agent can follow up.{' '}
        <Link href="/chat" className="text-accent-deep underline">
          Continue as a guest
        </Link>
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="rounded-2xl border border-rule bg-card p-6 shadow-card">{children}</div>
    </div>
  );
}
