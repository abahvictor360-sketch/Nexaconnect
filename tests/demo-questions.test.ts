import { describe, expect, it } from 'vitest';
import demo from '../data/demo-questions.json';
import { evaluateEscalation } from '../lib/escalation';
import { answerOffline } from '../lib/offline-responder';
import { findOrder } from '../lib/orders';
import { extractOrderRef, retrieve } from '../lib/retrieval';

/**
 * The suggestion menu is a promise: every question it offers is one the
 * assistant can actually answer. A question whose policy section never reaches
 * the prompt cannot be answered from the knowledge base, so the assistant would
 * either abstain or invent — and a demo that offers a question it cannot answer
 * is worse than one that offers fewer.
 *
 * The wording is what makes this pass or fail. BM25 matches the policy's own
 * vocabulary, so "my blender stopped working" retrieves nothing from KB-06
 * while "my blender is faulty ... under warranty" retrieves it. That is why
 * these are fixtures under test rather than strings in a component.
 */
const GROUNDED = demo.groups.flatMap((group) =>
  group.questions.map((q) => ({ ...q, group: group.label })),
);

describe('the 20 suggested questions are all answerable', () => {
  it('offers exactly 20, spread across every area of the policy', () => {
    expect(GROUNDED).toHaveLength(20);
    expect(demo.groups.length).toBeGreaterThanOrEqual(5);
    // Every KB section the menu claims to cover.
    const covered = new Set(GROUNDED.flatMap((q) => q.expectKb));
    expect([...covered].sort()).toEqual([
      'KB-01',
      'KB-02',
      'KB-03',
      'KB-04',
      'KB-05',
      'KB-06',
      'KB-07',
      'KB-08',
    ]);
  });

  it.each(GROUNDED.map((q) => [q.q, q] as const))(
    'retrieves the policy section that answers: %s',
    (_label, question) => {
      const result = retrieve(question.q, 4);
      const ids = result.chunks.map((c) => c.id);
      const hit = question.expectKb.some((id) => ids.includes(id));
      // The message names which wording failed, so the fix is obvious.
      expect(hit, `expected one of ${question.expectKb.join('/')}, retrieved ${ids.join(',')}`).toBe(
        true,
      );
      expect(result.hasSignal).toBe(true);
    },
  );

  it('names a real order in every question that quotes one', () => {
    for (const question of GROUNDED) {
      if (!('order' in question) || !question.order) continue;
      // Both that the record exists and that the pipeline's own regex finds it,
      // since that regex is what triggers the single-call fast path.
      expect(findOrder(question.order), `${question.order} is not in orders.json`).not.toBeNull();
      expect(extractOrderRef(question.q)).toBe(question.order);
    }
  });

  it('escalates the two questions that must reach a human', () => {
    const mustEscalate = GROUNDED.filter((q) => 'escalates' in q && q.escalates);
    expect(mustEscalate).toHaveLength(2);

    for (const question of mustEscalate) {
      const chunks = retrieve(question.q, 4).chunks;
      const offline = answerOffline(question.q, chunks, false);
      const decision = evaluateEscalation({
        message: question.q,
        classification: offline.classification,
        contactCount: 1,
        orderRef: extractOrderRef(question.q),
        orderValue: null,
      });
      expect(decision.escalated).toBe(true);
      expect(decision.firedRules.map((r) => r.id)).toContain(question.escalates);
    }
  });
});

/*
 * The out-of-scope scenario. Worth pinning separately, because the obvious
 * assertion is wrong: BM25 always returns its top four, so `hasSignal` is true
 * even for "what is the weather in Lagos" — retrieval finding something is not
 * evidence that the something answers the question. What can be asserted
 * deterministically is that the offline responder refuses to build an answer
 * out of it: no citations, and a confidence low enough that LOW_CONFIDENCE
 * fires and the case reaches a person.
 */
describe('questions the policy does not answer', () => {
  it.each(demo.outOfScope.map((c) => [c.q, c] as const))('abstains on: %s', (_label, item) => {
    const chunks = retrieve(item.q, 4).chunks;
    const offline = answerOffline(item.q, chunks, false);
    const classification = offline.classification;

    expect(classification.kbSources).toEqual([]);
    expect(classification.confidence).toBeLessThanOrEqual(30);
    expect(classification.reply.toLowerCase()).toContain('could not find');

    const decision = evaluateEscalation({
      message: item.q,
      classification,
      contactCount: 1,
      orderRef: null,
      orderValue: null,
    });
    expect(decision.escalated).toBe(true);
    expect(decision.firedRules.map((r) => r.id)).toContain('LOW_CONFIDENCE');
  });

  it('records why each one is unanswerable, so the demo can explain itself', () => {
    for (const item of demo.outOfScope) {
      expect(item.why.length).toBeGreaterThan(30);
    }
  });
});
