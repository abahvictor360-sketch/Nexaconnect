'use client';

import { useEffect, useRef, useState } from 'react';
import type { Ticket } from '@/lib/types';

interface Turn {
  role: 'customer' | 'assistant' | 'system';
  text: string;
  ticket?: Ticket;
  notice?: string | null;
}

type Mode = 'ai' | 'offline' | null;

const QUICK_REPLIES = [
  'How much is delivery to Port Harcourt?',
  'Where is my order NX-482913?',
  'I was charged twice for NX-336208',
  'Abeg, wetin dey happen with NX-517044?',
];

const RATINGS = [
  { score: 1, label: 'Bad' },
  { score: 2, label: 'Okay' },
  { score: 3, label: 'Good' },
  { score: 4, label: 'Amazing' },
] as const;

type Stage = 'chatting' | 'closing' | 'thanks';

export default function Chat() {
  const [turns, setTurns] = useState<Turn[]>([
    {
      role: 'assistant',
      text: "Hello 👋\nI'm the NexaConnect assistant. Ask me anything, or pick an option below.",
    },
  ]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [stage, setStage] = useState<Stage>('chatting');
  const [mode, setMode] = useState<Mode>(null);
  const [startedAt] = useState(() => Date.now());
  const [conversationId] = useState(() => `conv-${Math.random().toString(36).slice(2, 10)}`);
  const endRef = useRef<HTMLDivElement>(null);

  const cases = turns.filter((turn) => turn.ticket).map((turn) => turn.ticket!);
  const lastCase = cases.at(-1);
  const handoff = cases.find((ticket) => ticket.escalated);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns, pending, stage]);

  async function send(message: string) {
    const text = message.trim();
    if (!text || pending || stage !== 'chatting') return;

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
            text: data?.error ?? 'Something went wrong on our side. Please ask for a person.',
          },
        ]);
        return;
      }

      if (data.mode === 'ai' || data.mode === 'offline') setMode(data.mode);
      setTurns((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: data.answer ?? (data.ticket as Ticket).reply,
          notice: data.notice ?? null,
          ticket: data.ticket as Ticket,
        },
      ]);
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
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="flex min-h-[34rem] flex-col overflow-hidden rounded-2xl bg-brand-gradient shadow-lift">
        <Header caseId={lastCase?.id} stage={stage} escalated={Boolean(handoff)} />

        {mode === 'offline' ? <OfflineBanner /> : null}

        <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4 pt-1 sm:px-5" aria-live="polite">
          {turns.map((turn, index) => (
            <Bubble
              key={index}
              turn={turn}
              showAvatar={turn.role === 'assistant' && turns[index - 1]?.role !== 'assistant'}
            />
          ))}

          {turns.length === 1 && !pending ? (
            <QuickReplies onPick={send} disabled={stage !== 'chatting'} />
          ) : null}

          {pending ? <Typing /> : null}

          {stage === 'closing' && lastCase ? (
            <ClosureSummary
              ticket={lastCase}
              caseCount={cases.length}
              durationMs={Date.now() - startedAt}
              onSubmitted={() => setStage('thanks')}
            />
          ) : null}

          {stage === 'thanks' ? <ThankYou /> : null}

          <div ref={endRef} />
        </div>

        {stage === 'chatting' ? (
          <Composer
            draft={draft}
            pending={pending}
            onChange={setDraft}
            onSend={() => void send(draft)}
            canEnd={cases.length > 0}
            onEnd={() => setStage('closing')}
          />
        ) : null}

        <p className="px-5 pb-3 text-center text-[11px] text-brand-100/70">
          Answers come only from NexaConnect&apos;s published policies and your own order record.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Header({
  caseId,
  stage,
  escalated,
}: {
  caseId?: string;
  stage: Stage;
  escalated: boolean;
}) {
  const status =
    stage === 'chatting' ? (escalated ? 'With a person' : 'Live') : stage === 'closing' ? 'Ending' : 'Ended';

  return (
    <div className="flex items-center justify-between gap-3 px-5 py-4">
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold text-white">NexaConnect support</h1>
        <p className="truncate text-xs text-brand-100/80">
          {caseId ? <span className="font-mono">{caseId}</span> : 'First-line assistant'}
        </p>
      </div>
      <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white">
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${stage === 'chatting' ? 'bg-brand-300' : 'bg-white/60'}`}
        />
        {status}
      </span>
    </div>
  );
}

/**
 * The offline fallback must never be mistaken for the model. It says what it
 * is, and what to do about it, without breaking the conversation.
 */
function OfflineBanner() {
  return (
    <div className="mx-4 mb-1 rounded-2xl bg-white/95 px-3.5 py-2.5 sm:mx-5">
      <p className="text-xs font-semibold text-ink">Offline demo mode</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
        No <code className="font-mono">ANTHROPIC_API_KEY</code> is configured, so replies are
        knowledge base lines quoted verbatim rather than written by Claude. Escalation, routing and
        order lookup are the real thing. Add a key to <code className="font-mono">.env.local</code>{' '}
        and restart to use the model.
      </p>
    </div>
  );
}

function Bubble({ turn, showAvatar }: { turn: Turn; showAvatar: boolean }) {
  if (turn.role === 'customer') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-bubble bg-brand-900 px-4 py-3 text-sm leading-relaxed text-white shadow-bubble">
          {turn.text}
        </p>
      </div>
    );
  }

  if (turn.role === 'system') {
    return (
      <p className="rounded-bubble bg-white/95 px-4 py-3 text-sm text-urgency-ink-critical shadow-bubble">
        {turn.text}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        {showAvatar ? (
          <span
            aria-hidden
            className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-200 text-xs font-bold text-brand-800 ring-4 ring-white/25"
          >
            NX
          </span>
        ) : (
          <span aria-hidden className="w-9 shrink-0" />
        )}
        <p className="max-w-[85%] whitespace-pre-wrap rounded-bubble bg-brand-200 px-4 py-3 text-sm leading-relaxed text-brand-900 shadow-bubble">
          {turn.text}
        </p>
      </div>

      {turn.notice ? <HandoffCard ticket={turn.ticket!} notice={turn.notice} /> : null}
      {turn.ticket ? <Provenance ticket={turn.ticket} /> : null}
    </div>
  );
}

/**
 * The handoff pattern from the reference: a distinct card, not a sentence
 * buried in the reply. Desk, wait time and the reason are all read from the
 * rule engine's decision, so the card cannot promise something it did not do.
 */
function HandoffCard({ ticket, notice }: { ticket: Ticket; notice: string }) {
  const initials = ticket.route
    .replace(/&/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('');

  return (
    <div className="ml-11 rounded-2xl bg-white/95 p-3.5 shadow-bubble">
      <p className="text-[11px] uppercase tracking-wide text-muted">Connecting you with</p>
      <div className="mt-1.5 flex items-center gap-2.5">
        <span
          aria-hidden
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent-deep"
        >
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{ticket.route}</p>
          <p className="text-xs text-muted">
            A person will reply within {ticket.slaHours} {ticket.slaHours === 1 ? 'hour' : 'hours'}
          </p>
        </div>
      </div>
      <p className="mt-2.5 border-t border-rule pt-2.5 text-xs leading-relaxed text-muted">{notice}</p>
    </div>
  );
}

function Provenance({ ticket }: { ticket: Ticket }) {
  return (
    <p className="ml-11 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-brand-100/80">
      {ticket.kbSources.length > 0 ? (
        <span>Based on policy {ticket.kbSources.join(', ')}</span>
      ) : (
        <span>Not covered by our published policies</span>
      )}
      <span aria-hidden>·</span>
      <span className="font-mono">{ticket.id}</span>
    </p>
  );
}

function QuickReplies({ onPick, disabled }: { onPick: (value: string) => void; disabled: boolean }) {
  return (
    <div className="ml-11 space-y-1.5 rounded-2xl bg-white/95 p-2.5 shadow-bubble">
      <p className="px-1 text-[11px] uppercase tracking-wide text-muted">Try one of these</p>
      {QUICK_REPLIES.map((reply) => (
        <button
          key={reply}
          type="button"
          disabled={disabled}
          onClick={() => onPick(reply)}
          className="flex min-h-11 w-full items-center rounded-xl border border-rule px-3 text-left text-[13px] text-ink hover:border-accent/50 hover:bg-accent-soft disabled:opacity-50"
        >
          {reply}
        </button>
      ))}
    </div>
  );
}

function Typing() {
  return (
    <div className="ml-11 flex items-center gap-2" role="status" aria-label="Assistant is typing">
      <span className="flex items-center gap-1 rounded-full bg-brand-200 px-3.5 py-2.5">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-800/60"
            style={{ animationDelay: `${index * 160}ms` }}
          />
        ))}
      </span>
      <span className="text-xs text-brand-100/80">checking our policies…</span>
    </div>
  );
}

function Composer({
  draft,
  pending,
  onChange,
  onSend,
  canEnd,
  onEnd,
}: {
  draft: string;
  pending: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  canEnd: boolean;
  onEnd: () => void;
}) {
  return (
    <div className="space-y-2 px-4 pb-2 sm:px-5">
      <form
        className="flex items-center gap-2 rounded-full bg-brand-200 pl-4 pr-1.5 py-1.5 shadow-bubble"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <label className="sr-only" htmlFor="message">
          Your message
        </label>
        <input
          id="message"
          value={draft}
          disabled={pending}
          placeholder="Text message"
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          className="h-11 min-w-0 flex-1 bg-transparent text-sm text-brand-900 placeholder:text-brand-800/75 focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending || draft.trim().length === 0}
          aria-label="Send message"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-900 text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-brand-900/45"
        >
          <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M10 16V4m0 0 5 5m-5-5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>

      {canEnd ? (
        <button
          type="button"
          onClick={onEnd}
          className="mx-auto flex min-h-11 items-center rounded-full px-3 text-xs text-brand-100/80 underline hover:text-white"
        >
          End this chat
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ClosureSummary({
  ticket,
  caseCount,
  durationMs,
  onSubmitted,
}: {
  ticket: Ticket;
  caseCount: number;
  durationMs: number;
  onSubmitted: () => void;
}) {
  const [score, setScore] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1000);

  async function submit() {
    if (score === null) return;
    setBusy(true);
    try {
      await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          satisfaction: score,
          ...(reason.trim() ? { satisfactionReason: reason.trim() } : {}),
        }),
      });
    } finally {
      setBusy(false);
      onSubmitted();
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-center text-[11px] font-medium uppercase tracking-wide text-brand-100/80">
        — Chat closed —
      </p>

      <div className="rounded-2xl bg-white/95 p-4 shadow-bubble">
        <h2 className="text-sm font-semibold text-ink">Summary of this chat</h2>
        <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div>
            <dt className="text-muted">Last case</dt>
            <dd className="font-mono font-medium text-ink">{ticket.id}</dd>
          </div>
          <div>
            <dt className="text-muted">Questions asked</dt>
            <dd className="font-medium text-ink">{caseCount}</dd>
          </div>
          <div>
            <dt className="text-muted">Chat duration</dt>
            <dd className="font-medium text-ink">
              {minutes} min {seconds} sec
            </dd>
          </div>
          <div>
            <dt className="text-muted">Now with</dt>
            <dd className="font-medium text-ink">
              {ticket.escalated ? ticket.route : 'Resolved by the assistant'}
            </dd>
          </div>
        </dl>

        <div className="mt-4 border-t border-rule pt-3.5">
          <p className="text-sm font-medium text-ink">Thanks for the chat. How do you feel?</p>
          <div className="mt-2.5 grid grid-cols-4 gap-2">
            {RATINGS.map((rating) => {
              const active = score === rating.score;
              return (
                <button
                  key={rating.score}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setScore(rating.score)}
                  className={`min-h-11 rounded-xl border px-2 text-xs font-medium ${
                    active
                      ? 'border-accent bg-accent-soft text-accent-deep'
                      : 'border-rule bg-card text-muted hover:border-accent/40'
                  }`}
                >
                  {rating.label}
                </button>
              );
            })}
          </div>

          <label className="mt-3 block text-xs text-muted">
            What are the main reasons for your rating?
            <textarea
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Fill the reasons for your rating"
              className="mt-1 w-full resize-y rounded-xl border border-rule bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted/70"
            />
          </label>

          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={onSubmitted}
              className="min-h-11 rounded-full border border-rule px-4 text-xs text-muted hover:bg-paper"
            >
              Skip
            </button>
            <button
              type="button"
              disabled={score === null || busy}
              onClick={() => void submit()}
              className="min-h-11 rounded-full bg-brand-900 px-5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-40"
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThankYou() {
  return (
    <div className="rounded-2xl bg-white/95 px-4 py-8 text-center shadow-bubble">
      <span
        aria-hidden
        className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent-deep"
      >
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path
            d="M20 11.5c0 4-3.6 7.2-8 7.2-1 0-2-.2-2.9-.5L4 20l1.3-3.4A6.9 6.9 0 0 1 4 11.5C4 7.5 7.6 4.3 12 4.3s8 3.2 8 7.2Z"
            strokeLinecap="round"
          />
          <path d="m9.2 11.6 1.9 1.9 3.7-3.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <h2 className="mt-3 text-base font-semibold text-ink">Thanks for your feedback!</h2>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">
        Thank you for contacting NexaConnect. If you have any further complaints or issues, please
        feel free to contact us again.
      </p>
    </div>
  );
}
