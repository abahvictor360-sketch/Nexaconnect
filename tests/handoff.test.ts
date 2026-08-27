import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClient } from '../lib/claude';
import { clearTickets, updateTicket, useMemoryDb } from '../lib/db';
import { requestHuman, runTriage } from '../lib/triage';
import type { ClassificationWire } from '../lib/types';

/** Counts calls so the "no model call" claim is enforced, not just asserted. */
function stubClient(turns: unknown[]) {
  let call = 0;
  const stub = {
    messages: {
      create: async () => {
        const turn = turns[Math.min(call++, turns.length - 1)];
        return {
          content: [{ type: 'text', text: JSON.stringify(turn) }],
          usage: { input_tokens: 100, output_tokens: 50 },
          stop_reason: 'end_turn',
        };
      },
    },
  };
  setClient(stub as unknown as Anthropic);
  return () => call;
}

const PAYMENT_CASE: ClassificationWire = {
  reply: 'I can see two debits on that order.',
  category: 'Payment',
  intent: 'dispute_double_charge',
  sentiment: 'Frustrated',
  urgency: 'High',
  confidence: 70,
  kbSources: ['KB-05'],
  entities: { orderRef: 'NX-336208', amount: null, email: null },
  needsOrderLookup: true,
  summary: 'Double charge reported.',
  attachmentSummary: null,
};

beforeEach(async () => {
  useMemoryDb();
  await clearTickets();
});

afterEach(() => setClient(null));

describe('transfer to a person', () => {
  it('needs no model call at all', async () => {
    const calls = stubClient([]);
    const result = await requestHuman({ conversationId: 'conv-x' });

    // The escape hatch has to work when the model is the thing that is broken.
    expect(calls()).toBe(0);
    expect(result.ticket.escalated).toBe(true);
    expect(result.ticket.route).toBe('Customer Care');
  });

  it('works with no API key configured', async () => {
    setClient(null);
    const result = await requestHuman({ conversationId: 'conv-offline' });
    expect(result.ticket.escalated).toBe(true);
  });

  it('records HUMAN_REQUESTED as the reason, so the transfer is explainable', async () => {
    const { ticket } = await requestHuman({ conversationId: 'conv-y' });
    const ids = ticket.firedRules.map((r) => r.id);
    expect(ids).toContain('HUMAN_REQUESTED');
    expect(ticket.firedRules.find((r) => r.id === 'HUMAN_REQUESTED')?.evidence).toBeTruthy();
    expect(ticket.intent).toBe('request_human_agent');
  });

  /*
   * KB-09: "a customer who explicitly asks to speak to a person is always
   * routed to a human, and the assistant does not ask them to explain the
   * problem again first." Carrying the desk over from the conversation is what
   * makes that true in practice — someone who has already described a double
   * charge reaches Payments without retyping it.
   */
  it('routes to the desk the conversation was already about', async () => {
    // Answered fine, nothing escalated — the customer simply wants a person
    // anyway. The desk still comes from what they were already discussing.
    stubClient([
      {
        ...PAYMENT_CASE,
        reply: 'Pay-on-delivery is available in Lagos, Abuja and Port Harcourt.',
        intent: 'check_payment_method',
        sentiment: 'Neutral',
        urgency: 'Low',
        confidence: 92,
        needsOrderLookup: false,
        entities: { orderRef: null, amount: null, email: null },
      },
    ]);
    const answered = await runTriage('Can I pay on delivery in Kano?', 'conv-z');
    expect(answered.ticket.escalated).toBe(false);

    const { ticket, desk, slaHours, alreadyQueued } = await requestHuman({
      conversationId: 'conv-z',
    });
    expect(alreadyQueued).toBe(false);
    expect(desk).toBe('Payments & Fraud Desk');
    expect(slaHours).toBe(2);
    expect(ticket.category).toBe('Payment');
    expect(ticket.groundingNote).toContain('Desk chosen from');
  });

  it('falls back to Customer Care when there is no prior case', async () => {
    const { desk, slaHours, ticket } = await requestHuman({ conversationId: 'conv-fresh' });
    expect(desk).toBe('Customer Care');
    expect(slaHours).toBe(6);
    expect(ticket.groundingNote).toContain('no prior case');
  });

  it('does not require the customer to say why', async () => {
    const { ticket } = await requestHuman({ conversationId: 'conv-quiet' });
    expect(ticket.message).toBe('[Customer asked to talk to a person]');
    expect(ticket.summary).toBe('Customer asked for a person.');
  });

  it('keeps the reason when one is given, without inventing one when it is not', async () => {
    const { ticket } = await requestHuman({
      conversationId: 'conv-reason',
      reason: 'The answer did not match what the driver told me',
    });
    expect(ticket.message).toContain('The answer did not match what the driver told me');
    expect(ticket.summary).toContain('The answer did not match what the driver told me');
  });

  it('reports zero confidence rather than a made-up score', async () => {
    // The assistant is not answering this one, so it has no confidence in an
    // answer. A number here would be meaningless in the analytics.
    const { ticket } = await requestHuman({ conversationId: 'conv-conf' });
    expect(ticket.confidence).toBe(0);
    expect(ticket.retrievedChunks).toEqual([]);
  });

  it('tells the customer the desk and the SLA, and nothing it cannot promise', async () => {
    const { notice } = await requestHuman({ conversationId: 'conv-notice' });
    expect(notice).toContain('put through to a person');
    expect(notice).toContain('customer care');
    expect(notice).toContain('6 hours');
    // Opening hours are a real constraint and the customer is told about them.
    expect(notice).toContain('08:00-20:00');
  });

  it('links the transfer to the signed-in customer when there is one', async () => {
    const { ticket } = await requestHuman({
      conversationId: 'conv-user',
      requester: { userId: 'user-1', email: 'ada@example.ng' },
    });
    expect(ticket.userId).toBe('user-1');
    expect(ticket.customerEmail).toBe('ada@example.ng');
  });
});

