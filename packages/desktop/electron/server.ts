import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
};

/**
 * Embedded production server: serves the static web bundle and mounts the
 * Hono API from packages/web, backed by a local SQLite file in userData.
 * Returns the port it is listening on (an OS-assigned free port).
 */
export async function startEmbeddedServer(
  webDist: string,
  dbFile: string,
  mediaDir: string,
): Promise<number> {
  // Must be set before the API (and its db client) is imported.
  process.env.DATABASE_URL = "file:" + dbFile.replace(/\\/g, "/");
  // Media lives in the user's Documents folder so they can browse, add and
  // back up files with Explorer/Finder directly, not just through the app.
  process.env.MEDIA_DIR = mediaDir;
  const { default: api } = await import("../../web/src/api");
  const { serve } = await import("@hono/node-server");

  const indexPath = path.join(webDist, "index.html");

  const handler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api")) return api.fetch(request);

    const clean = decodeURIComponent(url.pathname).replace(/^\/+/, "").replaceAll("..", "");
    let file = clean ? path.join(webDist, clean) : indexPath;
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = indexPath;
    const data = await fsp.readFile(file);
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" },
    });
  };

  // 0.0.0.0, not 127.0.0.1: lets a phone/tablet on the same Wi-Fi open the
  // Stage display, Remote or Stream overlay directly — not just this machine.
  return new Promise((resolve) => {
    serve({ fetch: handler, port: 0, hostname: "0.0.0.0" }, (info) => resolve(info.port));
  });
}
