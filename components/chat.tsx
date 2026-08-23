'use client';

import { useEffect, useRef, useState } from 'react';
import type { Ticket } from '@/lib/types';

interface Turn {
  role: 'customer' | 'assistant' | 'system';
  text: string;
  ticket?: Ticket;
}

const SUGGESTIONS = [
  'How much is delivery to Port Harcourt?',
  'Where is my order NX-482913?',
  'I was charged twice for NX-336208',
  'Abeg, wetin dey happen with NX-517044? Na 2 weeks now!',
];

export default function Chat() {
  const [turns, setTurns] = useState<Turn[]>([
    {
      role: 'assistant',
      text: "Hello, you're through to NexaConnect support. Tell me what's happening and I'll help where I can — if I can't, I'll pass you to the right team.",
    },
  ]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [conversationId] = useState(() => `conv-${Math.random().toString(36).slice(2, 10)}`);
  const liveRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns, pending]);

  async function send(message: string) {
    const text = message.trim();
    if (!text || pending) return;

    setTurns((prev) => [...prev, { role: 'customer', text }]);
    setDraft('');
    setPending(true);

    try {
      const response = await fetch('/api/enquiry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, conversationId }),
      });
      const data = await response.json();

      if (!response.ok) {
        setTurns((prev) => [
          ...prev,
          {
            role: 'system',
            text:
              data?.error ??
              'Something went wrong on our side. Please try again, or ask for a person.',
          },
        ]);
        return;
      }

      const ticket = data.ticket as Ticket;
      setTurns((prev) => [...prev, { role: 'assistant', text: ticket.reply, ticket }]);
    } catch {
      setTurns((prev) => [
        ...prev,
        { role: 'system', text: 'Could not reach the assistant. Check your connection.' },
      ]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] max-w-2xl flex-col px-4">
      <div className="flex items-baseline justify-between gap-4 border-b border-rule py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">NexaConnect support</h1>
          <p className="text-sm text-muted">
            Answers come from our published policies. Anything else goes to a person.
          </p>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto py-5" aria-live="polite" ref={liveRef}>
        {turns.map((turn, index) => (
          <Bubble key={index} turn={turn} />
        ))}
        {turns.length === 1 && !pending ? (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => send(suggestion)}
                className="rounded-full border border-rule bg-card px-3 py-1.5 text-left text-xs text-muted hover:border-accent/40 hover:bg-accent-soft hover:text-accent-deep"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
        {pending ? <Typing /> : null}
        <div ref={endRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-rule py-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <label className="sr-only" htmlFor="message">
          Your message
        </label>
        <textarea
          id="message"
          rows={2}
          value={draft}
          disabled={pending}
          placeholder="Type your message…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send(draft);
            }
          }}
          className="min-h-[3rem] flex-1 resize-none rounded-xl border border-rule bg-card px-3 py-2 text-sm placeholder:text-muted/70 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending || draft.trim().length === 0}
          className="h-10 shrink-0 rounded-xl bg-accent px-4 text-sm font-medium text-white hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function Bubble({ turn }: { turn: Turn }) {
  if (turn.role === 'customer') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-accent px-3.5 py-2.5 text-sm text-white">
          {turn.text}
        </p>
      </div>
    );
  }

  if (turn.role === 'system') {
    return (
      <p className="rounded-xl border border-urgency-critical/30 bg-urgency-critical/5 px-3.5 py-2.5 text-sm text-urgency-ink-critical">
        {turn.text}
      </p>
    );
  }

  return (
    <div className="max-w-[85%] space-y-1.5">
      <p className="whitespace-pre-wrap rounded-xl rounded-bl-sm border border-rule bg-card px-3.5 py-2.5 text-sm shadow-card">
        {turn.text}
      </p>
      {turn.ticket ? <Provenance ticket={turn.ticket} /> : null}
    </div>
  );
}

/**
 * The customer is told, honestly, where the answer came from and whether a
 * person now has the case. Nothing here is decorative.
 */
function Provenance({ ticket }: { ticket: Ticket }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-1 text-[11px] text-muted">
      <span className="font-mono">{ticket.id}</span>
      {ticket.kbSources.length > 0 ? (
        <span>Based on policy {ticket.kbSources.join(', ')}</span>
      ) : (
        <span>Not covered by our published policies</span>
      )}
      {ticket.escalated ? (
        <span className="font-medium text-urgency-ink-high">
          With {ticket.route} · reply within {ticket.slaHours}h
        </span>
      ) : null}
    </p>
  );
}

function Typing() {
  return (
    <div className="flex items-center gap-1.5 pl-1" role="status" aria-label="Assistant is typing">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted/60"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
      <span className="ml-1 text-xs text-muted">checking our policies…</span>
    </div>
  );
}
