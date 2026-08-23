import Link from 'next/link';
import CaseActions from '@/components/case-actions';
import {
  EmptyState,
  KbChip,
  RuleChip,
  Tag,
  URGENCY_TEXT,
  UrgencyRail,
  naira,
  shortTime,
} from '@/components/primitives';
import { getTicket, listTickets } from '@/lib/db';
import { loadKnowledgeBase } from '@/lib/retrieval';
import {
  CATEGORIES,
  TicketQuerySchema,
  URGENCIES,
  type Ticket,
  type TicketQuery,
} from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  const found = Array.isArray(value) ? value[0] : value;
  return found && found.length > 0 ? found : undefined;
}

export default async function AgentConsole({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;

  const parsed = TicketQuerySchema.safeParse({
    urgency: one(params.urgency),
    category: one(params.category),
    escalatedOnly: one(params.escalated) === 'true' ? true : undefined,
    unresolvedOnly: one(params.unresolved) === 'true' ? true : undefined,
  });
  // Zod keeps explicitly-undefined optional keys, so strip them before
  // counting: an unfiltered queue must not claim to be filtered.
  const query: TicketQuery = Object.fromEntries(
    Object.entries(parsed.success ? parsed.data : {}).filter(([, value]) => value !== undefined),
  );
  const activeFilters = Object.keys(query).length;

  const tickets = listTickets({ ...query, sort: 'triage' });
  const selectedId = one(params.case);
  const selected = selectedId ? getTicket(selectedId) : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Triage queue</h1>
          <p className="text-sm text-muted">
            {tickets.length} case{tickets.length === 1 ? '' : 's'}
            {activeFilters > 0 ? ' matching your filters' : ' in the queue, worst first'}
          </p>
        </div>
        <Filters params={params} />
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <section aria-label="Cases" className="space-y-2.5">
          {tickets.length === 0 ? (
            <EmptyState title="Nothing in the queue">
              Send an enquiry from the customer chat, or run <code>npm run seed</code> to load the
              labelled demo set.
            </EmptyState>
          ) : (
            tickets.map((ticket) => (
              <QueueRow key={ticket.id} ticket={ticket} params={params} selected={ticket.id === selectedId} />
            ))
          )}
        </section>

        <aside aria-label="Case detail" className="lg:sticky lg:top-4 lg:self-start">
          {selected ? (
            <CaseDetail ticket={selected} />
          ) : (
            <div className="rounded-xl border border-dashed border-rule bg-card p-6 text-sm text-muted">
              Select a case to see the customer message, the knowledge base sections behind the
              answer, and the reasoning trail.
            </div>
          )}
        </aside>
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

function Filters({ params }: { params: Search }) {
  const urgency = one(params.urgency);
  const category = one(params.category);

  return (
    <nav aria-label="Filters" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <FilterGroup label="Urgency">
        <FilterLink href={withParam(params, 'urgency')} active={!urgency}>
          All
        </FilterLink>
        {URGENCIES.map((value) => (
          <FilterLink
            key={value}
            href={withParam(params, 'urgency', value)}
            active={urgency === value}
          >
            {value}
          </FilterLink>
        ))}
      </FilterGroup>

      <FilterGroup label="Category">
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
      </FilterGroup>

      <FilterGroup label="Show">
        <FilterLink
          href={withParam(params, 'escalated', one(params.escalated) ? undefined : 'true')}
          active={one(params.escalated) === 'true'}
        >
          Escalated only
        </FilterLink>
        <FilterLink
          href={withParam(params, 'unresolved', one(params.unresolved) ? undefined : 'true')}
          active={one(params.unresolved) === 'true'}
        >
          Unresolved only
        </FilterLink>
      </FilterGroup>
    </nav>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-muted">{label}</span>
      {children}
    </div>
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
      className={`rounded border px-1.5 py-0.5 ${
        active
          ? 'border-accent bg-accent text-white'
          : 'border-rule bg-card text-muted hover:bg-accent-soft hover:text-accent-deep'
      }`}
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ */

function QueueRow({
  ticket,
  params,
  selected,
}: {
  ticket: Ticket;
  params: Search;
  selected: boolean;
}) {
  const href = withParam({ ...params, case: undefined }, 'case', ticket.id);

  return (
    <article
      className={`relative overflow-hidden rounded-xl border bg-card shadow-card ${
        selected ? 'border-accent' : 'border-rule'
      }`}
    >
      <UrgencyRail urgency={ticket.urgency} />
      <div className="space-y-2 py-3 pl-4 pr-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`font-semibold ${URGENCY_TEXT[ticket.urgency]}`}>{ticket.urgency}</span>
          <Tag>{ticket.category}</Tag>
          {ticket.escalated ? <Tag tone="warn">{ticket.route}</Tag> : <Tag tone="accent">Auto-answered</Tag>}
          {ticket.resolved ? <Tag tone="accent">Resolved</Tag> : null}
          <span className="ml-auto font-mono text-muted">{ticket.id}</span>
          <span className="text-muted">{shortTime(ticket.createdAt)}</span>
        </div>

        <Link href={href} className="block">
          <p className="text-sm font-medium">{ticket.message}</p>
        </Link>

        <div className="flex flex-wrap items-center gap-1.5">
          {ticket.firedRules.length > 0 ? (
            ticket.firedRules.map((rule) => <RuleChip key={rule.id} rule={rule} />)
          ) : (
            <span className="text-[11px] text-muted">no escalation rule fired</span>
          )}
          <span className="mx-1 text-rule">|</span>
          {ticket.retrievedChunks.map((id) => (
            <KbChip key={id} id={id} cited={ticket.kbSources.includes(id)} />
          ))}
        </div>

        <div className="rounded border border-rule bg-paper p-2.5">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Draft reply</div>
          <p className="whitespace-pre-wrap text-sm text-ink/90">{ticket.reply}</p>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          <span>{ticket.sentiment}</span>
          <span>confidence {ticket.confidence}</span>
          <span>{ticket.latencyMs} ms</span>
          {ticket.orderRef ? <span className="font-mono">{ticket.orderRef}</span> : null}
          {ticket.contactCount > 1 ? <span>contact {ticket.contactCount}</span> : null}
          <Link href={href} className="ml-auto font-medium text-accent-deep underline">
            Open case
          </Link>
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */

function CaseDetail({ ticket }: { ticket: Ticket }) {
  const chunks = loadKnowledgeBase();
  const retrieved = ticket.retrievedChunks
    .map((id) => chunks.find((chunk) => chunk.id === id))
    .filter((chunk): chunk is NonNullable<typeof chunk> => Boolean(chunk));

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-xl border border-rule bg-card p-4 shadow-card">
        <UrgencyRail urgency={ticket.urgency} />
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-mono text-sm font-semibold">{ticket.id}</h2>
          <span className="text-xs text-muted">{shortTime(ticket.createdAt)}</span>
        </div>
        <p className="mt-2 text-sm">{ticket.message}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <Row label="Intent">{ticket.intent}</Row>
          <Row label="Sentiment">{ticket.sentiment}</Row>
          <Row label="Confidence">{ticket.confidence}</Row>
          <Row label="Routed to">{ticket.route}</Row>
          <Row label="SLA">{ticket.slaHours ? `${ticket.slaHours}h` : '—'}</Row>
          <Row label="Latency">{ticket.latencyMs} ms</Row>
          {ticket.orderRef ? (
            <Row label="Order">
              <span className="font-mono">{ticket.orderRef}</span>
              {ticket.orderFound === false ? ' (not found)' : ''}
            </Row>
          ) : null}
          {ticket.orderStatus ? <Row label="Order status">{ticket.orderStatus}</Row> : null}
          {ticket.orderValue ? <Row label="Order value">{naira(ticket.orderValue)}</Row> : null}
          <Row label="Contacts">{ticket.contactCount}</Row>
        </dl>
      </div>

      <section className="rounded-xl border border-rule bg-card p-4">
        <h3 className="text-sm font-semibold">Reasoning trail</h3>
        <ol className="mt-2 space-y-2 text-xs">
          <li>
            <span className="text-muted">1. Retrieved</span>{' '}
            {ticket.retrievedChunks.join(', ') || 'nothing'}
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
              <ul className="mt-1 space-y-1">
                {ticket.firedRules.map((rule) => (
                  <li key={rule.id} className="rounded border border-rule bg-paper p-2">
                    <div className="flex items-center gap-2">
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
          <p className="mt-3 rounded border border-urgency-high/30 bg-urgency-high/5 p-2 text-xs text-urgency-ink-high">
            {ticket.groundingNote}
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-rule bg-card p-4">
        <h3 className="text-sm font-semibold">Knowledge base sections retrieved</h3>
        <div className="mt-2 space-y-2">
          {retrieved.map((chunk) => (
            <details key={chunk.id} className="rounded border border-rule bg-paper p-2">
              <summary className="cursor-pointer text-xs">
                <span className="font-mono font-semibold">{chunk.id}</span> {chunk.title}
                {ticket.kbSources.includes(chunk.id) ? (
                  <span className="ml-2 text-accent-deep">cited</span>
                ) : (
                  <span className="ml-2 text-muted">not cited</span>
                )}
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-muted">
                {chunk.text}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-rule bg-card p-4">
        <h3 className="text-sm font-semibold">Case note</h3>
        <p className="mt-1 text-sm text-muted">{ticket.summary}</p>
        {ticket.assignedTo ? (
          <p className="mt-2 text-xs">
            Assigned to <span className="font-medium">{ticket.assignedTo}</span>
          </p>
        ) : null}
        {ticket.resolutionNote ? (
          <p className="mt-1 text-xs text-muted">Resolution: {ticket.resolutionNote}</p>
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
