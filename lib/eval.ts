import { RULE_IDS, type Category, type RuleId, type TestCase, type Ticket } from './types';

/* ------------------------------------------------------------------ */
/* Outcomes                                                           */
/* ------------------------------------------------------------------ */

export interface CaseOutcome {
  testCase: TestCase;
  /** Null when the pipeline failed outright for this case. */
  ticket: Ticket | null;
  error?: string;
}

export interface RuleRecall {
  id: RuleId;
  expected: number;
  caught: number;
}

export interface EvalReport {
  total: number;
  failures: number;
  categoryCorrect: number;
  categoryAccuracy: number;
  shouldEscalate: number;
  caughtEscalations: number;
  /** The headline metric: share of cases needing a human that got one. */
  escalationRecall: number;
  escalationPrecision: number;
  missed: CaseOutcome[];
  falseEscalations: CaseOutcome[];
  ruleRecall: RuleRecall[];
  /** Cases that claimed a grounded answer the knowledge base cannot support. */
  groundingViolations: CaseOutcome[];
  avgLatencyMs: number;
  passed: boolean;
}

function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * A missed escalation is far worse than a false one, so the run passes only on
 * full escalation recall with no fabricated grounding. Category accuracy is
 * reported but does not gate: a Complaint filed as a Delivery case still
 * reaches a human.
 */
