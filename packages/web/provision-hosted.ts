/**
 * Bring a hosted database up to the current schema at build time, and seed the
 * bundled library into it once.
 *
 * A hosted deployment has nowhere else to run this from. `reseed:local` is the
 * local equivalent, but it deletes local.db and pushes to a file; a remote
 * database is reachable only from somewhere holding the credentials, and on
 * Vercel that is the build. Without it the app deploys green and then answers
 * every request with "no such table: songs", which looks like a broken build
 * rather than an unprovisioned database.
 *
 * Safe to run on every deploy:
 *  - It does nothing at all unless a remote URL is configured, so local and
 *    desktop builds are untouched.
 *  - `drizzle-kit push` is declarative - it applies the difference and is a
 *    no-op once the database already matches schema.ts.
 *  - seed.ts checks for existing songs and returns early unless passed
 *    --force, so the library is inserted once and never duplicated. Edits made
 *    through the app survive later deploys.
 *
 * A failure here does not fail the build. A deploy that serves the frontend
 * and the offline Bible with a stale database beats no deploy at all, and the
 * cause is one line in the build log.
 */
import { databaseUrl } from "./src/api/database/credentials";

if (!databaseUrl) {
  console.log("[provision] no database URL configured - skipping.");
  process.exit(0);
}

if (databaseUrl.startsWith("file:")) {
  console.log("[provision] file: database - local build, skipping. Use `bun run reseed:local`.");
  process.exit(0);
}

async function run(cmd: string[]) {
  const proc = Bun.spawn(cmd, { cwd: import.meta.dir, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited with ${code}`);
}

try {
  console.log("[provision] pushing schema to the hosted database...");
  await run(["bunx", "drizzle-kit", "push", "--force"]);
  console.log("[provision] seeding the library (no-op if it already has songs)...");
  await run(["bun", "src/api/seed.ts"]);
  console.log("[provision] done.");
} catch (err) {
  console.error("[provision] FAILED - deploying anyway, the API will 500 until this is fixed:", err);
}
