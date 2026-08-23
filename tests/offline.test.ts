import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClient } from '../lib/claude';
import { clearTickets, useMemoryDb } from '../lib/db';
import { answerOffline } from '../lib/offline-responder';
import { loadKnowledgeBase, retrieve } from '../lib/retrieval';
import { runTriage } from '../lib/triage';

const KB_TEXT = loadKnowledgeBase()
  .map((chunk) => chunk.text)
  .join('\n');

function answer(message: string) {
  return answerOffline(message, retrieve(message, 4).chunks);
}

beforeEach(() => {
  useMemoryDb();
  clearTickets();
  // No client set and no key in the environment: the offline path is live.
  setClient(null);
});
afterEach(() => setClient(null));

describe('the offline responder quotes, it does not compose', () => {
  it('answers a delivery fee question with the policy line verbatim', () => {
    const { classification } = answer('How much is delivery to Port Harcourt?');
    expect(classification.kbSources).toContain('KB-01');
    expect(classification.reply).toContain('₦3,500');

    // Every quoted bullet must appear verbatim in the knowledge base.
    for (const line of classification.reply.split('\n').filter((l) => l.startsWith('• '))) {
      expect(KB_TEXT).toContain(line.slice(2).trim());
    }
  });

  it.each([
    'Can I return an opened bottle of perfume?',
    'Is pay on delivery available in Abuja?',
    'How long does a card refund take?',
    'What warranty comes with a laptop?',
    'How do I delete my account and my data?',
  ])('quotes only real knowledge base lines for: %s', (message) => {
    const { classification } = answer(message);
    for (const line of classification.reply.split('\n').filter((l) => l.startsWith('• '))) {
      expect(KB_TEXT).toContain(line.slice(2).trim());
    }
  });

  it('refuses to answer something the knowledge base does not cover', () => {
    const { classification } = answer('What is the capital of Australia?');
    expect(classification.kbSources).toEqual([]);
    expect(classification.reply).toContain('not covered by our published policies');
    expect(classification.confidence).toBeLessThan(60);
  });

  it('never claims the confidence the model would', () => {
    const { classification } = answer('How much is delivery to Port Harcourt?');
    expect(classification.confidence).toBeLessThanOrEqual(70);
  });

  it('copies a real order status off the record and invents nothing for an unknown one', () => {
    const found = answer('Where is my order NX-482913?');
    expect(found.classification.reply).toContain('Ikeja hub');
    expect(found.classification.entities.orderRef).toBe('NX-482913');

    const missing = answer('Where is my order NX-999888?');
    // Only the order sentence matters here: a quoted policy line may legitimately
    // contain words like "dispatched", but the order itself gets no status.
    const orderSentence = missing.classification.reply
      .split('\n')
      .find((line) => line.includes('NX-999888'))!;
    expect(orderSentence).toContain('could not find an order');
    expect(orderSentence).not.toMatch(/in transit|delivered|out for delivery/i);
  });

  it('never cites a section that retrieval did not return', () => {
    for (const message of [
      'How much is delivery to Port Harcourt?',
      'Can I cancel my order before it ships?',
      'What warranty comes with a laptop?',
      'How long does a card refund take?',
    ]) {
      const offered = new Set(retrieve(message, 4).chunks.map((chunk) => chunk.id));
      for (const cited of answer(message).classification.kbSources) {
        expect(offered.has(cited)).toBe(true);
      }
    }
  });

  it('cites the section each quoted line actually came from', () => {
    const chunks = loadKnowledgeBase();
    for (const message of [
      'How long does a card refund take?',
      'Will my promo code work on the delivery fee?',
      'How do I delete my account and my data?',
    ]) {
      const { classification } = answer(message);
      const quoted = classification.reply
        .split('\n')
        .filter((line) => line.startsWith('• '))
        .map((line) => line.slice(2).trim());

      for (const line of quoted) {
        const owner = chunks.find((chunk) => chunk.text.includes(line))!;
        expect(classification.kbSources).toContain(owner.id);
      }
    }
  });

  it('abstains rather than stretching a loosely related line', () => {
    // "sell" appears in KB-07's line about not selling customer data. Matching
    // on that one common word must not become an answer about livestock.
    const { classification } = answer('Do you sell live goats for Sallah?');
    expect(classification.kbSources).toEqual([]);
    expect(classification.confidence).toBeLessThan(60);
  });

  it('says plainly that it is the fallback, so the mode is never hidden', () => {
    expect(answer('anything').note).toContain('offline demo mode');
  });
});

describe('the pipeline in offline mode', () => {
  it('still applies the real escalation engine and records the mode', async () => {
    const { ticket, mode } = await runTriage('I have been charged twice for order NX-336208');

    expect(mode).toBe('offline');
    expect(ticket.firedRules.map((rule) => rule.id)).toContain('FRAUD');
    expect(ticket.route).toBe('Payments & Fraud Desk');
    expect(ticket.slaHours).toBe(2);
    expect(ticket.groundingNote).toContain('offline demo mode');
  });

  it('escalates a safety report at Critical urgency without a model', async () => {
    const { ticket } = await runTriage(
      'The generator from NX-193627 caught fire and burnt the socket',
    );
    expect(ticket.urgency).toBe('Critical');
    expect(ticket.route).toBe('Escalations Manager');
    expect(ticket.firedRules.map((rule) => rule.id)).toContain('SAFETY');
  });

  it('escalates an ungrounded question', async () => {
    const { ticket } = await runTriage('Do you sell live goats for Sallah?');
    expect(ticket.escalated).toBe(true);
    expect(ticket.firedRules.map((rule) => rule.id)).toContain('LOW_CONFIDENCE');
  });

  it('makes no second call for an order lookup, since there is nothing to rewrite', async () => {
    const { lookup } = await runTriage('Where is my order NX-482913?');
    expect(lookup.found).toBe(true);
    expect(lookup.rewritten).toBe(false);
  });
});
