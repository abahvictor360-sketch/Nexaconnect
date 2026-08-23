import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Desk, FiredRule, Ticket, TicketPatch, TicketQuery } from './types';

/* ------------------------------------------------------------------ */
/* Connection                                                         */
/* ------------------------------------------------------------------ */

const DB_PATH = process.env.NEXACONNECT_DB
  ? path.resolve(process.env.NEXACONNECT_DB)
  : path.join(process.cwd(), 'data', 'nexaconnect.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tickets (
  id                TEXT PRIMARY KEY,
  conversation_id   TEXT NOT NULL,
  message           TEXT NOT NULL,
  reply             TEXT NOT NULL,
  category          TEXT NOT NULL,
  intent            TEXT NOT NULL,
  sentiment         TEXT NOT NULL,
  urgency           TEXT NOT NULL,
  confidence        REAL NOT NULL,
  summary           TEXT NOT NULL,
  kb_sources        TEXT NOT NULL DEFAULT '[]',
  retrieved_chunks  TEXT NOT NULL DEFAULT '[]',
  entities          TEXT NOT NULL DEFAULT '{}',
  order_ref         TEXT,
  order_found       INTEGER,
  order_status      TEXT,
  order_value       REAL,
  contact_count     INTEGER NOT NULL DEFAULT 1,
  escalated         INTEGER NOT NULL DEFAULT 0,
  fired_rules       TEXT NOT NULL DEFAULT '[]',
  route             TEXT NOT NULL,
  sla_hours         REAL NOT NULL DEFAULT 6,
  grounding_note    TEXT,
  resolved          INTEGER NOT NULL DEFAULT 0,
  resolution_note   TEXT,
  assigned_to       TEXT,
  latency_ms        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_created   ON tickets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_order_ref ON tickets (order_ref);
CREATE INDEX IF NOT EXISTS idx_tickets_conv      ON tickets (conversation_id);
CREATE INDEX IF NOT EXISTS idx_tickets_urgency   ON tickets (urgency);
CREATE INDEX IF NOT EXISTS idx_tickets_category  ON tickets (category);
`;

type DB = Database.Database;

let instance: DB | null = null;

export function getDb(): DB {
  if (instance) return instance;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  instance = db;
  return db;
}

/** Test/eval helper: point the repository at a throwaway in-memory database. */
export function useMemoryDb(): DB {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  instance = db;
  return db;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

/* ------------------------------------------------------------------ */
/* Row <-> domain mapping                                             */
/* ------------------------------------------------------------------ */

interface TicketRow {
  id: string;
  conversation_id: string;
  message: string;
  reply: string;
  category: string;
  intent: string;
  sentiment: string;
  urgency: string;
  confidence: number;
  summary: string;
  kb_sources: string;
  retrieved_chunks: string;
  entities: string;
  order_ref: string | null;
  order_found: number | null;
  order_status: string | null;
  order_value: number | null;
  contact_count: number;
  escalated: number;
  fired_rules: string;
  route: string;
  sla_hours: number;
  grounding_note: string | null;
  resolved: number;
  resolution_note: string | null;
  assigned_to: string | null;
  latency_ms: number;
  created_at: string;
  updated_at: string;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    message: row.message,
    reply: row.reply,
    category: row.category as Ticket['category'],
    intent: row.intent,
    sentiment: row.sentiment as Ticket['sentiment'],
    urgency: row.urgency as Ticket['urgency'],
    confidence: row.confidence,
    summary: row.summary,
    kbSources: parseJson<string[]>(row.kb_sources, []),
    retrievedChunks: parseJson<string[]>(row.retrieved_chunks, []),
    entities: parseJson<Ticket['entities']>(row.entities, {}),
    orderRef: row.order_ref,
    orderFound: row.order_found === null ? null : row.order_found === 1,
    orderStatus: row.order_status,
    orderValue: row.order_value,
    contactCount: row.contact_count,
    escalated: row.escalated === 1,
    firedRules: parseJson<FiredRule[]>(row.fired_rules, []),
    route: row.route as Desk,
    slaHours: row.sla_hours,
    groundingNote: row.grounding_note,
    resolved: row.resolved === 1,
    resolutionNote: row.resolution_note,
    assignedTo: row.assigned_to,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/* Queries                                                            */
/* ------------------------------------------------------------------ */

export type NewTicket = Omit<Ticket, 'id' | 'createdAt' | 'updatedAt'>;

export function newTicketId(): string {
  return `NXC-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export function insertTicket(input: NewTicket): Ticket {
  const db = getDb();
  const now = new Date().toISOString();
  const id = newTicketId();

  db.prepare(
    `INSERT INTO tickets (
      id, conversation_id, message, reply, category, intent, sentiment, urgency,
      confidence, summary, kb_sources, retrieved_chunks, entities, order_ref,
      order_found, order_status, order_value, contact_count, escalated,
      fired_rules, route, sla_hours, grounding_note, resolved, resolution_note,
      assigned_to, latency_ms, created_at, updated_at
    ) VALUES (
      @id, @conversationId, @message, @reply, @category, @intent, @sentiment, @urgency,
      @confidence, @summary, @kbSources, @retrievedChunks, @entities, @orderRef,
      @orderFound, @orderStatus, @orderValue, @contactCount, @escalated,
      @firedRules, @route, @slaHours, @groundingNote, @resolved, @resolutionNote,
      @assignedTo, @latencyMs, @createdAt, @updatedAt
    )`,
  ).run({
    id,
    conversationId: input.conversationId,
    message: input.message,
    reply: input.reply,
    category: input.category,
    intent: input.intent,
    sentiment: input.sentiment,
    urgency: input.urgency,
    confidence: input.confidence,
    summary: input.summary,
    kbSources: JSON.stringify(input.kbSources),
    retrievedChunks: JSON.stringify(input.retrievedChunks),
    entities: JSON.stringify(input.entities),
    orderRef: input.orderRef,
    orderFound: input.orderFound === null ? null : input.orderFound ? 1 : 0,
    orderStatus: input.orderStatus,
    orderValue: input.orderValue,
    contactCount: input.contactCount,
    escalated: input.escalated ? 1 : 0,
    firedRules: JSON.stringify(input.firedRules),
    route: input.route,
    slaHours: input.slaHours,
    groundingNote: input.groundingNote,
    resolved: input.resolved ? 1 : 0,
    resolutionNote: input.resolutionNote,
    assignedTo: input.assignedTo,
    latencyMs: input.latencyMs,
    createdAt: now,
    updatedAt: now,
  });

  return getTicket(id)!;
}

export function getTicket(id: string): Ticket | null {
  const row = getDb().prepare('SELECT * FROM tickets WHERE id = ?').get(id) as TicketRow | undefined;
  return row ? toTicket(row) : null;
}

export function listTickets(query: TicketQuery = {}): Ticket[] {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.urgency) {
    clauses.push('urgency = @urgency');
    params.urgency = query.urgency;
  }
  if (query.category) {
    clauses.push('category = @category');
    params.category = query.category;
  }
  if (query.route) {
    clauses.push('route = @route');
    params.route = query.route;
  }
  if (query.escalatedOnly) clauses.push('escalated = 1');
  if (query.unresolvedOnly) clauses.push('resolved = 0');

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.limit = query.limit ?? 200;

  const rows = getDb()
    .prepare(`SELECT * FROM tickets ${where} ORDER BY created_at DESC LIMIT @limit`)
    .all(params) as TicketRow[];

  return rows.map(toTicket);
}

