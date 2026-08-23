import type { FiredRule, Urgency } from '@/lib/types';

/* Urgency is the one thing an agent reads first, so it gets a colour rail
   and a text label — never colour alone. */
export const URGENCY_CLASS: Record<Urgency, string> = {
  Low: 'bg-urgency-low',
  Medium: 'bg-urgency-medium',
  High: 'bg-urgency-high',
  Critical: 'bg-urgency-critical',
};

export const URGENCY_TEXT: Record<Urgency, string> = {
  Low: 'text-urgency-ink-low',
  Medium: 'text-urgency-ink-medium',
  High: 'text-urgency-ink-high',
  Critical: 'text-urgency-ink-critical',
};

export function UrgencyRail({ urgency }: { urgency: Urgency }) {
  return (
    <span
      aria-hidden
      className={`absolute inset-y-0 left-0 w-1 ${URGENCY_CLASS[urgency]}`}
    />
  );
}

export function Tag({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'warn';
}) {
  const tones = {
    neutral: 'border-rule bg-paper text-muted',
    accent: 'border-accent/30 bg-accent-soft text-accent-deep',
    warn: 'border-urgency-critical/30 bg-urgency-critical/10 text-urgency-ink-critical',
  };
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium leading-4 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** A fired escalation rule, with the evidence in the tooltip and on the case page. */
export function RuleChip({ rule }: { rule: FiredRule }) {
  return (
    <span
      title={`${rule.description} — ${rule.evidence}`}
      className="inline-flex items-center gap-1 rounded border border-urgency-critical/30 bg-urgency-critical/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-4 text-urgency-ink-critical"
    >
      {rule.id}
    </span>
  );
}

export function KbChip({ id, cited }: { id: string; cited: boolean }) {
  return (
    <span
      title={cited ? `${id} was cited in the answer` : `${id} was retrieved but not cited`}
      className={`rounded border px-1.5 py-0.5 font-mono text-[11px] leading-4 ${
        cited
          ? 'border-accent/40 bg-accent-soft font-semibold text-accent-deep'
          : 'border-rule bg-paper text-muted/70'
      }`}
    >
      {id}
    </span>
  );
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-rule bg-card p-4 shadow-card">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-rule bg-card p-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</p>
    </div>
  );
}

export function naira(amount: number): string {
  return `₦${amount.toLocaleString('en-NG')}`;
}

export function shortTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
