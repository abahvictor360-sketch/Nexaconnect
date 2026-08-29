/**
 * Vercel serverless entry for the Hono API.
 *
 * Routing note, learned the hard way. A catch-all `api/[...route].ts` looked
 * right and served /api/songs, but every nested path - /api/live/state,
 * /api/remote/poll - fell through to Vercel's own 404 while single-segment
 * ones reached Hono. So the whole API is routed explicitly instead: a rewrite
 * in vercel.json sends /api/(.*) here and carries the original path in
 * __vpath, which this file puts back on the URL before handing over. Hono's
 * .basePath("api") then matches what the caller actually asked for.
 *
 * It imports a bundle rather than src/api/index.ts directly. This package is
 * "type": "module", and Vercel transpiles each TypeScript file on its own
 * instead of bundling, leaving import specifiers as written; Node's ESM
 * resolver then rejects every extensionless relative import in the API tree.
 * `bun build --packages=external` (see vercel.json) inlines exactly those
 * relative imports and leaves node_modules alone for Vercel to trace.
 *
 * The long-lived Bun server in src/server.ts remains the real deployment
 * target. Media uploads still need a writable disk and do not work here. The
 * live/stage/remote channels do: they fall back to the database and long
 * polling when the API detects a serverless runtime (see lib/channel-store.ts).
 */
import app from "./_api-bundle.js";

/** Query key carrying the pre-rewrite path. Stripped before Hono sees it. */
const PATH_PARAM = "__vpath";

/**
 * A named `fetch` export, not a default one. Vercel's Node runtime reads a
 * default export as the `(req, res) => void` signature and discards anything
 * returned from it, so a default export handing back a Response logs
 * "default export returned a `Response`" and answers with an empty body.
 */
export function fetch(request: Request): Response | Promise<Response> {
  const url = new URL(request.url);
  const original = url.searchParams.get(PATH_PARAM);
  if (original === null) return app.fetch(request);

  // Vercel merges the caller's query string into the destination, so every
  // other parameter (?rev=, ?seq=) is already here and only ours is removed.
  url.searchParams.delete(PATH_PARAM);
  url.pathname = `/api/${original}`;
  return app.fetch(new Request(url, request));
}
