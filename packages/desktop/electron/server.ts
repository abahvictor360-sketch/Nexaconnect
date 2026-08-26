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
 * Preferred listening port. Stable across launches so companion-screen URLs
 * (stage display, phone remote, OBS browser source) stay valid once set up.
 */
export const PREFERRED_PORT = 7373;

/**
 * What a browser is allowed to keep.
 *
 * This matters most for phones. The app is a hash-named-asset SPA, so
 * index.html is the one file that must never be cached: a phone holding an
 * old copy keeps requesting the asset hashes that copy references, and goes
 * on running a build from before the operator updated the desktop app -
 * indefinitely, with no way for anyone to tell. Serving no cache headers at
 * all (which is what this did) leaves it to the browser's heuristics, and
 * mobile browsers happily cache a 200 with no validators.
 *
 * The hashed assets are the opposite case: their names change whenever their
 * contents do, so they can be kept for a year. Bible books sit in between -
 * large, and only ever replaced by an app update - so they get a day.
 */
function cacheControlFor(file: string, ext: string): string {
  if (ext === ".html") return "no-store, must-revalidate";
  if (/[.-][0-9a-zA-Z_-]{8,}\.(js|css|mjs|woff2?)$/.test(path.basename(file))) {
    return "public, max-age=31536000, immutable";
  }
  /*
   * Bible BOOKS can be held: a book's contents never change for a given
   * version id, and they are a few MB each.
   *
   * The manifest cannot. It is the index of which versions exist, so it
   * changes every time a translation is added - and caching it for a day
   * meant a freshly installed build kept listing yesterday's versions while
   * happily serving the new one's files. Adding The Message looked like it
   * had silently failed for exactly this reason.
   */
  const base = path.basename(file);
  if (file.includes(`${path.sep}bible${path.sep}`) && base !== "manifest.json") {
    return "public, max-age=86400";
  }
  return "no-cache";
}

/**
 * Embedded production server: serves the static web bundle and mounts the
 * Hono API from packages/web, backed by a local SQLite file in userData.
 * Returns the port it is actually listening on.
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
    const ext = path.extname(file).toLowerCase();
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Cache-Control": cacheControlFor(file, ext),
      },
    });
  };

  // 0.0.0.0, not 127.0.0.1: lets a phone/tablet on the same Wi-Fi open the
  // Stage display, Remote or Stream overlay directly - not just this machine.
  //
  // A fixed port is tried first so companion-screen URLs stay the same between
  // launches: an operator can bookmark the remote on a phone, or tape the
  // address to the sound desk, and it keeps working tomorrow. An OS-assigned
  // port would change every start. If something else already holds the port
  // (a second copy of the app, or an unrelated service) we fall back rather
  // than refuse to launch.
  return new Promise((resolve, reject) => {
    const listen = (port: number, isFallback: boolean) => {
      const server = serve({ fetch: handler, port, hostname: "0.0.0.0" }, (info) => resolve(info.port));
      server.on("error", (err: NodeJS.ErrnoException) => {
        if (isFallback) return reject(err);
        if (err.code !== "EADDRINUSE") return reject(err);
        listen(0, true);
      });
    };
    listen(PREFERRED_PORT, false);
  });
}
