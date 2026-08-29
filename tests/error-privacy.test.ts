import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '../app/api/enquiry/route';
import { setClient } from '../lib/claude';
import { setStore, useMemoryDb, type TicketStore } from '../lib/db';
import { SchemaOutOfDateError } from '../lib/db/supabase';

/**
 * Errors reach a customer inside a support chat, so they are product copy.
 *
 * Found in a screenshot of the deployed app: a customer asking about delivery
 * was shown "PostgREST said: Could not find the 'attachment_note' column of
 * 'tickets' in the schema cache", plus the path to the repo's migrations
 * folder. Every word of that is for the operator. It named internal table and
 * column names, the database technology and the repository layout — to whoever
 * happened to be using the chat.
 *
 * The detail still exists, in the server log where an operator can act on it,
 * alongside a short machine-readable `code`.
 */
function throwingStore(error: unknown): TicketStore {
  const boom = async () => {
    throw error;
  };
  return {
    driver: 'supabase',
    insertTicket: boom as TicketStore['insertTicket'],
    getTicket: boom as TicketStore['getTicket'],
    listTickets: boom as TicketStore['listTickets'],
    updateTicket: boom as TicketStore['updateTicket'],
    contactCountForOrder: async () => 1,
    conversationHistory: async () => [],
    clearTickets: boom as TicketStore['clearTickets'],
  };
}

function request(message: string) {
  return new Request('http://localhost/api/enquiry', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, conversationId: 'conv-err' }),
  });
}

/** Anything a customer must never be shown in a support chat. */
const INTERNALS = [
  /postgrest/i,
  /schema cache/i,
  /supabase\/migrations/i,
  /\btickets\b.*\bcolumn\b/i,
  /attachment_note/,
  /ANTHROPIC_API_KEY/,
  /\bstack\b/i,
  /node_modules/,
];

beforeEach(() => {
  useMemoryDb();
  setClient(null); // offline responder, so the failure is the database one
});

afterEach(() => {
  setStore(null);
  setClient(null);
});

describe('customer-facing errors leak nothing internal', () => {
  it('says the database is behind without naming the column, the table or PostgREST', async () => {
    setStore(
      throwingStore(
        new SchemaOutOfDateError(
          'attachment_note',
          "Could not find the 'attachment_note' column of 'tickets' in the schema cache",
        ),
      ),
    );

    const response = await POST(request('Do I get free delivery if I spend ₦80,000?'));
    const body = await response.json();

    expect(response.status).toBe(503);
    for (const pattern of INTERNALS) {
      expect(body.error, `leaked ${pattern}`).not.toMatch(pattern);
    }
    // Still useful to the person reading it: what happened, and what to do.
    expect(body.error).toMatch(/try again/i);
    expect(body.error).toMatch(/person|colleague/i);
    // And still diagnosable by an operator, without prose.
    expect(body.code).toBe('DB_SCHEMA');
  });

  it('keeps an unexpected failure generic rather than echoing the throw', async () => {
    setStore(throwingStore(new Error('connect ECONNREFUSED 10.0.0.4:5432 at /app/node_modules/pg')));

    const response = await POST(request('How much is delivery to Port Harcourt?'));
    const body = await response.json();

    expect(response.status).toBe(500);
    for (const pattern of INTERNALS) {
      expect(body.error, `leaked ${pattern}`).not.toMatch(pattern);
    }
    expect(body.error).not.toContain('ECONNREFUSED');
    expect(body.error).not.toContain('10.0.0.4');
    expect(body.code).toBe('UNEXPECTED');
  });

  it('offers a way forward in every customer-facing failure', async () => {
    for (const error of [
      new SchemaOutOfDateError('user_id', 'nope'),
      new Error('anything at all'),
    ]) {
      setStore(throwingStore(error));
      const body = await (await POST(request('Can I pay on delivery in Kano?'))).json();
      // A dead end in a support chat is a failure of its own.
      expect(body.error).toMatch(/try again|person|colleague/i);
    }
  });
});