export function scoreOutcomes(outcomes: CaseOutcome[]): EvalReport {
  const done = outcomes.filter((outcome) => outcome.ticket !== null);
  const failures = outcomes.length - done.length;

  const categoryCorrect = done.filter(
    (outcome) => outcome.ticket!.category === outcome.testCase.expectedCategory,
  ).length;

  const shouldEscalate = outcomes.filter((outcome) => outcome.testCase.shouldEscalate);
  const caught = shouldEscalate.filter((outcome) => outcome.ticket?.escalated === true);
  const missed = shouldEscalate.filter((outcome) => outcome.ticket?.escalated !== true);

  const escalated = done.filter((outcome) => outcome.ticket!.escalated);
  const falseEscalations = escalated.filter((outcome) => !outcome.testCase.shouldEscalate);

  const ruleRecall: RuleRecall[] = RULE_IDS.map((id) => {
    const expected = outcomes.filter((outcome) => outcome.testCase.expectedRules.includes(id));
    return {
      id,
      expected: expected.length,
      caught: expected.filter((outcome) =>
        outcome.ticket?.firedRules.some((rule) => rule.id === id),
      ).length,
    };
  }).filter((row) => row.expected > 0);

  // Grounding: a case the knowledge base cannot answer must not come back with
  // a cited source and a confident answer.
  const groundingViolations = done.filter(
    (outcome) =>
      outcome.testCase.mustNotGround &&
      outcome.ticket!.kbSources.length > 0 &&
      outcome.ticket!.confidence >= 60,
  );

  const latencies = done.map((outcome) => outcome.ticket!.latencyMs);

  return {
    total: outcomes.length,
    failures,
    categoryCorrect,
    categoryAccuracy: pct(categoryCorrect, done.length),
    shouldEscalate: shouldEscalate.length,
    caughtEscalations: caught.length,
    escalationRecall: pct(caught.length, shouldEscalate.length),
    escalationPrecision: pct(escalated.length - falseEscalations.length, escalated.length),
    missed,
    falseEscalations,
    ruleRecall,
    groundingViolations,
    avgLatencyMs:
      latencies.length === 0
        ? 0
        : Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    passed:
      failures === 0 &&
      missed.length === 0 &&
      groundingViolations.length === 0 &&
      shouldEscalate.length > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                          */
/* ------------------------------------------------------------------ */

function pad(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, width - 1)}…` : value.padEnd(width);
}

const TICK = '✓';
const CROSS = '✗';

export function renderTable(outcomes: CaseOutcome[]): string {
  const header = [
    pad('CASE', 6),
    pad('CATEGORY  exp / got', 30),
    pad('ESC exp/got', 12),
    pad('RULES FIRED', 34),
    'KB',
  ].join(' ');

  const rows = outcomes.map((outcome) => {
    const { testCase, ticket } = outcome;

    if (!ticket) {
      return [
        pad(testCase.id, 6),
        pad(`FAILED: ${outcome.error ?? 'unknown'}`, 30),
        pad('-', 12),
        pad('-', 34),
        '-',
      ].join(' ');
    }

    const categoryOk = ticket.category === testCase.expectedCategory;
    const escalationOk = ticket.escalated === testCase.shouldEscalate;
    const fired = ticket.firedRules.map((rule) => rule.id);
    const missingRules = testCase.expectedRules.filter((id) => !fired.includes(id));

    return [
      pad(testCase.id, 6),
      pad(
        `${categoryOk ? TICK : CROSS} ${testCase.expectedCategory} / ${ticket.category}`,
        30,
      ),
      pad(
        `${escalationOk ? TICK : CROSS} ${testCase.shouldEscalate ? 'yes' : 'no'}/${ticket.escalated ? 'yes' : 'no'}`,
        12,
      ),
      pad(
        (fired.join(',') || 'none') + (missingRules.length ? `  missing:${missingRules.join(',')}` : ''),
        34,
      ),
      ticket.kbSources.join(',') || '(none)',
    ].join(' ');
  });

  return [header, '-'.repeat(header.length), ...rows].join('\n');
}

export function renderReport(report: EvalReport): string {
  const lines: string[] = [
    '',
    `Cases run                 ${report.total}${report.failures ? ` (${report.failures} failed to run)` : ''}`,
    `Category accuracy         ${report.categoryAccuracy}%  (${report.categoryCorrect}/${report.total - report.failures})`,
    '',
    `ESCALATION RECALL         ${report.escalationRecall}%  (${report.caughtEscalations}/${report.shouldEscalate})   <- headline metric`,
    `Escalation precision      ${report.escalationPrecision}%  (${report.falseEscalations.length} false escalation${report.falseEscalations.length === 1 ? '' : 's'})`,
    `Grounding violations      ${report.groundingViolations.length}`,
    `Average latency           ${(report.avgLatencyMs / 1000).toFixed(1)}s`,
    '',
    'Per-rule recall',
  ];

  for (const row of report.ruleRecall) {
    const ok = row.caught === row.expected ? TICK : CROSS;
    lines.push(`  ${ok} ${pad(row.id, 17)} ${row.caught}/${row.expected}`);
  }

  if (report.missed.length > 0) {
    lines.push('', 'MISSED ESCALATIONS — each one is a customer left without a human:');
    for (const outcome of report.missed) {
      lines.push(`  ${outcome.testCase.id}  ${outcome.testCase.note}`);
      lines.push(`        "${outcome.testCase.message.slice(0, 90)}"`);
    }
  }

  if (report.groundingViolations.length > 0) {
    lines.push('', 'GROUNDING VIOLATIONS — answered confidently from sources that do not cover it:');
    for (const outcome of report.groundingViolations) {
      lines.push(
        `  ${outcome.testCase.id}  cited ${outcome.ticket!.kbSources.join(',')} at confidence ${outcome.ticket!.confidence}`,
      );
    }
  }

  if (report.falseEscalations.length > 0) {
    lines.push('', 'False escalations (safe, but they cost an agent time):');
    for (const outcome of report.falseEscalations) {
      lines.push(
        `  ${outcome.testCase.id}  fired ${outcome.ticket!.firedRules.map((r) => r.id).join(',')}`,
      );
    }
  }

  lines.push(
    '',
    report.passed
      ? `PASS — every case needing a human got one, and nothing was answered ungrounded.`
      : `FAIL — see above.`,
    '',
  );

  return lines.join('\n');
}

export type { Category };
