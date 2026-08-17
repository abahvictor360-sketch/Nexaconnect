"use strict";

/**
 * Where release builds come from.
 *
 * The installers live on a release host, but nothing the public receives -
 * neither the landing page nor the app itself - should have to name it. Both
 * ask vifug.com instead, and this module is the single place that knows the
 * real location. Move the builds elsewhere later and only this file changes.
 *
 * Environment variables:
 *   RELEASE_REPO   "owner/name" of the repository holding the releases.
 *                  Defaults to the current one so nothing breaks if unset.
 *   RELEASE_TOKEN  A read-only token. Only required once the repository is
 *                  private - anonymous API calls stop working at that point,
 *                  and downloads and update checks would fail without it.
 */

const REPO = process.env.RELEASE_REPO || "abahvictor360-sketch/vifug-lyrics";
const TOKEN = process.env.RELEASE_TOKEN || "";

/** Assets are matched by extension, so renaming a build does not break links. */
const PLATFORM_EXT = {
  win: ".exe",
  windows: ".exe",
  mac: ".dmg",
  macos: ".dmg",
  linux: ".appimage",
};

let cached = null;
let cachedAt = 0;
// Five minutes. Long enough that a busy download page does not burn through
// the API's hourly allowance, short enough that a new release appears quickly.
const TTL_MS = 5 * 60 * 1000;

/** The newest published release, or null when it cannot be determined. */
async function latestRelease() {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;

  const headers = { Accept: "application/vnd.github+json", "User-Agent": "vifug-site" };
  if (TOKEN) headers.Authorization = "Bearer " + TOKEN;

  const res = await fetch("https://api.github.com/repos/" + REPO + "/releases/latest", { headers });
  if (!res.ok) {
    // A stale answer beats no answer: if the allowance is exhausted or the
    // repository has just been made private, keep serving what we last saw
    // rather than breaking every download button on the site.
    if (cached) return cached;
    throw new Error("release lookup failed: " + res.status);
  }

  const rel = await res.json();
  cached = {
    tag: rel.tag_name || "",
    name: (rel.name || rel.tag_name || "").trim(),
    notes: (rel.body || "").trim(),
    publishedAt: rel.published_at || null,
    assets: Array.isArray(rel.assets)
      ? rel.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size }))
      : [],
  };
  cachedAt = Date.now();
  return cached;
}

/** The download URL for a platform key, or null when there is no such build. */
function assetFor(release, platform) {
  const ext = PLATFORM_EXT[String(platform || "").toLowerCase()];
  if (!ext) return null;
  const hit = release.assets.find((a) => a.name.toLowerCase().endsWith(ext));
  return hit ? hit.url : null;
}

module.exports = { latestRelease, assetFor, PLATFORM_EXT };