/*
 * Pressing the button when the case is already escalated must not open a second
 * one. It would double-count in the agent's queue and in the escalation-rate
 * metric, and the customer would see two identical "connecting you with
 * Customer Care" cards — which reads as a bug, because it is one.
 */
describe('a customer already in the queue', () => {
  it('is told where they are instead of getting a second case', async () => {
    stubClient([{ ...PAYMENT_CASE, confidence: 20 }]);
    const first = await runTriage('I was charged twice for NX-336208', 'conv-dup');
    expect(first.ticket.escalated).toBe(true);

    const again = await requestHuman({ conversationId: 'conv-dup' });
    expect(again.alreadyQueued).toBe(true);
    expect(again.ticket.id).toBe(first.ticket.id);
    expect(again.notice).toContain('already in the queue');
    expect(again.notice).toContain('Payments');
  });

  it('opens a fresh case once the earlier one is resolved', async () => {
    stubClient([{ ...PAYMENT_CASE, confidence: 20 }]);
    const first = await runTriage('I was charged twice for NX-336208', 'conv-reopen');
    await updateTicket(first.ticket.id, { resolved: true, resolutionNote: 'sorted' });

    const again = await requestHuman({ conversationId: 'conv-reopen' });
    expect(again.alreadyQueued).toBe(false);
    expect(again.ticket.id).not.toBe(first.ticket.id);
  });

  it('does not treat an unescalated answer as a queue', async () => {
    stubClient([{ ...PAYMENT_CASE, category: 'Delivery', urgency: 'Low', confidence: 90 }]);
    const first = await runTriage('How much is delivery to Port Harcourt?', 'conv-ok');
    expect(first.ticket.escalated).toBe(false);

    const again = await requestHuman({ conversationId: 'conv-ok' });
    expect(again.alreadyQueued).toBe(false);
  });
});
