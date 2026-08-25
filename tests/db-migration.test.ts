import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applySchema } from '../lib/db/sqlite';

/**
 * The schema as it stood before customer identity, ratings and attachments
 * existed. A demo machine that has run an older build has exactly this on
 * disk, and opening it must upgrade rather than crash.
 */
const LEGACY_DDL = `
CREATE TABLE tickets (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, message TEXT NOT NULL,
  reply TEXT NOT NULL, category TEXT NOT NULL, intent TEXT NOT NULL,
  sentiment TEXT NOT NULL, urgency TEXT NOT NULL, confidence REAL NOT NULL,
  summary TEXT NOT NULL, kb_sources TEXT NOT NULL DEFAULT '[]',
  retrieved_chunks TEXT NOT NULL DEFAULT '[]', entities TEXT NOT NULL DEFAULT '{}',
  order_ref TEXT, order_found INTEGER, order_status TEXT, order_value REAL,
  contact_count INTEGER NOT NULL DEFAULT 1, escalated INTEGER NOT NULL DEFAULT 0,
  fired_rules TEXT NOT NULL DEFAULT '[]', route TEXT NOT NULL,
  sla_hours REAL NOT NULL DEFAULT 6, grounding_note TEXT,
  resolved INTEGER NOT NULL DEFAULT 0, resolution_note TEXT, assigned_to TEXT,
  latency_ms INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
`;

function columnsOf(db: Database.Database): Set<string> {
  return new Set(
    (db.prepare('PRAGMA table_info(tickets)').all() as { name: string }[]).map((c) => c.name),
  );
}

describe('opening a database written by an older build', () => {
  it('adds every column the current code expects', () => {
    const db = new Database(':memory:');
    db.exec(LEGACY_DDL);
    expect(columnsOf(db).has('user_id')).toBe(false);

    applySchema(db);

    const columns = columnsOf(db);
    for (const added of [
      'satisfaction',
      'satisfaction_reason',
      'user_id',
      'customer_email',
      'has_attachment',
      'attachment_note',
    ]) {
      expect(columns.has(added)).toBe(true);
    }
  });

  it('creates the indexes, including one on a newly added column', () => {
    // The ordering bug this catches: the index on user_id used to be created
    // before the column was added, so opening an older file threw
    // "no such column: user_id" and every page 500'd.
    const db = new Database(':memory:');
    db.exec(LEGACY_DDL);
    expect(() => applySchema(db)).not.toThrow();

    const indexes = new Set(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tickets'")
          .all() as { name: string }[]
      ).map((row) => row.name),
    );
    expect(indexes.has('idx_tickets_user')).toBe(true);
    expect(indexes.has('idx_tickets_created')).toBe(true);
  });

  it('keeps the rows that were already there', () => {
    const db = new Database(':memory:');
    db.exec(LEGACY_DDL);
    db.prepare(
      `INSERT INTO tickets (id, conversation_id, message, reply, category, intent, sentiment,
        urgency, confidence, summary, route, created_at, updated_at)
       VALUES ('NXC-OLD1','c','old message','old reply','Delivery','i','Neutral','Low',80,'s',
        'AI Assistant','2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z')`,
    ).run();

    applySchema(db);

    const row = db.prepare('SELECT id, message, user_id, has_attachment FROM tickets').get() as {
      id: string;
      message: string;
      user_id: string | null;
      has_attachment: number;
    };
    expect(row.id).toBe('NXC-OLD1');
    expect(row.message).toBe('old message');
    expect(row.user_id).toBeNull();
    expect(row.has_attachment).toBe(0);
  });

  it('is idempotent, so opening the file twice is safe', () => {
    const db = new Database(':memory:');
    db.exec(LEGACY_DDL);
    applySchema(db);
    expect(() => applySchema(db)).not.toThrow();
    expect(() => applySchema(db)).not.toThrow();
  });

  it('works on an empty database too, not just an upgrade', () => {
    const db = new Database(':memory:');
    expect(() => applySchema(db)).not.toThrow();
    expect(columnsOf(db).has('attachment_note')).toBe(true);
  });
});
