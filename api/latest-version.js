"use strict";

/**
 * Update feed: /api/latest-version
 *
 * The installed app asks this instead of the release host, so a copy of the
 * app carries no reference to where its source is kept. Only what the update
 * prompt actually needs is returned - version, title, notes - and never the
 * repository's own address.
 */

const { latestRelease } = require("./_release");

module.exports = async function handler(req, res) {
  // The desktop app runs from a local origin (127.0.0.1) rather than the site,
  // so its update check is a cross-origin request and needs to be allowed.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const rel = await latestRelease();
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json({
      tag: rel.tag,
      name: rel.name,
      notes: rel.notes,
      publishedAt: rel.publishedAt,
      // Where to send someone who wants the update: the site's own download
      // section, never the release host.
      url: "https://vifug.com/#download",
    });
  } catch (err) {
    console.error("[latest-version] " + (err && err.message));
    return res.status(503).json({ error: "Update information is unavailable right now." });
  }
};
