import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Desk, Entities, FiredRule, Ticket, TicketPatch, TicketQuery } from '../types';
import { URGENCY_RANK, type NewTicket, type TicketStore } from './types';

/* ------------------------------------------------------------------ */
/* Connection                                                         */
/* ------------------------------------------------------------------ */

/**
 * Server-only. The service role key bypasses row level security, so it must
 * never reach the browser — every caller here runs inside a route handler, a
 * server component or a CLI script. Row level security is enabled on the table
 * with no policies, so the anon key cannot read or write it at all.
 */
export function supabaseConfigured(): boolean {
  return Boolean(
    (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase is selected but SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.',
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

const TABLE = 'tickets';

/* ------------------------------------------------------------------ */
/* Row mapping                                                        */
/* ------------------------------------------------------------------ */

export interface Row {
  id: string;
  conversation_id: string;
  user_id: string | null;
  customer_email: string | null;
  message: string;
  reply: string;
  category: string;
  intent: string;
  sentiment: string;
  urgency: string;
  confidence: number;
  summary: string;
  kb_sources: unknown;
  retrieved_chunks: unknown;
  entities: unknown;
  order_ref: string | null;
  order_found: boolean | null;
  order_status: string | null;
  order_value: number | null;
  contact_count: number;
  escalated: boolean;
  fired_rules: unknown;
  route: string;
  sla_hours: number;
  grounding_note: string | null;
  has_attachment: boolean;
  attachment_note: string | null;
  resolved: boolean;
  resolution_note: string | null;
  assigned_to: string | null;
  satisfaction: number | null;
  satisfaction_reason: string | null;
  latency_ms: number;
  created_at: string;
  updated_at: string;
}

/** jsonb comes back parsed, but a hand-edited row could still hold a string. */
function asArray<T>(value: unknown, fallback: T[]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function asObject<T extends object>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as T;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as T) : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function rowToTicket(row: Row): Ticket {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    customerEmail: row.customer_email,
    message: row.message,
    reply: row.reply,
    category: row.category as Ticket['category'],
    intent: row.intent,
    sentiment: row.sentiment as Ticket['sentiment'],
    urgency: row.urgency as Ticket['urgency'],
    confidence: Number(row.confidence),
    summary: row.summary,
    kbSources: asArray<string>(row.kb_sources, []),
    retrievedChunks: asArray<string>(row.retrieved_chunks, []),
    entities: asObject<Entities>(row.entities, {}),
    orderRef: row.order_ref,
    orderFound: row.order_found,
    orderStatus: row.order_status,
    orderValue: row.order_value === null ? null : Number(row.order_value),
    contactCount: row.contact_count,
    escalated: row.escalated,
    firedRules: asArray<FiredRule>(row.fired_rules, []),
    route: row.route as Desk,
    slaHours: Number(row.sla_hours),
    groundingNote: row.grounding_note,
    hasAttachment: row.has_attachment,
    attachmentNote: row.attachment_note,
    resolved: row.resolved,
    resolutionNote: row.resolution_note,
    assignedTo: row.assigned_to,
    satisfaction: row.satisfaction,
    satisfactionReason: row.satisfaction_reason,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function newId(): string {
  return `NXC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

/**
 * PostgREST's or() filter is comma separated, so a comma or a wildcard in the
 * search text would change the query's meaning. Strip the characters that
 * carry syntax rather than trying to escape them.
 */
export function sanitiseSearch(raw: string): string {
  return raw.replace(/[,()%*\\]/g, ' ').trim();
}

/* ------------------------------------------------------------------ */
/* Store                                                              */
/* ------------------------------------------------------------------ */

export const supabaseStore: TicketStore = {
  driver: 'supabase',

  async insertTicket(input: NewTicket): Promise<Ticket> {
    const now = new Date().toISOString();
    const { data, error } = await getClient()
      .from(TABLE)
      .insert({
        id: newId(),
        conversation_id: input.conversationId,
        user_id: input.userId ?? null,
        customer_email: input.customerEmail ?? null,
        message: input.message,
        reply: input.reply,
        category: input.category,
        intent: input.intent,
        sentiment: input.sentiment,
        urgency: input.urgency,
        confidence: input.confidence,
        summary: input.summary,
        kb_sources: input.kbSources,
        retrieved_chunks: input.retrievedChunks,
        entities: input.entities,
        order_ref: input.orderRef,
        order_found: input.orderFound,
        order_status: input.orderStatus,
        order_value: input.orderValue,
        contact_count: input.contactCount,
        escalated: input.escalated,
        fired_rules: input.firedRules,
        route: input.route,
        sla_hours: input.slaHours,
        grounding_note: input.groundingNote,
        has_attachment: input.hasAttachment ?? false,
        attachment_note: input.attachmentNote ?? null,
        resolved: input.resolved,
        resolution_note: input.resolutionNote,
        assigned_to: input.assignedTo,
        satisfaction: input.satisfaction ?? null,
        satisfaction_reason: input.satisfactionReason ?? null,
        latency_ms: input.latencyMs,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) throw new Error(`Supabase insert failed: ${error.message}`);
    return rowToTicket(data as Row);
  },

  async getTicket(id: string): Promise<Ticket | null> {
    const { data, error } = await getClient().from(TABLE).select().eq('id', id).maybeSingle();
    if (error) throw new Error(`Supabase read failed: ${error.message}`);
    return data ? rowToTicket(data as Row) : null;
  },

  async listTickets(query: TicketQuery = {}): Promise<Ticket[]> {
    let builder = getClient().from(TABLE).select();

    if (query.urgency) builder = builder.eq('urgency', query.urgency);
    if (query.category) builder = builder.eq('category', query.category);
    if (query.route) builder = builder.eq('route', query.route);
    if (query.userId) builder = builder.eq('user_id', query.userId);
    if (query.escalatedOnly) builder = builder.eq('escalated', true);
    if (query.unresolvedOnly) builder = builder.eq('resolved', false);

    const search = query.q ? sanitiseSearch(query.q) : '';
    if (search) {
      builder = builder.or(
        `message.ilike.%${search}%,order_ref.ilike.%${search}%,id.ilike.%${search}%`,
      );
    }

    // urgency_rank is a stored generated column, so the worst-first ordering is
    // the same here as the CASE expression the SQLite driver uses. seq breaks
    // the remaining tie for rows written in the same millisecond.
    if (query.sort === 'triage') {
      builder = builder
        .order('resolved', { ascending: true })
        .order('urgency_rank', { ascending: true })
        .order('escalated', { ascending: false })
        .order('created_at', { ascending: false })
        .order('seq', { ascending: false });
    } else {
      builder = builder
        .order('created_at', { ascending: false })
        .order('seq', { ascending: false });
    }

    const { data, error } = await builder.limit(query.limit ?? 200);
    if (error) throw new Error(`Supabase list failed: ${error.message}`);
    return (data as Row[]).map(rowToTicket);
  },

  async updateTicket(id: string, patch: TicketPatch): Promise<Ticket | null> {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.resolved !== undefined) update.resolved = patch.resolved;
    if (patch.resolutionNote !== undefined) update.resolution_note = patch.resolutionNote;
    if (patch.assignedTo !== undefined) update.assigned_to = patch.assignedTo;
    if (patch.route !== undefined) update.route = patch.route;
    if (patch.satisfaction !== undefined) update.satisfaction = patch.satisfaction;
    if (patch.satisfactionReason !== undefined) {
      update.satisfaction_reason = patch.satisfactionReason;
    }

    const { data, error } = await getClient()
      .from(TABLE)
      .update(update)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw new Error(`Supabase update failed: ${error.message}`);
    return data ? rowToTicket(data as Row) : null;
  },

  async contactCountForOrder(orderRef: string | null | undefined): Promise<number> {
    if (!orderRef) return 1;
    const { count, error } = await getClient()
      .from(TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('order_ref', orderRef.toUpperCase());
    if (error) throw new Error(`Supabase count failed: ${error.message}`);
    return (count ?? 0) + 1;
  },

  async conversationHistory(conversationId: string, limit = 10): Promise<Ticket[]> {
    const { data, error } = await getClient()
      .from(TABLE)
      .select()
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw new Error(`Supabase history failed: ${error.message}`);
    return (data as Row[]).map(rowToTicket);
  },

  async clearTickets(): Promise<void> {
    // A delete needs a filter; every id starts with the NXC- prefix.
    const { error } = await getClient().from(TABLE).delete().like('id', 'NXC-%');
    if (error) throw new Error(`Supabase clear failed: ${error.message}`);
  },
};

export { URGENCY_RANK };
