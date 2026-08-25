import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClient } from '../lib/claude';
import { clearTickets, listTickets, useMemoryDb } from '../lib/db';
import { runTriage } from '../lib/triage';
import { initialsOf, type Viewer } from '../lib/viewer';
import {
  AttachmentSchema,
  EnquiryRequestSchema,
  MAX_ATTACHMENT_BYTES,
  type ClassificationWire,
} from '../lib/types';

/** Scripted stub, one turn per Claude call, capturing what was sent. */
function stubClient(turns: unknown[]) {
  const sent: unknown[] = [];
  let call = 0;
  const stub = {
    messages: {
      parse: async (params: { messages: { content: unknown }[] }) => {
        sent.push(params.messages[0]?.content);
        return {
          content: [],
          usage: { input_tokens: 100, output_tokens: 50 },
          parsed_output: turns[Math.min(call++, turns.length - 1)],
        };
      },
    },
  };
  setClient(stub as unknown as Anthropic);
  return { sent };
}

const BASE: ClassificationWire = {
  reply: 'Thanks for the photo.',
  category: 'Complaint',
  intent: 'report_issue',
  sentiment: 'Neutral',
  urgency: 'Medium',
  confidence: 85,
  kbSources: ['KB-06'],
  entities: { orderRef: null, amount: null, email: null },
  needsOrderLookup: false,
  summary: 'Customer reported an issue with a photo.',
  attachmentSummary: null,
};

const PNG = 'iVBORw0KGgoAAAANSUhEUg=='; // not a real image, just base64 bytes

beforeEach(async () => {
  useMemoryDb();
  await clearTickets();
});
afterEach(() => setClient(null));

/* ------------------------------------------------------------------ */

