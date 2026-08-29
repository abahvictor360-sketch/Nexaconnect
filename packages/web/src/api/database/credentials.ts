/**
 * Where the database URL and token come from, in one place, because two
 * callers need the same answer: the API client here and drizzle.config.ts.
 *
 * DATABASE_URL is what .env.template documents and what local development
 * uses. TURSO_DATABASE_URL is what the Turso integration writes into a
 * Vercel project's environment - a deployment connected through the
 * dashboard has the credentials under those names and none under ours, so
 * reading only DATABASE_URL fails on a project that is, by every visible
 * sign, correctly wired up.
 *
 * DATABASE_URL wins when both are set: it is the explicit one.
 */
export const databaseUrl =
  process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL;

export const databaseAuthToken =
  process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;

export const MISSING_DATABASE_URL =
  "No database URL. Set DATABASE_URL (or TURSO_DATABASE_URL, which the Turso " +
  "Vercel integration writes for you). Local development uses a file URL - " +
  "file:/abs/path/to/packages/web/local.db, created by `bun run reseed:local`. " +
  "A hosted deployment needs a remote libsql URL plus an auth token, since a " +
  "file: URL needs the native libsql package and a writable disk.";
