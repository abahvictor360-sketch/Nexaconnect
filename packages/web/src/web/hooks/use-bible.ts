import { useQuery } from "@tanstack/react-query";

/**
 * Offline Bible data layer.
 *
 * Text ships as static JSON under /bible (public dir), lazy-loaded per book so
 * the app stays offline-first and fast. Nothing hits the network beyond the
 * app's own origin.
 *
 *   /bible/manifest.json          -> versions + canon (book codes, chapter counts)
 *   /bible/<version>/<CODE>.json  -> { c: { "1": ["v1", "v2", ...] } }
 */

export type CanonBook = { code: string; name: string; testament: "OT" | "NT" };
export type BibleVersion = {
  id: string;
  label: string;
  /** Short form shown in pickers and beside a reference. See versionAbbr(). */
  abbr?: string;
  language: string;
  lang: string;
  books: string[];
  chapterCounts: Record<string, number>;
};
export type BibleManifest = { canon: CanonBook[]; versions: BibleVersion[] };

/**
 * Casing for abbreviations that are not simply the id upper-cased.
 * NIrV keeps its lowercase "r" - "NIRV" is wrong, not merely ugly.
 */
const ABBR_CASE: Record<string, string> = { nirv: "NIrV" };

/**
 * The short form of a version's name: "MSG", not "The Message (MSG)".
 *
 * Labels grew inconsistent as versions were added - some are already bare
 * abbreviations ("KJV"), some pair a name with one ("Berean (BSB)"), some are
 * a language ("Asante Twi"). None of those belong beside a reference on a
 * projected slide, where the operator wants "John 3:16 (MSG)" and nothing
 * longer. Every version id happens to already BE its abbreviation, so that is
 * the fallback; an explicit `abbr` in the manifest wins when present.
 */
export function versionAbbr(v: { id: string; abbr?: string }): string {
  return v.abbr ?? ABBR_CASE[v.id] ?? v.id.toUpperCase();
}

export type BookData = { c: Record<string, string[]> };

const bookCache = new Map<string, Promise<BookData>>();

export function loadBook(versionId: string, code: string): Promise<BookData> {
  const key = `${versionId}/${code}`;
  let p = bookCache.get(key);
  if (!p) {
    p = fetch(`/bible/${versionId}/${code}.json`).then((r) => {
      if (!r.ok) throw new Error(`bible book ${key} ${r.status}`);
      return r.json() as Promise<BookData>;
    });
    bookCache.set(key, p);
  }
  return p;
}

export function useBibleManifest() {
  return useQuery({
    queryKey: ["bible", "manifest"],
    staleTime: Infinity,
    queryFn: async () => {
      const r = await fetch("/bible/manifest.json");
      if (!r.ok) throw new Error("bible manifest missing");
      return (await r.json()) as BibleManifest;
    },
  });
}

/** Load a single chapter (array of verse strings, index 0 = verse 1). */
export function useChapter(versionId: string | null, code: string | null, chapter: number | null) {
  return useQuery({
    queryKey: ["bible", "chapter", versionId, code, chapter],
    enabled: !!versionId && !!code && !!chapter,
    staleTime: Infinity,
    queryFn: async () => {
      const book = await loadBook(versionId!, code!);
      return book.c[String(chapter)] ?? [];
    },
  });
}

/** Canonical name lookup by code, from a manifest. */
export function bookName(manifest: BibleManifest | undefined, code: string): string {
  return manifest?.canon.find((b) => b.code === code)?.name ?? code;
}

/* ---------------- Reference parsing ---------------- */

export type ParsedRef = { code: string; chapter: number; verse: number; endVerse: number | null };

/**
 * Parse a free-text reference like "John 3:16", "john 3 16", "1 John 2:3-5",
 * "Gen 1", "ps 23.1", "john 3v16". Chapter and verse may be separated by a
 * colon, period, space, or "v"/"vs". Matches against the canon's English
 * names + common short forms.
 */
export function parseReference(input: string, manifest: BibleManifest): ParsedRef | null {
  const q = input.trim();
  const m = q.match(/^(\d?\s*[A-Za-z. ]+?)\s*(\d+)(?:\s*(?:[:.]|vs?\.?|\s)\s*(\d+)(?:\s*[-–]\s*(\d+))?)?\s*$/i);
  if (!m) return null;
  const rawBook = m[1].replace(/\.$/, "").trim().toLowerCase().replace(/\s+/g, " ");
  const chapter = parseInt(m[2], 10);
  const verse = m[3] ? parseInt(m[3], 10) : 1;
  const endVerse = m[4] ? parseInt(m[4], 10) : null;

  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  // exact, then startsWith, then loose contains (min 3 chars)
  let hit =
    manifest.canon.find((b) => norm(b.name) === rawBook) ||
    manifest.canon.find((b) => norm(b.name).startsWith(rawBook)) ||
    manifest.canon.find((b) => norm(b.name).replace(/\s+/g, "").startsWith(rawBook.replace(/\s+/g, ""))) ||
    (rawBook.length >= 3 ? manifest.canon.find((b) => norm(b.name).includes(rawBook)) : undefined) ||
    manifest.canon.find((b) => b.code.toLowerCase() === rawBook.replace(/\s+/g, ""));
  if (!hit) return null;
  return { code: hit.code, chapter, verse, endVerse };
}

export type SearchHit = { code: string; name: string; chapter: number; verse: number; text: string };

/**
 * Keyword search across a whole version (loads every book once, cached).
 * Returns up to `limit` hits. Runs fully offline.
 */
export async function searchVersion(
  version: BibleVersion,
  manifest: BibleManifest,
  query: string,
  limit = 60,
): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const books = await Promise.all(version.books.map((code) => loadBook(version.id, code).then((d) => ({ code, d }))));
  const hits: SearchHit[] = [];
  for (const { code, d } of books) {
    const name = bookName(manifest, code);
    for (const [ch, verses] of Object.entries(d.c)) {
      for (let i = 0; i < verses.length; i++) {
        const text = verses[i];
        if (text && text.toLowerCase().includes(q)) {
          hits.push({ code, name, chapter: Number(ch), verse: i + 1, text });
          if (hits.length >= limit) return hits;
        }
      }
    }
  }
  return hits;
}
