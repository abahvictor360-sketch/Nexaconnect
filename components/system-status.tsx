import { activeDriver } from '@/lib/db';
import { hasApiKey, MODEL } from '@/lib/claude';

/**
 * What the running instance is actually using. Worth showing plainly: after a
 * deploy, "did my environment variables take effect?" should be answerable by
 * looking at the app rather than by reading logs.
 */
export function SystemStatus() {
  const ai = hasApiKey();
  const driver = activeDriver();

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl border border-rule bg-card px-4 py-2.5 text-xs">
      <span className="font-medium text-muted">Running with</span>

      <span className="flex items-center gap-1.5">
        <Dot ok={ai} />
        {ai ? (
          <>
            Claude <span className="font-mono text-muted">{MODEL}</span>
          </>
        ) : (
          <>
            Offline demo mode <span className="text-muted">- no ANTHROPIC_API_KEY set</span>
          </>
        )}
      </span>

      <span className="flex items-center gap-1.5">
        <Dot ok={driver === 'supabase'} />
        {driver === 'supabase' ? (
          <>
            Supabase Postgres <span className="text-muted">- shared, survives redeploys</span>
          </>
        ) : (
          <>
            Local SQLite file <span className="text-muted">- per-instance, not for serverless</span>
          </>
        )}
      </span>
    </div>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden
      className={`h-2 w-2 shrink-0 rounded-full ${ok ? 'bg-accent' : 'bg-urgency-medium'}`}
    />
  );
}