export function updateTicket(id: string, patch: TicketPatch): Ticket | null {
  const existing = getTicket(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: Record<string, unknown> = { id, updatedAt: new Date().toISOString() };

  if (patch.resolved !== undefined) {
    sets.push('resolved = @resolved');
    params.resolved = patch.resolved ? 1 : 0;
  }
  if (patch.resolutionNote !== undefined) {
    sets.push('resolution_note = @resolutionNote');
    params.resolutionNote = patch.resolutionNote;
  }
  if (patch.assignedTo !== undefined) {
    sets.push('assigned_to = @assignedTo');
    params.assignedTo = patch.assignedTo;
  }
  if (patch.route !== undefined) {
    sets.push('route = @route');
    params.route = patch.route;
  }

  sets.push('updated_at = @updatedAt');
  getDb()
    .prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = @id`)
    .run(params);

  return getTicket(id);
}

/**
 * How many times this order reference has already been raised, counting the
 * contact about to be logged. Drives the REPEAT_CONTACT escalation rule.
 */
export function contactCountForOrder(orderRef: string | null | undefined): number {
  if (!orderRef) return 1;
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM tickets WHERE order_ref = ?')
    .get(orderRef.toUpperCase()) as { n: number };
  return row.n + 1;
}

export function conversationHistory(conversationId: string, limit = 10): Ticket[] {
  const rows = getDb()
    .prepare('SELECT * FROM tickets WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?')
    .all(conversationId, limit) as TicketRow[];
  return rows.map(toTicket);
}

export function clearTickets(): void {
  getDb().prepare('DELETE FROM tickets').run();
}
