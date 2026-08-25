import Link from 'next/link';
import { getViewer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function NoAccessPage() {
  const viewer = await getViewer();

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="rounded-2xl border border-rule bg-card p-6 shadow-card">
        <h1 className="text-lg font-semibold tracking-tight">Agent access only</h1>
        <p className="mt-2 text-sm text-muted">
          {viewer.email ? (
            <>
              You are signed in as <span className="font-medium text-ink">{viewer.email}</span>, but
              that account is a customer account. The triage queue and analytics are for support
              agents.
            </>
          ) : (
            <>The triage queue and analytics are for support agents.</>
          )}
        </p>
        <p className="mt-3 rounded-xl bg-paper p-3 text-xs leading-relaxed text-muted">
          An administrator grants agent access by setting the account&apos;s role in Supabase:
          <br />
          <code className="mt-1 block font-mono">
            update auth.users set raw_app_meta_data = raw_app_meta_data || &apos;&#123;&quot;role&quot;:&quot;agent&quot;&#125;&apos;::jsonb where email = &apos;…&apos;;
          </code>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/chat"
            className="inline-flex min-h-11 items-center rounded-full bg-brand-900 px-4 text-sm font-medium text-white hover:bg-brand-800"
          >
            Go to the chat
          </Link>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-full border border-rule px-4 text-sm text-muted hover:bg-paper"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
