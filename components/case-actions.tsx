'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DESKS, type Desk, type Ticket } from '@/lib/types';

export default function CaseActions({ ticket }: { ticket: Ticket }) {
  const router = useRouter();
  const [note, setNote] = useState(ticket.resolutionNote ?? '');
  const [assignee, setAssignee] = useState(ticket.assignedTo ?? '');
  const [route, setRoute] = useState<Desk>(ticket.route);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data?.error ?? 'Update failed');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-rule bg-card p-4">
      <h3 className="text-sm font-semibold">Agent actions</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-muted">
          Assign to
          <input
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            placeholder="e.g. payments.ada"
            className="mt-1 w-full rounded border border-rule bg-paper px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="block text-xs text-muted">
          Reroute to
          <select
            value={route}
            onChange={(event) => setRoute(event.target.value as Desk)}
            className="mt-1 w-full rounded border border-rule bg-paper px-2 py-1.5 text-sm text-ink"
          >
            {DESKS.filter((desk) => desk !== 'AI Assistant').map((desk) => (
              <option key={desk} value={desk}>
                {desk}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block text-xs text-muted">
        Resolution note
        <textarea
          value={note}
          rows={2}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What was done for the customer"
          className="mt-1 w-full resize-y rounded border border-rule bg-paper px-2 py-1.5 text-sm text-ink"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => patch({ assignedTo: assignee, route })}
          className="rounded border border-rule bg-paper px-3 py-1.5 text-sm hover:bg-accent-soft disabled:opacity-50"
        >
          Save assignment
        </button>
        {ticket.resolved ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => patch({ resolved: false })}
            className="rounded border border-rule bg-paper px-3 py-1.5 text-sm hover:bg-accent-soft disabled:opacity-50"
          >
            Reopen
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => patch({ resolved: true, resolutionNote: note })}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-deep disabled:opacity-50"
          >
            Mark resolved
          </button>
        )}
      </div>

      {error ? <p className="text-xs text-urgency-ink-critical">{error}</p> : null}
    </div>
  );
}