describe('attachment validation', () => {
  it('accepts a whitelisted image type as raw base64', () => {
    expect(AttachmentSchema.safeParse({ mediaType: 'image/png', data: PNG }).success).toBe(true);
  });

  it('rejects a media type that is not an image we support', () => {
    expect(
      AttachmentSchema.safeParse({ mediaType: 'application/pdf', data: PNG }).success,
    ).toBe(false);
    expect(AttachmentSchema.safeParse({ mediaType: 'image/svg+xml', data: PNG }).success).toBe(
      false,
    );
  });

  it('rejects a data URL, which would corrupt the base64 payload', () => {
    const result = AttachmentSchema.safeParse({
      mediaType: 'image/png',
      data: `data:image/png;base64,${PNG}`,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an image over the size cap', () => {
    const tooBig = 'A'.repeat(Math.ceil((MAX_ATTACHMENT_BYTES + 1024) * 4) / 3);
    const result = AttachmentSchema.safeParse({ mediaType: 'image/jpeg', data: tooBig });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('4 MB');
    }
  });

  it('is optional on an enquiry', () => {
    expect(EnquiryRequestSchema.safeParse({ message: 'hello' }).success).toBe(true);
  });
});

describe('the pipeline with an image attached', () => {
  it('sends the image to the model as a content block alongside the prompt', async () => {
    const { sent } = stubClient([{ ...BASE, attachmentSummary: 'A scorched wall socket.' }]);

    await runTriage('Look at this', undefined, undefined, {
      mediaType: 'image/png',
      data: PNG,
    });

    const content = sent[0] as { type: string; source?: { media_type: string; data: string } }[];
    expect(Array.isArray(content)).toBe(true);
    expect(content[0].type).toBe('image');
    expect(content[0].source?.media_type).toBe('image/png');
    expect(content[0].source?.data).toBe(PNG);
    expect(content[1].type).toBe('text');
  });

  it('sends plain text when nothing is attached', async () => {
    const { sent } = stubClient([BASE]);
    await runTriage('How much is delivery to Abuja?');
    expect(typeof sent[0]).toBe('string');
  });

  it('records what the image showed, and that the image itself is not kept', async () => {
    stubClient([{ ...BASE, attachmentSummary: 'A scorched wall socket beside a melted plug.' }]);

    const { ticket } = await runTriage('Look at this', undefined, undefined, {
      mediaType: 'image/jpeg',
      data: PNG,
    });

    expect(ticket.hasAttachment).toBe(true);
    expect(ticket.attachmentNote).toContain('scorched wall socket');
    expect(ticket.groundingNote).toContain('Customer attached an image');
    // The bytes are deliberately absent from the record.
    expect(JSON.stringify(ticket)).not.toContain(PNG);
  });

  it('escalates on what the image shows, even when the message says nothing', async () => {
    // The customer types four neutral words; the photo is the whole report.
    stubClient([
      {
        ...BASE,
        attachmentSummary: 'The plug has burnt and there is smoke damage on the wall.',
      },
    ]);

    const { ticket } = await runTriage('please look', undefined, undefined, {
      mediaType: 'image/png',
      data: PNG,
    });

    expect(ticket.firedRules.map((rule) => rule.id)).toContain('SAFETY');
    expect(ticket.urgency).toBe('Critical');
    expect(ticket.route).toBe('Escalations Manager');
    // The stored message stays the customer's own words.
    expect(ticket.message).toBe('please look');
  });

  it('escalates an image the model could not read rather than guessing', async () => {
    stubClient([{ ...BASE, confidence: 95, attachmentSummary: null }]);

    const { ticket } = await runTriage('is this right?', undefined, undefined, {
      mediaType: 'image/png',
      data: PNG,
    });

    expect(ticket.confidence).toBeLessThanOrEqual(40);
    expect(ticket.firedRules.map((rule) => rule.id)).toContain('LOW_CONFIDENCE');
    expect(ticket.escalated).toBe(true);
    expect(ticket.groundingNote).toContain('could not be read');
  });

  it('says plainly that it cannot look at images with no model configured', async () => {
    setClient(null); // offline path
    const { ticket, mode } = await runTriage('what is this', undefined, undefined, {
      mediaType: 'image/png',
      data: PNG,
    });

    expect(mode).toBe('offline');
    expect(ticket.reply).toContain('cannot look at it');
    expect(ticket.escalated).toBe(true);
    expect(ticket.hasAttachment).toBe(true);
  });
});

describe('customer identity on a ticket', () => {
  it('stamps the signed-in customer, and scopes a listing to them', async () => {
    stubClient([BASE]);
    await runTriage('question one', 'conv-a', {
      userId: 'user-1',
      email: 'ada@example.ng',
    });
    stubClient([BASE]);
    await runTriage('question two', 'conv-b', { userId: 'user-2', email: 'bola@example.ng' });
    stubClient([BASE]);
    await runTriage('a guest question');

    const mine = await listTickets({ userId: 'user-1' });
    expect(mine).toHaveLength(1);
    expect(mine[0].message).toBe('question one');
    expect(mine[0].customerEmail).toBe('ada@example.ng');

    expect(await listTickets({ userId: 'user-2' })).toHaveLength(1);
    expect(await listTickets()).toHaveLength(3);
  });

  it('leaves a guest ticket unattributed rather than inventing an owner', async () => {
    stubClient([BASE]);
    const { ticket } = await runTriage('a guest question');
    expect(ticket.userId).toBeNull();
    expect(ticket.customerEmail).toBeNull();
  });
});

describe('initialsOf', () => {
  const viewer = (overrides: Partial<Viewer> = {}): Viewer => ({
    authEnabled: true,
    signedIn: true,
    id: 'u',
    email: null,
    role: 'customer',
    displayName: 'Guest',
    ...overrides,
  });

  it.each([
    ['ada.okonkwo@nexaconnect.ng', 'AO'],
    ['bola@example.com', 'B'],
    ['chi-oma@example.com', 'CO'],
    ['tunde_adeyemi@example.com', 'TA'],
  ])('derives initials from %s', (email, expected) => {
    expect(initialsOf(viewer({ email }))).toBe(expected);
  });

  it('falls back to the display name when there is no email', () => {
    expect(initialsOf(viewer({ email: null, displayName: 'Guest' }))).toBe('G');
  });
});
