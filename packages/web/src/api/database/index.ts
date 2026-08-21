import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

const client = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

/**
 * Self-heal for tables/columns added to schema.ts after some installs'
 * local.db files already existed - a query touching a table drizzle knows
 * about but the on-disk database doesn't 500s with "no such table"/"no such
 * column", for EVERY query against that table, not just the write path that
 * introduced it. A machine that first ran the app before Presentations
 * existed, for example, has no presentations/presentation_slides tables at
 * all - no amount of column-healing on existing tables fixes that.
 *
 * Freshly seeded databases (drizzle-kit push, run before every release) get
 * the current schema.ts directly and never need this; it exists purely to
 * patch up a database file created by an older app version.
 *
 * Add one line here whenever a table or column is added to the schema.
 */
const TABLE_MIGRATIONS: { table: string; ddl: string }[] = [
  {
    table: "presentations",
    ddl: `CREATE TABLE presentations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  },
  {
    table: "presentation_slides",
    ddl: `CREATE TABLE presentation_slides (
      id TEXT PRIMARY KEY,
      presentation_id TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      heading TEXT,
      body TEXT,
      background_id TEXT,
      bg_color TEXT,
      text_color TEXT,
      format TEXT,
      text_align TEXT
    )`,
  },
  {
    table: "luts",
    ddl: `CREATE TABLE luts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cube TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  },
];

const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "songs", column: "text_color", ddl: "ALTER TABLE songs ADD COLUMN text_color TEXT" },
  { table: "media", column: "muted", ddl: "ALTER TABLE media ADD COLUMN muted INTEGER DEFAULT 1" },
  { table: "presentation_slides", column: "bg_color", ddl: "ALTER TABLE presentation_slides ADD COLUMN bg_color TEXT" },
  { table: "presentation_slides", column: "text_color", ddl: "ALTER TABLE presentation_slides ADD COLUMN text_color TEXT" },
  { table: "sections", column: "format", ddl: "ALTER TABLE sections ADD COLUMN format TEXT" },
  { table: "sections", column: "text_align", ddl: "ALTER TABLE sections ADD COLUMN text_align TEXT" },
  { table: "presentation_slides", column: "format", ddl: "ALTER TABLE presentation_slides ADD COLUMN format TEXT" },
  { table: "presentation_slides", column: "text_align", ddl: "ALTER TABLE presentation_slides ADD COLUMN text_align TEXT" },
  { table: "media", column: "role", ddl: "ALTER TABLE media ADD COLUMN role TEXT" },
  { table: "media", column: "color_filter", ddl: "ALTER TABLE media ADD COLUMN color_filter TEXT" },
];

// Fire-and-forget (no top-level await - the desktop bundle's build target
// doesn't support it): local SQLite DDL finishes in low single-digit
// milliseconds, well before the server has even started accepting requests.
async function ensureSchema() {
  try {
    const existing = await client.execute("SELECT name FROM sqlite_master WHERE type='table'");
    const tables = new Set(existing.rows.map((r) => (r as unknown as { name: string }).name));
    for (const { table, ddl } of TABLE_MIGRATIONS) {
      if (!tables.has(table)) {
        await client.execute(ddl);
        tables.add(table);
      }
    }
  } catch {
    // best-effort - a genuine failure surfaces naturally the first time a
    // query actually touches the table
  }

  const columnCache = new Map<string, Set<string>>();
  for (const { table, column, ddl } of COLUMN_MIGRATIONS) {
    try {
      let columns = columnCache.get(table);
      if (!columns) {
        const info = await client.execute(`PRAGMA table_info(${table})`);
        columns = new Set(info.rows.map((r) => (r as unknown as { name: string }).name));
        columnCache.set(table, columns);
      }
      if (!columns.has(column)) {
        await client.execute(ddl);
        columns.add(column);
      }
    } catch {
      // best-effort - same reasoning as above
    }
  }
}
void ensureSchema();

export const db = drizzle(client, { schema });
