import { describe, expect, it } from 'vitest';
import { rowToTicket, sanitiseSearch, supabaseConfigured, type Row } from '../lib/db/supabase';

/**
 * The HTTP path cannot be exercised here — this sandbox's egress policy blocks
 * Supabase hosts — so these tests cover the parts that do not need a network:
 * driver selection, row mapping and the search-filter escaping. The full
 * round trip is covered by `npm run db:check`, which runs against whichever
 * driver the environment selects.
 */
function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'NXC-ABCD1234',
    conversation_id: 'conv-1',
    user_id: null,
    customer_email: null,
    message: 'Where is NX-905117?',
    reply: 'Delivered on 21 August.',
    category: 'Delivery',
    intent: 'track_order',
    sentiment: 'Neutral',
    urgency: 'Medium',
    confidence: 88,
    summary: 'Tracking.',
    kb_sources: ['KB-01'],
    retrieved_chunks: ['KB-01', 'KB-02'],
    entities: { orderRef: 'NX-905117' },
    order_ref: 'NX-905117',
    order_found: true,
    order_status: 'Delivered',
    order_value: 754000,
    contact_count: 2,
    escalated: true,
    fired_rules: [
      { id: 'HIGH_VALUE', description: 'd', evidence: 'e', desk: 'Escalations Manager' },
    ],
    route: 'Escalations Manager',
    sla_hours: 1,
    grounding_note: null,
    has_attachment: false,
    attachment_note: null,
    resolved: false,
    resolution_note: null,
    assigned_to: null,
    satisfaction: null,
    satisfaction_reason: null,
    latency_ms: 2410,
    created_at: '2026-08-23T09:00:00.000Z',
    updated_at: '2026-08-23T09:00:00.000Z',
    ...overrides,
  } as Row;
}

describe('driver selection', () => {
  it('needs both the url and the service role key', () => {
    const saved = { ...process.env };
    try {
      delete process.env.SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      expect(supabaseConfigured()).toBe(false);

      process.env.SUPABASE_URL = 'https://example.supabase.co';
      expect(supabaseConfigured()).toBe(false); // url alone is not enough

      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
      expect(supabaseConfigured()).toBe(true);

      // The public url variable is accepted too, for hosts that only set that.
      delete process.env.SUPABASE_URL;
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      expect(supabaseConfigured()).toBe(true);
    } finally {
      process.env = saved;
    }
  });
});

describe('rowToTicket', () => {
  it('maps a row to the same shape the SQLite driver returns', () => {
    const ticket = rowToTicket(row());
    expect(ticket.id).toBe('NXC-ABCD1234');
    expect(ticket.conversationId).toBe('conv-1');
    expect(ticket.kbSources).toEqual(['KB-01']);
    expect(ticket.entities).toEqual({ orderRef: 'NX-905117' });
    expect(ticket.firedRules[0].id).toBe('HIGH_VALUE');
    expect(ticket.orderValue).toBe(754000);
    expect(ticket.escalated).toBe(true);
    expect(ticket.resolved).toBe(false);
    expect(ticket.satisfaction).toBeNull();
  });

  it('coerces numeric columns, which some Postgres clients return as strings', () => {
    const ticket = rowToTicket(
      row({
        confidence: '88.5' as unknown as number,
        order_value: '754000' as unknown as number,
        sla_hours: '1' as unknown as number,
      }),
    );
    expect(ticket.confidence).toBe(88.5);
    expect(ticket.orderValue).toBe(754000);
    expect(ticket.slaHours).toBe(1);
    expect(typeof ticket.orderValue).toBe('number');
  });

  it('tolerates json columns arriving as strings rather than parsed', () => {
    const ticket = rowToTicket(
      row({
        kb_sources: '["KB-04","KB-05"]' as unknown as string[],
        entities: '{"orderRef":"NX-482913"}' as unknown as object,
        fired_rules: '[]' as unknown as [],
      }),
    );
    expect(ticket.kbSources).toEqual(['KB-04', 'KB-05']);
    expect(ticket.entities).toEqual({ orderRef: 'NX-482913' });
    expect(ticket.firedRules).toEqual([]);
  });

  it('falls back rather than throwing on malformed json', () => {
    const ticket = rowToTicket(
      row({ kb_sources: 'not json' as unknown as string[], entities: '{{' as unknown as object }),
    );
    expect(ticket.kbSources).toEqual([]);
    expect(ticket.entities).toEqual({});
  });

  it('keeps a null order lookup distinct from a failed one', () => {
    expect(rowToTicket(row({ order_found: null })).orderFound).toBeNull();
    expect(rowToTicket(row({ order_found: false })).orderFound).toBe(false);
  });
});

describe('sanitiseSearch', () => {
  it('strips the characters that carry PostgREST filter syntax', () => {
    // A comma would split the or() filter into extra conditions, and a percent
    // sign is a wildcard — both change what the query means.
    expect(sanitiseSearch('a,b')).toBe('a b');
    expect(sanitiseSearch('drop(1)')).toBe('drop 1');
    expect(sanitiseSearch('100%')).toBe('100');
    expect(sanitiseSearch('a*b')).toBe('a b');
    expect(sanitiseSearch('back\\slash')).toBe('back slash');
  });

  it('leaves an ordinary search term untouched', () => {
    expect(sanitiseSearch('NX-905117')).toBe('NX-905117');
    expect(sanitiseSearch('washing machine')).toBe('washing machine');
  });

  it('trims, so a whitespace-only search does not build a filter', () => {
    expect(sanitiseSearch('  ,,  ')).toBe('');
  });
});
