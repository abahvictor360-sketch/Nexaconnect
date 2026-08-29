/**
 * Vercel serverless entry for the Hono API.
 *
 * A catch-all keeps the original path intact (/api/songs stays /api/songs), so
 * the app's own .basePath("api") still matches - a rewrite to a fixed /api
 * would strip it and every route would 404.
 *
 * The long-lived Bun server in src/server.ts remains the real deployment
 * target; this exists so the app can be demoed on a public URL. Two things
 * genuinely do not work here, both by nature of serverless rather than by
 * omission: the SSE routes (/api/live, /api/stage, /api/remote) hold their
 * state in a module-level variable in lib/live-store.ts and lib/channels.ts,
 * and every request may land on a different instance; and MEDIA_DIR uploads
 * need a writable disk. Lyrics, Bible and presentation reads are unaffected.
 */
import app from "../src/api/index";

export default function handler(request: Request): Response | Promise<Response> {
  return app.fetch(request);
}
