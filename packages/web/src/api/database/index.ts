import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

const client = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

// Self-heal: `songs.text_color` was added after some installs' local.db files
// were already created. Add it if missing so per-song color never 500s on an
// existing database — freshly seeded databases already have it via schema.ts.
// Fire-and-forget (no top-level await — the desktop bundle's build target
// doesn't support it): a local SQLite ALTER TABLE finishes in low single-digit
// milliseconds, well before the server has even started accepting requests.
async function ensureSongsTextColorColumn() {
  try {
    const info = await client.execute("PRAGMA table_info(songs)");
    const hasColumn = info.rows.some((r) => (r as unknown as { name: string }).name === "text_color");
    if (!hasColumn) await client.execute("ALTER TABLE songs ADD COLUMN text_color TEXT");
  } catch {
    // best-effort — a genuine failure surfaces naturally the first time a
    // query actually touches the column
  }
}
void ensureSongsTextColorColumn();

export const db = drizzle(client, { schema });
