import { beforeEach, describe, expect, it } from 'vitest';
import { computeKpis } from '../lib/analytics';
import { clearTickets, insertTicket, listTickets, useMemoryDb } from '../lib/db';
import type { NewTicket } from '../lib/db';
import type { Ticket, Urgency } from '../lib/types';

function make(overrides: Partial<NewTicket> = {}): NewTicket {
  return {
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
    latencyMs: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  useMemoryDb();
  clearTickets();
});

describe('computeKpis', () => {
  it('reports zeroes for an empty set without dividing by zero', () => {
    const kpis = computeKpis([]);
    expect(kpis.total).toBe(0);
    expect(kpis.autoResolutionRate).toBe(0);
    expect(kpis.escalationRate).toBe(0);
    expect(kpis.agentResolvedRate).toBe(0);
    expect(kpis.avgLatencyMs).toBe(0);
    expect(kpis.byRule).toHaveLength(8);
  });

  it('splits auto-resolution and escalation rates so they sum to 100', () => {
    const tickets = [
      insertTicket(make()),
      insertTicket(make()),
      insertTicket(
        make({
          escalated: true,
          route: 'Payments & Fraud Desk',
          slaHours: 2,
          firedRules: [
            { id: 'FRAUD', description: 'd', evidence: 'e', desk: 'Payments & Fraud Desk' },
          ],
        }),
      ),
      insertTicket(
        make({
          escalated: true,
          resolved: true,
          route: 'Customer Care',
          slaHours: 6,
          firedRules: [
            { id: 'LOW_CONFIDENCE', description: 'd', evidence: 'e', desk: 'Customer Care' },
          ],
        }),
      ),
    ];

    const kpis = computeKpis(tickets);
    expect(kpis.total).toBe(4);
    expect(kpis.escalated).toBe(2);
    expect(kpis.escalationRate).toBe(50);
    expect(kpis.autoResolutionRate).toBe(50);
    expect(kpis.escalationRate + kpis.autoResolutionRate).toBe(100);
    // Resolved share is of escalated cases, not of everything.
    expect(kpis.agentResolvedRate).toBe(50);
  });

  it('counts a rule once per ticket even if it appears twice', () => {
    const ticket: Ticket = {
      ...insertTicket(
        make({
          escalated: true,
          firedRules: [
            { id: 'HOSTILE', description: 'd', evidence: 'e', desk: 'Customer Care' },
            { id: 'HOSTILE', description: 'd', evidence: 'again', desk: 'Customer Care' },
          ],
        }),
      ),
    };
    const hostile = computeKpis([ticket]).byRule.find((r) => r.key === 'HOSTILE');
    expect(hostile?.count).toBe(1);
    expect(hostile?.share).toBe(100);
  });

  it('lists every rule including those that never fired, most frequent first', () => {
    const kpis = computeKpis([
      insertTicket(
        make({
          escalated: true,
          firedRules: [{ id: 'SAFETY', description: 'd', evidence: 'e', desk: 'Escalations Manager' }],
        }),
      ),
    ]);
    expect(kpis.byRule).toHaveLength(8);
    expect(kpis.byRule[0].key).toBe('SAFETY');
    expect(kpis.byRule.filter((r) => r.count === 0)).toHaveLength(7);
    // Descriptions travel with the slice so the chart tooltip can explain itself.
    expect(kpis.byRule[0].description).toContain('safety');
  });

  it('reports grounded rate and latency percentiles', () => {
    const tickets = [
      insertTicket(make({ latencyMs: 1000 })),
      insertTicket(make({ latencyMs: 2000 })),
      insertTicket(make({ latencyMs: 9000, kbSources: [] })),
    ];
    const kpis = computeKpis(tickets);
    expect(kpis.groundedRate).toBe(66.7);
    expect(kpis.avgLatencyMs).toBe(4000);
    expect(kpis.p95LatencyMs).toBe(9000);
  });

  it('tallies every category, sentiment and urgency bucket', () => {
    const kpis = computeKpis([insertTicket(make())]);
    expect(kpis.byCategory).toHaveLength(7);
    expect(kpis.bySentiment).toHaveLength(4);
    expect(kpis.byUrgency).toHaveLength(4);
    expect(kpis.byCategory.find((c) => c.key === 'Delivery')?.count).toBe(1);
  });
});

describe('triage ordering', () => {
  it('puts the worst unresolved case first, not the newest', () => {
    const urgencies: Urgency[] = ['Low', 'Critical', 'Medium', 'High'];
    for (const urgency of urgencies) {
      insertTicket(make({ urgency, escalated: urgency !== 'Low' }));
    }
    insertTicket(make({ urgency: 'Critical', escalated: true, resolved: true }));

    const triage = listTickets({ sort: 'triage' });
    expect(triage.map((t) => t.urgency)).toEqual([
      'Critical',
      'High',
      'Medium',
      'Low',
      'Critical', // resolved, so it sinks to the bottom
    ]);
    expect(triage[4].resolved).toBe(true);

    // The default order is still newest first, for the API and analytics.
    expect(listTickets().map((t) => t.resolved)).toEqual([true, false, false, false, false]);
  });
});
