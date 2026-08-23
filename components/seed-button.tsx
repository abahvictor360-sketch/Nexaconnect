'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** One click to make a fresh clone useful, instead of a shell command. */
export default function SeedButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-3 space-y-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const response = await fetch('/api/seed', { method: 'POST' });
            if (!response.ok) {
              setError('Could not load the demo data.');
              return;
            }
            router.refresh();
          } catch {
            setError('Could not reach the server.');
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-full bg-brand-900 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
      >
        {busy ? 'Loading…' : 'Load 15 demo cases'}
      </button>
      <p className="text-xs text-muted">Replaces any cases already in the queue.</p>
      {error ? <p className="text-xs text-urgency-ink-critical">{error}</p> : null}
    </div>
  );
}
