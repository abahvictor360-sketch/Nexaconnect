"use strict";

/**
 * Download redirect: /api/download?p=win | mac | linux
 *
 * The landing page links here rather than at the release host directly, so the
 * page a visitor reads never names where the builds are kept. The redirect is
 * resolved fresh each time, which also means the buttons keep working across
 * releases without anyone editing the HTML.
 */

const { latestRelease, assetFor } = require("./_release");

module.exports = async function handler(req, res) {
  const platform = (req.query && req.query.p) || "win";

  try {
    const release = await latestRelease();
    const url = assetFor(release, platform);
    if (!url) {
      res.status(404).send("No build is available for that platform yet.");
      return;
    }
    // 302 rather than 301: the target changes with every release, and a
    // permanent redirect would be cached by browsers long past its usefulness.
    res.setHeader("Cache-Control", "public, max-age=300");
    res.redirect(302, url);
  } catch (err) {
    console.error("[download] " + (err && err.message));
    res.status(503).send("Downloads are briefly unavailable. Please try again shortly.");
  }
};
