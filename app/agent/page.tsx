import Link from 'next/link';
import CaseActions from '@/components/case-actions';
import {
  Avatar,
  EmptyState,
  KbChip,
  RuleChip,
  Tag,
  URGENCY_CLASS,
  URGENCY_TEXT,
  UrgencyDot,
  naira,
  shortTime,
} from '@/components/primitives';
import { getTicket, listTickets } from '@/lib/db';
import { loadKnowledgeBase } from '@/lib/retrieval';
import { CATEGORIES, TicketQuerySchema, URGENCIES, type Ticket, type TicketQuery } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  const found = Array.isArray(value) ? value[0] : value;
  return found && found.length > 0 ? found : undefined;
}

export default async function AgentConsole({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;

  const parsed = TicketQuerySchema.safeParse({
    urgency: one(params.urgency),
    category: one(params.category),
    escalatedOnly: one(params.escalated) === 'true' ? true : undefined,
    unresolvedOnly: one(params.unresolved) === 'true' ? true : undefined,
    q: one(params.q),
  });

  // Zod keeps explicitly-undefined optional keys, so strip them before
  // counting: an unfiltered queue must not claim to be filtered.
  const query: TicketQuery = Object.fromEntries(
    Object.entries(parsed.success ? parsed.data : {}).filter(([, value]) => value !== undefined),
  );
  const activeFilters = Object.keys(query).length;

  const tickets = listTickets({ ...query, sort: 'triage' });
  const selectedId = one(params.case);
  const selected = (selectedId ? getTicket(selectedId) : null) ?? tickets[0] ?? null;
  // Below lg there is only room for one pane, so the URL decides which:
  // the queue by default, a single case once one is opened.
  const detailOnly = Boolean(selectedId);

  return (
    <div className="flex flex-col lg:h-dvh lg:overflow-hidden">
      <header className="space-y-2.5 border-b border-rule bg-card px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold tracking-tight">Triage queue</h1>
            <p className="text-xs text-muted">
              {tickets.length} case{tickets.length === 1 ? '' : 's'}
              {activeFilters > 0 ? ' matching your filters' : ' in the queue, worst first'}
            </p>
          </div>
          <Search params={params} />
        </div>
        <Filters params={params} />
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)_21rem]">
        <section
          aria-label="Cases"
          className={`min-h-0 divide-y divide-rule border-r border-rule bg-card lg:block lg:overflow-y-auto ${
            detailOnly ? 'hidden' : 'block'
          }`}
        >
          {tickets.length === 0 ? (
            <div className="p-4">
              <EmptyState title="Nothing in the queue">
                Send an enquiry from the customer chat, or run <code>npm run seed</code> to load the
                labelled demo set.
              </EmptyState>
            </div>
          ) : (
            tickets.map((ticket) => (
              <ListRow
                key={ticket.id}
                ticket={ticket}
                params={params}
                selected={ticket.id === selected?.id}
              />
            ))
          )}
        </section>

        {selected ? (
          <>
            <section
              aria-label="Conversation"
              className={`min-h-0 bg-paper lg:block lg:overflow-y-auto ${
                detailOnly ? 'block' : 'hidden'
              }`}
            >
              <Link
                href={withParam({ ...params, case: undefined }, 'case')}
                className="m-4 mb-0 inline-flex items-center gap-1.5 rounded-full border border-rule bg-card px-3 py-1.5 text-xs text-muted lg:hidden"
              >
                <span aria-hidden>←</span> Back to the queue
              </Link>
              <Thread ticket={selected} />
            </section>
            <aside
              aria-label="Case detail"
              className="hidden min-h-0 border-l border-rule bg-card xl:block xl:overflow-y-auto"
            >
              <Detail ticket={selected} />
            </aside>
          </>
        ) : (
          <section className="p-6 text-sm text-muted">No case selected.</section>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function withParam(params: Search, key: string, value?: string): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const single = one(v);
    if (single && k !== key && k !== 'case') next.set(k, single);
  }
  if (value) next.set(key, value);
  const query = next.toString();
  return query ? `/agent?${query}` : '/agent';
}

function Search({ params }: { params: Search }) {
  const hidden = Object.entries(params)
    .map(([key, value]) => [key, one(value)] as const)
    .filter(([key, value]) => value && key !== 'q' && key !== 'case');

  return (
    <form action="/agent" className="flex items-center gap-2">
      {hidden.map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <label className="sr-only" htmlFor="q">
        Search cases
      </label>
      <input
        id="q"
        name="q"
        defaultValue={one(params.q) ?? ''}
        placeholder="Search message, order or case id"
        className="w-56 rounded-full border border-rule bg-paper px-3.5 py-1.5 text-xs text-ink placeholder:text-muted/80 sm:w-72"
      />
      <button
        type="submit"
        className="rounded-full bg-brand-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-brand-800"
      >
        Search
      </button>
      {one(params.q) ? (
        <Link
          href={withParam({ ...params, case: undefined }, 'q')}
          className="text-xs text-muted underline"
        >
          Clear
        </Link>
      ) : null}
    </form>
  );
}

function Filters({ params }: { params: Search }) {
  const urgency = one(params.urgency);
  const category = one(params.category);

  return (
    <nav aria-label="Filters" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
      <span className="text-muted">Urgency</span>
      <FilterLink href={withParam(params, 'urgency')} active={!urgency}>
        All
      </FilterLink>
      {URGENCIES.map((value) => (
        <FilterLink key={value} href={withParam(params, 'urgency', value)} active={urgency === value}>
          {value}
        </FilterLink>
      ))}

      <span className="ml-2 text-muted">Category</span>
      <FilterLink href={withParam(params, 'category')} active={!category}>
        All
      </FilterLink>
      {CATEGORIES.map((value) => (
        <FilterLink
          key={value}
          href={withParam(params, 'category', value)}
          active={category === value}
        >
          {value}
        </FilterLink>
      ))}

      <span className="ml-2 text-muted">Show</span>
      <FilterLink
        href={withParam(params, 'escalated', one(params.escalated) ? undefined : 'true')}
        active={one(params.escalated) === 'true'}
      >
        Escalated
      </FilterLink>
      <FilterLink
        href={withParam(params, 'unresolved', one(params.unresolved) ? undefined : 'true')}
        active={one(params.unresolved) === 'true'}
      >
        Unresolved
      </FilterLink>
    </nav>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`rounded-full border px-2 py-0.5 ${
        active
          ? 'border-brand-900 bg-brand-900 text-white'
          : 'border-rule bg-card text-muted hover:bg-accent-soft hover:text-accent-deep'
      }`}
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ */

function ListRow({
  ticket,
  params,
  selected,
}: {
  ticket: Ticket;
  params: Search;
  selected: boolean;
}) {
  return (
    <Link
      href={withParam({ ...params, case: undefined }, 'case', ticket.id)}
      aria-current={selected ? 'true' : undefined}
      className={`relative block py-3 pl-4 pr-3 hover:bg-accent-soft/50 ${
        selected ? 'bg-accent-soft/70' : ''
      }`}
    >
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${URGENCY_CLASS[ticket.urgency]}`} />
      <div className="flex items-start gap-2.5">
        <Avatar label={ticket.category} tone={ticket.escalated ? 'dark' : 'mint'} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium">{ticket.category}</span>
            <span className="shrink-0 text-[11px] text-muted">{shortTime(ticket.createdAt)}</span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">{ticket.message}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <UrgencyDot urgency={ticket.urgency} />
            {ticket.escalated ? (
              <span className="truncate text-[11px] text-urgency-ink-high">{ticket.route}</span>
            ) : (
              <span className="text-[11px] text-accent-deep">Auto-answered</span>
            )}
            {ticket.orderRef ? (
              <span className="font-mono text-[11px] text-muted">{ticket.orderRef}</span>
            ) : null}
            {ticket.contactCount > 1 ? (
              <span className="ml-auto grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-urgency-critical px-1 text-[10px] font-bold text-white">
                {ticket.contactCount}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ */

/** The case read as a conversation, which is how an agent actually reads it. */
function Thread({ ticket }: { ticket: Ticket }) {
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-rule bg-card px-4 py-3">
        <Avatar label={ticket.category} tone={ticket.escalated ? 'dark' : 'mint'} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            <span className="font-mono">{ticket.id}</span> · {ticket.intent}
          </p>
          <p className="text-xs text-muted">
            {ticket.escalated ? `${ticket.route} · reply within ${ticket.slaHours}h` : 'Handled by the assistant'}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Tag>{ticket.category}</Tag>
          {ticket.resolved ? <Tag tone="accent">Resolved</Tag> : <Tag>Open</Tag>}
        </div>
      </div>

      <div className="flex justify-end">
        <div className="max-w-[85%]">
          <p className="whitespace-pre-wrap rounded-bubble bg-brand-900 px-4 py-3 text-sm leading-relaxed text-white">
            {ticket.message}
          </p>
          <p className="mt-1 pr-2 text-right text-[11px] text-muted">
            Customer · {shortTime(ticket.createdAt)}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <Avatar label="NX" />
        <div className="max-w-[85%]">
          <p className="whitespace-pre-wrap rounded-bubble bg-brand-200 px-4 py-3 text-sm leading-relaxed text-brand-900">
            {ticket.reply}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 pl-2 text-[11px] text-muted">
            <span>Assistant draft</span>
            <span aria-hidden>·</span>
            <span>{ticket.latencyMs} ms</span>
            <span aria-hidden>·</span>
            <span>confidence {ticket.confidence}</span>
            <span aria-hidden>·</span>
            <span>{ticket.sentiment}</span>
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-rule bg-card p-4">
        <h2 className="text-sm font-semibold">Knowledge base sections</h2>
        <p className="mt-0.5 text-xs text-muted">
          Retrieved for this enquiry. Cited sections are the ones the answer stands on.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ticket.retrievedChunks.map((id) => (
            <KbChip key={id} id={id} cited={ticket.kbSources.includes(id)} />
          ))}
        </div>
        <div className="mt-3 space-y-2">
          {sectionsFor(ticket).map((chunk) => (
            <details key={chunk.id} className="rounded-xl border border-rule bg-paper p-2.5">
              <summary className="cursor-pointer text-xs">
                <span className="font-mono font-semibold">{chunk.id}</span> {chunk.title}
                <span
                  className={`ml-2 ${
                    ticket.kbSources.includes(chunk.id) ? 'text-accent-deep' : 'text-muted'
                  }`}
                >
                  {ticket.kbSources.includes(chunk.id) ? 'cited' : 'not cited'}
                </span>
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-muted">
                {chunk.text}
              </p>
            </details>
          ))}
        </div>
      </div>

      <div className="xl:hidden">
        <Detail ticket={ticket} />
      </div>
    </div>
  );
}

function sectionsFor(ticket: Ticket) {
  const chunks = loadKnowledgeBase();
  return ticket.retrievedChunks
    .map((id) => chunks.find((chunk) => chunk.id === id))
    .filter((chunk): chunk is NonNullable<typeof chunk> => Boolean(chunk));
}

/* ------------------------------------------------------------------ */

function Detail({ ticket }: { ticket: Ticket }) {
  return (
    <div className="space-y-4 p-4">
      <section>
        <h2 className="text-sm font-semibold">Case</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <Row label="Urgency">
            <span className={URGENCY_TEXT[ticket.urgency]}>{ticket.urgency}</span>
          </Row>
          <Row label="Sentiment">{ticket.sentiment}</Row>
          <Row label="Confidence">{ticket.confidence}</Row>
          <Row label="Routed to">{ticket.route}</Row>
          <Row label="SLA">{ticket.slaHours ? `${ticket.slaHours}h` : '—'}</Row>
          <Row label="Latency">{ticket.latencyMs} ms</Row>
          <Row label="Contacts">{ticket.contactCount}</Row>
          {ticket.satisfaction ? (
            <Row label="Customer rating">{['Bad', 'Okay', 'Good', 'Amazing'][ticket.satisfaction - 1]}</Row>
          ) : null}
          {ticket.orderRef ? (
            <Row label="Order">
              <span className="font-mono">{ticket.orderRef}</span>
              {ticket.orderFound === false ? ' (not found)' : ''}
            </Row>
          ) : null}
          {ticket.orderStatus ? <Row label="Order status">{ticket.orderStatus}</Row> : null}
          {ticket.orderValue ? <Row label="Order value">{naira(ticket.orderValue)}</Row> : null}
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Reasoning trail</h2>
        <ol className="mt-2 space-y-2 text-xs">
          <li>
            <span className="text-muted">1. Retrieved</span> {ticket.retrievedChunks.join(', ') || 'nothing'}
          </li>
          <li>
            <span className="text-muted">2. Cited</span>{' '}
            {ticket.kbSources.length ? ticket.kbSources.join(', ') : 'nothing — answer not grounded'}
          </li>
          <li>
            <span className="text-muted">3. Classified</span> {ticket.category} / {ticket.intent},{' '}
            {ticket.sentiment}, {ticket.urgency}, confidence {ticket.confidence}
          </li>
          <li>
            <span className="text-muted">4. Rules fired</span>{' '}
            {ticket.firedRules.length === 0 ? 'none' : ''}
            {ticket.firedRules.length > 0 ? (
              <ul className="mt-1.5 space-y-1.5">
                {ticket.firedRules.map((rule) => (
                  <li key={rule.id} className="rounded-xl border border-rule bg-paper p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <RuleChip rule={rule} />
                      <span className="text-muted">{rule.desk}</span>
                    </div>
                    <p className="mt-1">{rule.description}</p>
                    <p className="mt-0.5 text-muted">
                      Evidence: <span className="text-ink">{rule.evidence}</span>
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
          <li>
            <span className="text-muted">5. Routed to</span> {ticket.route}
          </li>
        </ol>
        {ticket.groundingNote ? (
          <p className="mt-3 rounded-xl border border-urgency-high/30 bg-urgency-high/5 p-2.5 text-xs text-urgency-ink-high">
            {ticket.groundingNote}
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="text-sm font-semibold">Case note</h2>
        <p className="mt-1 text-xs text-muted">{ticket.summary}</p>
        {ticket.assignedTo ? (
          <p className="mt-2 text-xs">
            Assigned to <span className="font-medium">{ticket.assignedTo}</span>
          </p>
        ) : null}
        {ticket.resolutionNote ? (
          <p className="mt-1 text-xs text-muted">Resolution: {ticket.resolutionNote}</p>
        ) : null}
        {ticket.satisfactionReason ? (
          <p className="mt-1 text-xs text-muted">Customer said: “{ticket.satisfactionReason}”</p>
        ) : null}
      </section>

      <CaseActions ticket={ticket} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
