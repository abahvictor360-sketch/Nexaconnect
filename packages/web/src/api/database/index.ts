import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

const client = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

/**
 * Self-heal for columns added to schema.ts after some installs' local.db
 * files already existed. `db.select().from(table)` always lists every
 * schema-defined column, so a single missing column 500s ANY query that
 * touches that table — not just the write path that would have used it.
 * Freshly seeded databases (drizzle-kit push, run before every release) get
 * every column from schema.ts directly and never need this; this exists
 * purely to patch up a database file created by an older app version.
 *
 * Add one line here whenever a column is added to an existing table.
 * New tables need nothing — they're created fresh by drizzle-kit push.
 */
const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "songs", column: "text_color", ddl: "ALTER TABLE songs ADD COLUMN text_color TEXT" },
  { table: "media", column: "muted", ddl: "ALTER TABLE media ADD COLUMN muted INTEGER DEFAULT 1" },
];

// Fire-and-forget (no top-level await — the desktop bundle's build target
// doesn't support it): local SQLite ALTERs finish in low single-digit
// milliseconds, well before the server has even started accepting requests.
async function ensureColumnsExist() {
  const tableInfoCache = new Map<string, Set<string>>();
  for (const { table, column, ddl } of COLUMN_MIGRATIONS) {
    try {
      let columns = tableInfoCache.get(table);
      if (!columns) {
        const info = await client.execute(`PRAGMA table_info(${table})`);
        columns = new Set(info.rows.map((r) => (r as unknown as { name: string }).name));
        tableInfoCache.set(table, columns);
      }
      if (!columns.has(column)) {
        await client.execute(ddl);
        columns.add(column);
      }
    } catch {
      // best-effort — a genuine failure surfaces naturally the first time a
      // query actually touches the column
    }
  }
}
void ensureColumnsExist();

export const db = drizzle(client, { schema });
