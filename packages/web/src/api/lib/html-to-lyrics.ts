/**
 * Turn a lyrics webpage's raw HTML into plain lyric text - the same rough,
 * regex-based approach import-lyrics.ts already used for the two Nigerian
 * gospel sites it scrapes in bulk, pulled out here so the live "import from a
 * link" endpoint can reuse it against an arbitrary URL instead of a fixed
 * WordPress REST API.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: " - ", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (_, name) => NAMED_ENTITIES[name.toLowerCase()] ?? `&${name};`);
}

/** Lines that are site chrome / promo, not lyrics. */
const JUNK_LINE =
  /https?:\/\/|www\.|download (mp3|audio|song)|watch (the )?video|stream (it|on)|available on|subscribe|follow (us|@)|instagram|facebook|twitter|youtube|spotify|apple music|audiomack|boomplay|itunes|listen (and|to|below)|video below|lyrics below|check out|kindly share|drop a comment|©|copyright/i;

export function htmlToLyrics(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<figure[\s\S]*?<\/figure>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h\d|li|blockquote)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  const decoded = decodeEntities(text);
  const lines = decoded.split("\n").map((l) => l.replace(/\s+/g, " ").trim());
  const kept = lines.filter((l) => !JUNK_LINE.test(l));
  // Collapse 3+ blank lines and trim
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Pull `<title>` (or og:title as a fallback) out of a page's raw HTML. */
export function extractPageTitle(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return decodeEntities(og[1]).replace(/\s*lyrics\s*$/i, "").trim();
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (t?.[1]) return decodeEntities(t[1]).replace(/\s*lyrics\s*$/i, "").replace(/\s*[|–-].*$/, "").trim();
  return null;
}
