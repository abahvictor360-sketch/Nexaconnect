import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearTickets, useMemoryDb } from '../lib/db';
import { evaluateEscalation } from '../lib/escalation';
import { detectOverrideAttempt } from '../lib/triage';
import { renderReport, renderTable, scoreOutcomes, type CaseOutcome } from '../lib/eval';
import { findOrder } from '../lib/orders';
import { extractOrderRef, retrieve } from '../lib/retrieval';
import {
  CATEGORIES,
  RULE_IDS,
  TestCaseSchema,
  type Classification,
  type RuleId,
  type TestCase,
  type Ticket,
} from '../lib/types';

const CASES: TestCase[] = TestCaseSchema.array().parse(
  JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'test-cases.json'), 'utf8')),
);

/** Rules that depend on the model's own judgement rather than the message text. */
const MODEL_DEPENDENT: RuleId[] = ['LOW_CONFIDENCE', 'HOSTILE'];

function byId(id: string): TestCase {
  const found = CASES.find((testCase) => testCase.id === id);
  if (!found) throw new Error(`No such labelled case: ${id}`);
  return found;
}

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'NXC-TEST',
    conversationId: 'c',
    message: 'm',
    reply: 'r',
    category: 'Delivery',
    intent: 'i',
    sentiment: 'Neutral',
    urgency: 'Low',
    confidence: 90,
    summary: 's',
    kbSources: ['KB-01'],
    retrievedChunks: ['KB-01'],
    entities: {},
    orderRef: null,
    orderFound: null,
    orderStatus: null,
    orderValue: null,
    contactCount: 1,
    escalated: false,
    firedRules: [],
    route: 'AI Assistant',
    slaHours: 0,
    groundingNote: null,
    resolved: false,
    resolutionNote: null,
    assignedTo: null,
    satisfaction: null,
    satisfactionReason: null,
    latencyMs: 1000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* The labelled set itself                                            */
/* ------------------------------------------------------------------ */

