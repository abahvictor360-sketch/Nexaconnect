import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

import {
  databaseUrl,
  databaseAuthToken,
  MISSING_DATABASE_URL,
} from "./credentials";

if (!databaseUrl) {
  // An absent url reaches createClient as `undefined` and fails deep inside
  // config expansion, so the first symptom is an opaque 500 on every route
  // rather than the one sentence that fixes it.
  throw new Error(MISSING_DATABASE_URL);
}

const client = createClient({
  url: databaseUrl,
  authToken: databaseAuthToken,
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
  {
    table: "channel_state",
    ddl: `CREATE TABLE channel_state (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      rev INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`,
  },
  {
    table: "remote_commands",
    ddl: `CREATE TABLE remote_commands (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      payload TEXT NOT NULL,
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

/**
 * One-off data fixes, applied once per database and recorded so they never run
 * twice. The DDL lists above are naturally idempotent - a column either exists
 * or it does not - but a statement that rewrites rows is not, so these need a
 * ledger of their own.
 *
 * Ids are permanent: renaming one makes every existing install run it again.
 */
const DATA_MIGRATIONS: { id: string; sql: string }[] = [
  {
    /*
     * `media.fit` defaulted to 'cover' at the column level and nothing in the
     * app ever offered a way to change it, so every stored 'cover' is the
     * default rather than anyone's decision - and it crops. That is fine for a
     * photo behind lyrics, and wrong for an image shown as the slide itself: a
     * service flyer lost its left edge, headline and all.
     *
     * Clearing it lets each context choose its own sensible default while a
     * value the operator now actually picks is still honoured.
     */
    id: "2026-08-media-fit-unset",
    sql: "UPDATE media SET fit = NULL WHERE fit = 'cover' AND type = 'image'",
  },
  {
    /*
     * The same fix again, because the first pass could not hold.
     *
     * Dropping `fit` from the local-upload INSERTs was not enough to leave it
     * unset: SQLite then applies the column DEFAULT, which is still 'cover'.
     * So anything uploaded between the two releases was stamped anyway, and
     * the ledger had already recorded the first migration as done. The INSERTs
     * now pass null explicitly; this catches what they stamped meanwhile.
     */
    id: "2026-08-media-fit-unset-again",
    sql: "UPDATE media SET fit = NULL WHERE fit = 'cover' AND type = 'image'",
  },
  {
    /*
     * Undoes 2026-08-output-canvas-1080p, which turned the fixed canvas on for
     * everyone. That was the wrong default: filling the screen you have beats
     * matching screens you do not, and letterboxing a 16:9 canvas costs the
     * most on exactly the screens that can least afford it - an analog VGA
     * projector, an older 4:3 panel. The canvas stays available in Settings
     * for anyone who does want several screens to agree.
     *
     * Gated on that migration having actually run, so an install that never
     * had it and where someone chose 1920x1080 deliberately is left alone.
     * The two releases in between are the only window where a deliberate
     * choice could be undone here.
     */
    id: "2026-08-output-canvas-back-to-auto",
    sql:
      "UPDATE settings SET config = json_set(config, '$.output.resolution', 'auto') " +
      "WHERE json_extract(config, '$.output.resolution') = '1920x1080' " +
      "AND EXISTS (SELECT 1 FROM applied_migrations WHERE id = '2026-08-output-canvas-1080p')",
  },
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

  try {
    await client.execute(
      "CREATE TABLE IF NOT EXISTS applied_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    const done = await client.execute("SELECT id FROM applied_migrations");
    const seen = new Set(done.rows.map((r) => (r as unknown as { id: string }).id));
    for (const { id, sql } of DATA_MIGRATIONS) {
      if (seen.has(id)) continue;
      // Caught per migration, not around the loop: one that cannot run on this
      // build - a JSON function that is not compiled in, say - must not stop
      // the others, and must stay unrecorded so it is retried next launch.
      try {
        await client.execute(sql);
        await client.execute({
          sql: "INSERT INTO applied_migrations (id, applied_at) VALUES (?, ?)",
          args: [id, new Date().toISOString()],
        });
      } catch {
        /* left for the next launch */
      }
    }
  } catch {
    // best-effort - a data fix that cannot run leaves the old value in place,
    // which is the behaviour the app had before it existed.
  }
}
void ensureSchema();

export const db = drizzle(client, { schema });
