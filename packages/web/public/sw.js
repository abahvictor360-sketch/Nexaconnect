/*
 * Vifug service worker.
 *
 * Its whole job is to make the app open. A church hall's wifi drops, a phone
 * on a stand loses signal between songs, and an operator who reloads at the
 * wrong moment should not be looking at a browser error page with a
 * congregation waiting. Everything the app needs to boot is served from the
 * cache; everything that is actually live still goes to the network.
 *
 * What is deliberately NOT cached:
 *
 *   /api  - live state, the remote's commands, settings, the media list. A
 *           stale answer here is worse than no answer: it would show the
 *           congregation the previous slide and tell the operator it worked.
 *   SSE / long-poll - the same, and a service worker sitting in front of a
 *           never-ending response stream is a good way to break it.
 *
 * The app shell is cache-first because Vite fingerprints every asset, so a
 * cached one can never be the wrong version - the filename changes when the
 * contents do. index.html is the exception and is network-first: it is the
 * one unfingerprinted file, and serving a stale copy would pin the browser to
 * a deployment that no longer exists.
 */

const VERSION = "v1";
const SHELL = `vifug-shell-${VERSION}`;
const ASSETS = `vifug-assets-${VERSION}`;

/** The least that has to be present for the app to render something. */
const PRECACHE = ["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // Individually, so one missing file does not fail the whole install and
      // leave the app with no service worker at all.
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Anything that must never be answered from a cache. */
function isLive(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname === "/api" ||
    url.pathname.startsWith("/stream") ||
    url.searchParams.has("sse")
  );
}

/** Fingerprinted build output - safe to keep forever. */
function isImmutableAsset(url) {
  return url.pathname.startsWith("/assets/") || /\.[0-9a-f]{8,}\.(js|css|woff2?)$/i.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Other origins (fonts, the analytics tag) are left entirely alone: they
  // have their own caching rules and are not ours to second-guess.
  if (url.origin !== self.location.origin) return;
  if (isLive(url)) return;

  // A navigation is the moment that decides whether the app opens at all.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/").then((hit) => hit ?? Response.error())),
    );
    return;
  }

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(ASSETS).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  /*
   * Everything else - the Bible JSON, icons, the favicon. Served from cache
   * when it is there and refreshed in the background, so a Bible book opens
   * instantly on the second look and still picks up a corrected text.
   */
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(ASSETS).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit ?? Response.error());
      return hit ?? network;
    }),
  );
});