describe('the labelled set', () => {
  it('has twenty cases with unique ids', async () => {
    expect(CASES).toHaveLength(20);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(20);
  });

  it('covers every category', async () => {
    const covered = new Set(CASES.map((c) => c.expectedCategory));
    expect([...covered].sort()).toEqual([...CATEGORIES].sort());
  });

  it('covers every escalation rule', async () => {
    const covered = new Set(CASES.flatMap((c) => c.expectedRules));
    expect([...covered].sort()).toEqual([...RULE_IDS].sort());
  });

  it('includes cases that must not escalate, so precision is measurable', async () => {
    expect(CASES.filter((c) => !c.shouldEscalate).length).toBeGreaterThanOrEqual(5);
  });

  it('includes the four adversarial cases', async () => {
    const notes = CASES.map((c) => c.note).join(' ');
    expect(notes).toContain('does not cover');
    expect(notes).toContain('prompt injection');
    expect(notes).toContain('mixed with a fraud allegation');
    expect(notes).toContain('Pidgin');
    expect(CASES.filter((c) => c.mustNotGround).length).toBeGreaterThanOrEqual(2);
  });

  it('only sets priorContacts on a case whose message carries an order reference', async () => {
    for (const testCase of CASES.filter((c) => (c.priorContacts ?? 0) > 0)) {
      expect(extractOrderRef(testCase.message)).not.toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ */
/* What the deterministic engine does with these messages             */
/* ------------------------------------------------------------------ */

describe('escalation attainability, without calling the model', () => {
  /** A well-behaved, grounded, calm classification: the best case for the model. */
  function wellBehaved(testCase: TestCase): Classification {
    return {
      reply: 'r',
      category: testCase.expectedCategory,
      intent: 'i',
      sentiment: 'Neutral',
      urgency: 'Medium',
      confidence: 90,
      kbSources: ['KB-01'],
      entities: {},
      needsOrderLookup: false,
      summary: 's',
    };
  }

  function decide(testCase: TestCase) {
    const orderRef = extractOrderRef(testCase.message);
    const order = orderRef ? findOrder(orderRef) : null;
    return evaluateEscalation({
      message: testCase.message,
      classification: wellBehaved(testCase),
      contactCount: (testCase.priorContacts ?? 0) + 1,
      orderRef,
      orderValue: order?.totalValue ?? null,
    });
  }

  it.each(
    CASES.filter((c) => c.expectedRules.some((rule) => !MODEL_DEPENDENT.includes(rule))).map(
      (c) => [c.id, c] as const,
    ),
  )('%s fires its message-driven rules from the text alone', (_id, testCase) => {
    const fired = decide(testCase).firedRules.map((rule) => rule.id);
    for (const expected of testCase.expectedRules.filter((r) => !MODEL_DEPENDENT.includes(r))) {
      expect(fired).toContain(expected);
    }
  });

  it.each(CASES.filter((c) => !c.shouldEscalate).map((c) => [c.id, c] as const))(
    '%s does not escalate on a well-behaved classification',
    async (_id, testCase) => {
      const decision = decide(testCase);
      expect(decision.firedRules.map((r) => r.id)).toEqual([]);
      expect(decision.escalated).toBe(false);
    },
  );

  it('documents exactly which escalations the rule engine alone cannot guarantee', async () => {
    const notFromTextAlone = CASES.filter((c) => c.shouldEscalate && !decide(c).escalated)
      .map((c) => c.id)
      .sort();
    expect(notFromTextAlone).toEqual(['EV-15', 'EV-16', 'EV-17', 'EV-18']);
  });

  it('shows the pipeline guards close two of those four deterministically', async () => {
    // EV-16: the reference does not exist, so the lookup caps confidence to 40.
    expect(findOrder(extractOrderRef(byId('EV-16').message)!)).toBeNull();
    // EV-18: override phrasing caps confidence to 40 regardless of the model.
    expect(detectOverrideAttempt(byId('EV-18').message)).not.toBeNull();

    // The two that genuinely rest on the model's own judgement, and why:
    // EV-15 needs it read as Angry at High urgency (HOSTILE), and EV-17 needs
    // it to admit the knowledge base does not cover trade-ins, since BM25 does
    // find loosely-related store-credit text.
    expect(detectOverrideAttempt(byId('EV-15').message)).toBeNull();
    expect(retrieve(byId('EV-17').message).hasSignal).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Scoring                                                            */
/* ------------------------------------------------------------------ */

describe('scoreOutcomes', () => {
  beforeEach(async () => {
    useMemoryDb();
    await clearTickets();
  });

  const escalating: TestCase = {
    id: 'T-1',
    message: 'I was charged twice',
    note: 'n',
    expectedCategory: 'Payment',
    shouldEscalate: true,
    expectedRules: ['FRAUD'],
  };
  const calm: TestCase = {
    id: 'T-2',
    message: 'How much is delivery?',
    note: 'n',
    expectedCategory: 'Delivery',
    shouldEscalate: false,
    expectedRules: [],
  };

  it('passes when every escalation is caught', async () => {
    const report = scoreOutcomes([
      {
        testCase: escalating,
        ticket: ticket({
          category: 'Payment',
          escalated: true,
          firedRules: [
            { id: 'FRAUD', description: 'd', evidence: 'e', desk: 'Payments & Fraud Desk' },
          ],
        }),
      },
      { testCase: calm, ticket: ticket({ category: 'Delivery' }) },
    ]);

    expect(report.escalationRecall).toBe(100);
    expect(report.categoryAccuracy).toBe(100);
    expect(report.escalationPrecision).toBe(100);
    expect(report.passed).toBe(true);
  });

  it('fails on a missed escalation even when everything else is perfect', async () => {
    const report = scoreOutcomes([
      { testCase: escalating, ticket: ticket({ category: 'Payment', escalated: false }) },
      { testCase: calm, ticket: ticket({ category: 'Delivery' }) },
    ]);

    expect(report.escalationRecall).toBe(0);
    expect(report.categoryAccuracy).toBe(100);
    expect(report.missed.map((m) => m.testCase.id)).toEqual(['T-1']);
    expect(report.passed).toBe(false);
  });

  it('counts a false escalation against precision but still passes', async () => {
    const report = scoreOutcomes([
      {
        testCase: escalating,
        ticket: ticket({
          category: 'Payment',
          escalated: true,
          firedRules: [
            { id: 'FRAUD', description: 'd', evidence: 'e', desk: 'Payments & Fraud Desk' },
          ],
        }),
      },
      {
        testCase: calm,
        ticket: ticket({
          category: 'Delivery',
          escalated: true,
          firedRules: [{ id: 'HOSTILE', description: 'd', evidence: 'e', desk: 'Customer Care' }],
        }),
      },
    ]);

    expect(report.escalationRecall).toBe(100);
    expect(report.escalationPrecision).toBe(50);
    expect(report.falseEscalations.map((f) => f.testCase.id)).toEqual(['T-2']);
    // A false escalation is safe: it does not fail the run.
    expect(report.passed).toBe(true);
  });

  it('fails when an unanswerable case comes back confidently grounded', async () => {
    const ungroundable: TestCase = { ...calm, id: 'T-3', mustNotGround: true, shouldEscalate: true };
    const report = scoreOutcomes([
      {
        testCase: ungroundable,
        ticket: ticket({
          category: 'Delivery',
          escalated: true,
          kbSources: ['KB-01'],
          confidence: 95,
          firedRules: [{ id: 'HOSTILE', description: 'd', evidence: 'e', desk: 'Customer Care' }],
        }),
      },
    ]);

    expect(report.escalationRecall).toBe(100);
    expect(report.groundingViolations.map((g) => g.testCase.id)).toEqual(['T-3']);
    expect(report.passed).toBe(false);
  });

  it('accepts an unanswerable case that stayed honest', async () => {
    const ungroundable: TestCase = { ...calm, id: 'T-4', mustNotGround: true, shouldEscalate: true };
    const report = scoreOutcomes([
      {
        testCase: ungroundable,
        ticket: ticket({
          category: 'Delivery',
          escalated: true,
          kbSources: [],
          confidence: 25,
          firedRules: [
            { id: 'LOW_CONFIDENCE', description: 'd', evidence: 'e', desk: 'Customer Care' },
          ],
        }),
      },
    ]);
    expect(report.groundingViolations).toHaveLength(0);
    expect(report.passed).toBe(true);
  });

  it('treats a case that could not run as a failure, not a pass', async () => {
    const report = scoreOutcomes([
      { testCase: escalating, ticket: null, error: 'boom' },
    ]);
    expect(report.failures).toBe(1);
    expect(report.passed).toBe(false);
  });

  it('reports per-rule recall only for rules the set expects', async () => {
    const report = scoreOutcomes([
      {
        testCase: escalating,
        ticket: ticket({ escalated: true, firedRules: [] }),
      },
    ]);
    expect(report.ruleRecall).toEqual([{ id: 'FRAUD', expected: 1, caught: 0 }]);
  });

  it('renders a table row and a report for every outcome', async () => {
    const outcomes: CaseOutcome[] = [
      { testCase: escalating, ticket: ticket({ category: 'Refund', escalated: false }) },
      { testCase: calm, ticket: null, error: 'boom' },
    ];
    const table = renderTable(outcomes);
    expect(table).toContain('T-1');
    expect(table).toContain('T-2');
    expect(table).toContain('FAILED');
    expect(table).toContain('missing:FRAUD');

    const text = renderReport(scoreOutcomes(outcomes));
    expect(text).toContain('ESCALATION RECALL');
    expect(text).toContain('MISSED ESCALATIONS');
    expect(text).toContain('FAIL');
  });
});
