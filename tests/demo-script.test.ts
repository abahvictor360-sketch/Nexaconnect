import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClient } from '../lib/claude';
import { clearTickets, useMemoryDb } from '../lib/db';
import { evaluateEscalation } from '../lib/escalation';
import { answerOffline } from '../lib/offline-responder';
import { extractMalformedOrderRef, retrieve } from '../lib/retrieval';
import { CLASSIFY_SYSTEM, runTriage } from '../lib/triage';
import type { ClassificationWire } from '../lib/types';

/**
 * The three messages from the recorded walkthrough, pinned so the demo cannot
 * silently stop behaving the way it is narrated. Each asserts the claim the
 * narration actually makes, not a weaker one.
 */
const ROUTINE =
  'How long do I have to return a phone case? I changed my mind about the colour.';
const ESCALATION =
  "I was charged TWICE for order NX-90113. Over ₦240,000 gone from my account. " +
  "This is theft and if it's not fixed today I'm going to my bank and to the NDPC.";
const REFUSAL = 'Can I use my NexaWallet balance and a card together on one order?';

function stubClient(turns: unknown[]) {
  const prompts: string[] = [];
  let call = 0;
  const stub = {
    messages: {
      create: async (params: { messages: { content: string }[] }) => {
        prompts.push(params.messages.map((m) => m.content).join('\n'));
        return {
          content: [{ type: 'text', text: JSON.stringify(turns[Math.min(call++, turns.length - 1)]) }],
          usage: { input_tokens: 100, output_tokens: 50 },
          stop_reason: 'end_turn',
        };
      },
    },
  };
  setClient(stub as unknown as Anthropic);
  return { prompts, calls: () => call };
}

const BASE: ClassificationWire = {
  reply: 'r',
  category: 'Returns' as never,
  intent: 'check_return_window',
  sentiment: 'Neutral',
  urgency: 'Low',
  confidence: 90,
  kbSources: ['KB-03'],
  entities: { orderRef: null, amount: null, email: null },
  needsOrderLookup: false,
  summary: 's',
  attachmentSummary: null,
};

beforeEach(async () => {
  useMemoryDb();
  await clearTickets();
});
afterEach(() => setClient(null));

describe('0:45 — the routine enquiry is answerable', () => {
  it('retrieves the returns section, with the lines the narration quotes', () => {
    const chunks = retrieve(ROUTINE, 4).chunks;
    expect(chunks.map((c) => c.id)).toContain('KB-03');

    const returns = chunks.find((c) => c.id === 'KB-03')!.text;
    // The three facts the walkthrough names out loud.
    expect(returns).toContain('14 calendar days');
    expect(returns).toContain('unused and in their original packaging');
    // ₦2,500 within Lagos and ₦3,500 elsewhere — NOT ₦2,000, and it is return
    // shipping rather than a pickup fee. The narration has to match the policy.
    expect(returns).toContain('₦2,500 within Lagos and ₦3,500 elsewhere');
  });

  it('does not escalate when the model answers it confidently', async () => {
    stubClient([{ ...BASE, category: 'Other', kbSources: ['KB-03'], confidence: 90 }]);
    const { ticket } = await runTriage(ROUTINE, 'conv-routine');
    expect(ticket.escalated).toBe(false);
    expect(ticket.kbSources).toContain('KB-03');
  });

  /*
   * Worth knowing before recording: the deterministic fallback abstains on this
   * one. Its coverage rule is strict on purpose — "phone case" and "colour"
   * appear nowhere in the policy lines — so with no API key the first demo step
   * hands off instead of answering. The walkthrough must run against the model.
   */
  it('abstains in offline mode, so the demo needs the API key', () => {
    const offline = answerOffline(ROUTINE, retrieve(ROUTINE, 4).chunks, false);
    expect(offline.classification.confidence).toBeLessThanOrEqual(30);
    expect(offline.classification.kbSources).toEqual([]);
  });
});

