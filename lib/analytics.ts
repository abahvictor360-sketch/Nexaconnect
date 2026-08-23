import { RULES } from './escalation';
import {
  CATEGORIES,
  RULE_IDS,
  SENTIMENTS,
  URGENCIES,
  type Category,
  type RuleId,
  type Sentiment,
  type Ticket,
  type Urgency,
} from './types';

export interface Slice<T extends string> {
  key: T;
  count: number;
  /** Percentage of all tickets, 0-100, one decimal place. */
  share: number;
}

export interface RuleSlice extends Slice<RuleId> {
  description: string;
}

export interface Kpis {
  total: number;
  escalated: number;
  /** Share of tickets the assistant handled without a human. */
  autoResolutionRate: number;
  escalationRate: number;
  /** Share of escalated tickets an agent has since closed. */
  agentResolvedRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  groundedRate: number;
  avgConfidence: number;
  byRule: RuleSlice[];
  byCategory: Slice<Category>[];
  bySentiment: Slice<Sentiment>[];
  byUrgency: Slice<Urgency>[];
  byDesk: Slice<string>[];
}

function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function tally<T extends string>(keys: readonly T[], pick: (t: Ticket) => T, tickets: Ticket[]) {
  const counts = new Map<T, number>(keys.map((k) => [k, 0]));
  for (const ticket of tickets) {
    const key = pick(ticket);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return keys.map((key) => ({
    key,
    count: counts.get(key) ?? 0,
    share: pct(counts.get(key) ?? 0, tickets.length),
  }));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export function computeKpis(tickets: Ticket[]): Kpis {
  const total = tickets.length;
  const escalated = tickets.filter((t) => t.escalated);
  const latencies = tickets.map((t) => t.latencyMs);

  const ruleCounts = new Map<RuleId, number>(RULE_IDS.map((id) => [id, 0]));
  for (const ticket of tickets) {
    // A ticket can fire several rules; each is counted once per ticket.
    for (const id of new Set(ticket.firedRules.map((r) => r.id))) {
      ruleCounts.set(id, (ruleCounts.get(id) ?? 0) + 1);
    }
  }

  const descriptions = new Map(RULES.map((r) => [r.id, r.description]));
  const byRule: RuleSlice[] = RULE_IDS.map((id) => ({
    key: id,
    count: ruleCounts.get(id) ?? 0,
    share: pct(ruleCounts.get(id) ?? 0, total),
    description: descriptions.get(id) ?? id,
  })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  const desks = [...new Set(tickets.map((t) => t.route))].sort();

  return {
    total,
    escalated: escalated.length,
    autoResolutionRate: pct(total - escalated.length, total),
    escalationRate: pct(escalated.length, total),
    agentResolvedRate: pct(escalated.filter((t) => t.resolved).length, escalated.length),
    avgLatencyMs: total === 0 ? 0 : Math.round(latencies.reduce((a, b) => a + b, 0) / total),
    p95LatencyMs: percentile(latencies, 95),
    groundedRate: pct(tickets.filter((t) => t.kbSources.length > 0).length, total),
    avgConfidence:
      total === 0
        ? 0
        : Math.round((tickets.reduce((sum, t) => sum + t.confidence, 0) / total) * 10) / 10,
    byRule,
    byCategory: tally(CATEGORIES, (t) => t.category, tickets),
    bySentiment: tally(SENTIMENTS, (t) => t.sentiment, tickets),
    byUrgency: tally(URGENCIES, (t) => t.urgency, tickets),
    byDesk: tally(desks, (t) => t.route, tickets),
  };
}
