import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClient } from '../lib/claude';
import { clearTickets, useMemoryDb } from '../lib/db';
import { detectPidgin } from '../lib/pidgin';
import { withoutDashes } from '../lib/prose';
import { CLASSIFY_SYSTEM, buildClassifyPrompt, runTriage } from '../lib/triage';
import type { ClassificationWire } from '../lib/types';

function stubClient(reply: string) {
  const turn: ClassificationWire = {
    reply,
    category: 'Delivery',
    intent: 'check_delivery_fee',
    sentiment: 'Neutral',
    urgency: 'Low',
    confidence: 90,
    kbSources: ['KB-01'],
    entities: { orderRef: null, amount: null, email: null },
    needsOrderLookup: false,
    summary: 'Delivery fee quoted.',
    attachmentSummary: null,
  };
  const stub = {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: JSON.stringify(turn) }],
        usage: { input_tokens: 10, output_tokens: 10 },
        stop_reason: 'end_turn',
      }),
    },
  };
  setClient(stub as unknown as Anthropic);
}

beforeEach(async () => {
  useMemoryDb();
  await clearTickets();
});
afterEach(() => setClient(null));

describe('no em dashes in what the customer reads', () => {
  it('replaces them with a hyphen, keeping the sentence grammatical', () => {
    expect(withoutDashes('Delivery is free — no minimum applies.')).toBe(
      'Delivery is free - no minimum applies.',
    );
    expect(withoutDashes('Lagos–Abuja routes')).toBe('Lagos - Abuja routes');
  });

  it('leaves ranges and ordinary hyphens alone', () => {
    const text = 'Card refunds take 5-10 business days, and NX-482913 is pay-on-delivery.';
    expect(withoutDashes(text)).toBe(text);
  });

  it('does not leave a space before punctuation', () => {
    expect(withoutDashes('It is free—, really')).not.toContain(' ,');
  });

  /*
   * Asked for in the prompt AND enforced on the way out. A prompt rule is a
   * request, and this is the most recognisable tell that a support reply was
   * written by a machine.
   */
  it('strips a dash the model produced anyway', async () => {
    stubClient('Delivery to Lagos is ₦2,500 — and free above ₦75,000.');
    const { answer, ticket } = await runTriage('How much is delivery to Lagos?', 'conv-dash');
    expect(answer).not.toMatch(/[—–]/);
    expect(ticket.reply).not.toMatch(/[—–]/);
  });

  it('tells the model as well, rather than relying only on the cleanup', () => {
    expect(CLASSIFY_SYSTEM).toContain('Never use an em dash');
  });
});

describe('Nigerian Pidgin', () => {
  it.each([
    'Abeg, wetin dey happen with NX-517044?',
    'I wan talk to person',
    'How far, my order never reach',
    'My package never come, e don tey',
    'Dem charge me twice o',
    'Shey I fit pay when e reach?',
    'Abeg I no sabi wetin dey happen',
  ])('recognises: %s', (message) => {
    expect(detectPidgin(message).isPidgin).toBe(true);
  });

  /*
   * The costs are not symmetric. A false positive answers a formal English
   * complaint in Pidgin, which reads as mockery; a false negative just means a
   * Pidgin speaker gets a clear English answer. So the bar sits where the
   * errors are cheap, and these are the cases that set it.
   */
  it.each([
    'How much is delivery to Port Harcourt?',
    "I don't want to wait any longer",
    'How far is it from Lagos to Ibadan?',
    'How far to my address?',
    'I fit my order into one box',
    'My parcel never arrived and I have never had this problem before',
    'I want to speak to a person',
    'My blender is faulty three weeks after delivery. Is it under warranty?',
  ])('does not mistake English for Pidgin: %s', (message) => {
    expect(detectPidgin(message).isPidgin).toBe(false);
  });

  it('explains itself, so a wrong call can be diagnosed', () => {
    expect(detectPidgin('Abeg, wetin dey happen?').markers).toContain('abeg');
  });

  it('tells the model which language to answer in', () => {
    const pidgin = buildClassifyPrompt('Abeg wetin dey happen', [], false, undefined, null, null, false, true);
    expect(pidgin).toContain('wrote in Nigerian Pidgin');

    const english = buildClassifyPrompt('How much is delivery?', [], false);
    expect(english).not.toContain('<style>');
  });

  it('keeps the grounding rules identical in either language', () => {
    // The failure this guards against is a Pidgin reply that rounds ₦3,500 to
    // "around three thousand" because it feels more natural to say.
    expect(CLASSIFY_SYSTEM).toContain('₦3,500 stays ₦3,500');
    expect(CLASSIFY_SYSTEM).toContain('Never switch to Pidgin when the customer wrote standard English');
  });
});