describe('1:30 — the escalation', () => {
  const angry: ClassificationWire = {
    ...BASE,
    category: 'Payment',
    intent: 'dispute_double_charge',
    sentiment: 'Angry',
    urgency: 'Critical',
    confidence: 35,
    kbSources: ['KB-05'],
    entities: { orderRef: null, amount: '₦240,000', email: null },
    needsOrderLookup: true,
  };

  it('fires fraud, legal and hostile — and routes to the Escalations Manager', async () => {
    const decision = evaluateEscalation({
      message: ESCALATION,
      classification: { ...angry, kbSources: ['KB-05'] } as never,
      contactCount: 1,
      orderRef: null,
      orderValue: null,
    });

    const ids = decision.firedRules.map((r) => r.id);
    expect(ids).toContain('FRAUD');
    expect(ids).toContain('LEGAL');
    expect(ids).toContain('HOSTILE');
    expect(decision.urgency).toBe('Critical');

    /*
     * NOT the Payments & Fraud Desk. A regulator threat outranks a payment
     * dispute: KB-09 sends legal, regulator and media contact to the
     * Escalations Manager with a one-hour first response, against Payments'
     * two. The rule engine's precedence encodes that, and the narration has to
     * follow the screen rather than the other way round.
     */
    expect(decision.route).toBe('Escalations Manager');
    expect(decision.slaHours).toBe(1);
  });

  it('does not fire HIGH_VALUE: ₦240,000 is under the ₦500,000 threshold', () => {
    const decision = evaluateEscalation({
      message: ESCALATION,
      classification: angry as never,
      contactCount: 1,
      orderRef: null,
      orderValue: null,
    });
    expect(decision.firedRules.map((r) => r.id)).not.toContain('HIGH_VALUE');
  });

  /*
   * NX-90113 is five digits. Real references are NX plus six. It used to be
   * dropped in silence: the case stored no reference at all and the assistant
   * never mentioned the mismatch, so the customer would reasonably believe
   * their order had been looked up.
   */
  it('recognises the mistyped reference instead of ignoring it', async () => {
    expect(extractMalformedOrderRef(ESCALATION)).toBe('NX-90113');

    const { prompts } = stubClient([angry]);
    const { ticket } = await runTriage(ESCALATION, 'conv-esc');

    expect(prompts[0]).toContain('NX-90113');
    expect(prompts[0]).toContain('not a valid NexaConnect reference');
    expect(ticket.groundingNote).toContain('NX-90113');
    // An answer that could not be grounded in a real order is not confident.
    expect(ticket.confidence).toBeLessThanOrEqual(40);
    expect(ticket.escalated).toBe(true);
  });
});

describe('2:30 — it refuses what the policy does not cover', () => {
  it('has no line anywhere about combining two payment methods', () => {
    // The premise of the demo step. If someone adds such a line to the policy,
    // this test fails and the walkthrough needs rewriting.
    const all = retrieve(REFUSAL, 9).chunks.map((c) => c.text).join('\n').toLowerCase();
    expect(all).not.toMatch(/split payment|part-pay|partially pay|combine .{0,20}payment/);
    expect(all).not.toMatch(/wallet .{0,30}(and|plus|with) .{0,20}card/);
  });

  it('escalates on low confidence rather than answering', async () => {
    stubClient([
      {
        ...BASE,
        category: 'Payment',
        intent: 'check_split_payment',
        confidence: 35,
        kbSources: [],
        reply: 'Our published policies do not cover paying with a wallet balance and a card together.',
      },
    ]);
    const { ticket, notice } = await runTriage(REFUSAL, 'conv-refuse');

    expect(ticket.escalated).toBe(true);
    expect(ticket.firedRules.map((r) => r.id)).toContain('LOW_CONFIDENCE');
    expect(notice).toContain('passing this to');
  });

  it('instructs the model that an enumeration is not permission to combine', () => {
    // KB-05 lists the wallet and cards as accepted methods. The failure mode is
    // reasoning from "both accepted" to "both usable together" — a confident
    // wrong answer, which is exactly what this demo step claims not to do.
    expect(CLASSIFY_SYSTEM).toContain('silence is not permission');
    expect(CLASSIFY_SYSTEM).toContain('not evidence for');
  });
});
