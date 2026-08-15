/**
 * Import Nigerian gospel lyrics from public lyrics sites into the library.
 *
 * Sources (WordPress REST APIs):
 *   - gospellyricsng.com - category "lyrics" (thousands of songs, "Song – Artist" titles)
 *   - 9jalyrics.com.ng - category "gospel-lyrics" ("PREFIX: Artist – “Song”" titles)
 *
 * Usage (from packages/web, DATABASE_URL must point at the app DB):
 *   bun src/api/import-lyrics.ts               # newest 1000 from gospellyricsng + all 9jalyrics gospel
 *   bun src/api/import-lyrics.ts --limit 200   # cap gospellyricsng posts
 *   bun src/api/import-lyrics.ts --all         # everything (~5k songs)
 *
 * Existing songs are never touched: duplicates are skipped by normalized
 * title+artist. Lyrics remain in the local database only.
 */

import { db } from "./database";
import * as schema from "./database/schema";
import { createSongWithSections } from "./lib/songs";
import { parseStructure } from "./lib/structure";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";

type WpPost = { id: number; link: string; title: { rendered: string }; content: { rendered: string } };

async function fetchJson<T>(url: string, tries = 5): Promise<T> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
      if (!r.ok) throw new Error(`${r.status}`);
      return (await r.json()) as T;
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((res) => setTimeout(res, 1200 * (i + 1)));
    }
  }
  throw new Error("unreachable");
}

async function fetchPosts(base: string, query: string, limit: number): Promise<WpPost[]> {
  const out: WpPost[] = [];
  for (let page = 1; out.length < limit; page++) {
    const perPage = Math.min(100, limit - out.length);
    let batch: WpPost[];
    try {
      batch = await fetchJson<WpPost[]>(`${base}/wp-json/wp/v2/posts?${query}&per_page=${perPage}&page=${page}`);
    } catch {
      break; // past the last page (WP returns 400) or site unreachable
    }
    if (!Array.isArray(batch) || !batch.length) break;
    out.push(...batch);
    if (batch.length < perPage) break;
  }
  return out;
}

/* ---------------- HTML → plain lyrics text ---------------- */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: " - ", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (_, name) => NAMED_ENTITIES[name.toLowerCase()] ?? `&${name};`);
}

/** Lines that are site chrome / promo, not lyrics. */
const JUNK_LINE =
  /https?:\/\/|www\.|download (mp3|audio|song)|watch (the )?video|stream (it|on)|available on|subscribe|follow (us|@)|instagram|facebook|twitter|youtube|spotify|apple music|audiomack|boomplay|itunes|listen (and|to|below)|video below|lyrics below|check out|kindly share|drop a comment|©|copyright/i;

function htmlToLyrics(html: string): string {
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

/* ---------------- Title parsing ---------------- */

const DASHES = /\s+[– - -]\s+/;

/** "Judah – Dunsin Oyekan" → song first, artist after the dash. */
function parseGlnTitle(raw: string): { title: string; artist: string | null } {
  const t = decodeEntities(raw).replace(/\s*lyrics\s*$/i, "").trim();
  const parts = t.split(DASHES);
  if (parts.length >= 2) return { title: parts[0].trim(), artist: parts.slice(1).join(" – ").trim() };
  return { title: t, artist: null };
}

/** `GOSPEL LYRICS: Sinach – “Matchless Love”` → quoted part is the song, rest is artist(s). */
function parse9jaTitle(raw: string): { title: string; artist: string | null } {
  let t = decodeEntities(raw).trim();
  t = t.replace(/^[^:]*lyrics[^:]*:\s*/i, ""); // strip "GOSPEL LYRICS:" style prefixes
  t = t.replace(/\s*\[[^\]]*\]\s*/g, " ").replace(/\s*\([^)]*\)\s*/g, " ").trim(); // drop [Gospel Music] etc.
  const quoted = t.match(/[“"]([^”"]+)[”"]/);
  if (quoted) {
    const artist = t.replace(quoted[0], "").replace(DASHES, " ").replace(/\s+/g, " ").trim().replace(/^[– - -]|[– - -]$/g, "").trim();
    return { title: quoted[1].trim(), artist: artist || null };
  }
  const parts = t.split(DASHES);
  if (parts.length >= 2) return { title: parts.slice(1).join(" – ").trim(), artist: parts[0].trim() };
  return { title: t, artist: null };
}

const normKey = (title: string, artist: string | null) =>
  `${title}|${artist ?? ""}`.toLowerCase().replace(/[^a-z0-9|]+/g, "");

/* ---------------- main ---------------- */

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const limitArg = args.indexOf("--limit");
  const glnLimit = all ? 10000 : limitArg >= 0 ? Number(args[limitArg + 1]) : 1000;

  // Existing songs → dedupe keys
  const existing = await db.select().from(schema.songs);
  const seen = new Set(
    existing.map((s) => normKey(s.title, s.authors ? (JSON.parse(s.authors) as string[])[0] ?? null : null)),
  );
  console.log(`Library has ${existing.length} songs. Fetching…`);

  const sources: { name: string; posts: WpPost[]; parse: (t: string) => { title: string; artist: string | null } }[] = [];

  const gln = await fetchPosts("https://gospellyricsng.com", "categories=20", glnLimit);
  console.log(`gospellyricsng: ${gln.length} posts`);
  sources.push({ name: "gospellyricsng", posts: gln, parse: parseGlnTitle });

  const nja = await fetchPosts("https://9jalyrics.com.ng", "categories=53", 10000);
  console.log(`9jalyrics gospel: ${nja.length} posts`);
  sources.push({ name: "9jalyrics", posts: nja, parse: parse9jaTitle });

  let added = 0, skipped = 0, empty = 0;
  for (const src of sources) {
    for (const post of src.posts) {
      const { title, artist } = src.parse(post.title.rendered);
      if (!title) { empty++; continue; }
      const key = normKey(title, artist);
      if (seen.has(key)) { skipped++; continue; }

      const text = htmlToLyrics(post.content.rendered);
      const sections = parseStructure(text, title);
      // Guard against pages that are mostly promo: need real lyric content.
      const totalChars = sections.reduce((n, s) => n + s.lyrics.length, 0);
      if (!sections.length || totalChars < 60) { empty++; continue; }

      await createSongWithSections({
        title,
        authors: artist ? [artist] : undefined,
        tags: ["gospel", src.name],
        sections,
        source: "import",
      });
      seen.add(key);
      added++;
      if (added % 100 === 0) console.log(`  …${added} imported`);
    }
  }

  const total = await db.select().from(schema.songs);
  console.log(`Done. Added ${added}, skipped ${skipped} duplicates, ${empty} empty/promo-only. Library: ${total.length} songs.`);
}

await main();
