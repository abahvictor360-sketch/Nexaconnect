/**
 * Pulling the lyrics out of a lyrics webpage.
 *
 * The hard part is not turning HTML into text - it is deciding which text.
 * A hymn page is mostly not the hymn: navigation, tune lists, scripture
 * references, related songs, publisher metadata, comments, adverts. Flattening
 * the whole document and deleting lines that look like junk keeps all of it,
 * because most of a page is not obviously junk line by line; it only looks
 * wrong next to the words of the song.
 *
 * So the page is searched for the block that actually holds the lyric, in two
 * ways. First the containers that reliably hold one - a handful of attributes
 * and ids used by the sites people import from. Failing that, every block of
 * text is scored on how much it behaves like a lyric: short lines, stanza
 * breaks, few full stops, almost no links. Verse behaves differently from
 * prose, and that difference is measurable.
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
  /https?:\/\/|www\.|download (mp3|audio|song)|watch (the )?video|stream (it|on)|available on|subscribe|follow (us|@)|instagram|facebook|twitter|youtube|spotify|apple music|audiomack|boomplay|itunes|listen (and|to|below)|video below|lyrics below|check out|kindly share|drop a comment|©|copyright|all rights reserved/i;

/**
 * Wrappers that never contain the song. Removed whole rather than filtered
 * line by line, since their contents are ordinary words that no line-level
 * rule can tell from a lyric.
 */
const CHROME_TAGS = [
  "script", "style", "noscript", "iframe", "svg", "form", "button", "select",
  "nav", "header", "footer", "aside", "figure", "figcaption", "table",
];

function stripChrome(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of CHROME_TAGS) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
  }
  return out;
}

/**
 * The inner HTML of the element starting at `openIdx`, found by counting
 * nested open and close tags of the same name.
 *
 * Regex alone cannot do this: a lyric container holds other divs, and a
 * non-greedy match stops at the first `</div>` - which is usually the end of
 * the first stanza rather than the end of the song.
 */
function innerHtmlAt(html: string, openIdx: number, tag: string): string | null {
  const openEnd = html.indexOf(">", openIdx);
  if (openEnd === -1) return null;
  // A self-closing container has no contents to take.
  if (html[openEnd - 1] === "/") return "";

  const re = new RegExp(`<(\\/?)${tag}\\b`, "gi");
  re.lastIndex = openEnd;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(openEnd + 1, m.index);
  }
  return null; // unbalanced markup - fall back to scoring the page
}

/**
 * Containers that hold the song itself on sites people actually import from.
 * Tried in order; the first that yields enough text wins.
 */
const KNOWN_CONTAINERS: { pattern: RegExp; tag: string }[] = [
  // RDFa: hymnary.org and other library sites mark the work's text this way.
  { pattern: /<div\b[^>]*\bproperty\s*=\s*["']text["'][^>]*>/i, tag: "div" },
  { pattern: /<div\b[^>]*\bid\s*=\s*["']at_fulltext["'][^>]*>/i, tag: "div" },
  // Common lyric-site conventions.
  { pattern: /<div\b[^>]*\bclass\s*=\s*["'][^"']*\b(lyric|lyrics|songtext|song-text|entry-content)\b[^"']*["'][^>]*>/i, tag: "div" },
  { pattern: /<section\b[^>]*\bclass\s*=\s*["'][^"']*\blyrics?\b[^"']*["'][^>]*>/i, tag: "section" },
  { pattern: /<pre\b[^>]*>/i, tag: "pre" },
];

function findKnownContainer(html: string): string | null {
  for (const { pattern, tag } of KNOWN_CONTAINERS) {
    const m = pattern.exec(html);
    if (!m || m.index === undefined) continue;
    const inner = innerHtmlAt(html, m.index, tag);
    // Guard against matching an empty or near-empty wrapper.
    if (inner && toLines(inner).join("\n").trim().length > 120) return inner;
  }
  return null;
}

/** HTML fragment to trimmed text lines, preserving line and stanza breaks. */
function toLines(html: string): string[] {
  const text = html
    // Newlines in the source are whitespace, not content - HTML says so, and
    // pages are written accordingly: a line typically ends "<br />\n". Turning
    // the tag into a newline without first flattening the source one yields a
    // blank line after every single line, which reads as one stanza per line
    // and imports the song as a stack of one-line verses.
    .replace(/\r?\n/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h\d|li|blockquote|tr)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim());
}

/**
 * How much a run of lines reads like sung verse rather than prose or a list.
 *
 * Lyrics are short lines that mostly do not end in a full stop, repeat in
 * shape, and contain almost no links or digits. Prose runs long and
 * punctuated; navigation is short but link-dense and repetitive in a
 * different way. Returning a score rather than a yes/no lets the best block
 * win even on a page where nothing is a perfect match.
 */
function lyricScore(lines: string[]): number {
  const real = lines.filter(Boolean);
  if (real.length < 4) return 0;

  const lens = real.map((l) => l.length);
  const median = lens.slice().sort((a, b) => a - b)[Math.floor(lens.length / 2)] ?? 0;
  const shortish = real.filter((l) => l.length >= 8 && l.length <= 70).length / real.length;
  const terminal = real.filter((l) => /[.!?:;]$/.test(l)).length / real.length;
  const junk = real.filter((l) => JUNK_LINE.test(l)).length / real.length;
  const numeric = real.filter((l) => /^\W*\d+\W*$/.test(l)).length / real.length;

  let score = 0;
  score += shortish * 2.5;                                  // verse-shaped lines
  score += median >= 12 && median <= 60 ? 1.5 : 0;          // typical sung line
  score += (1 - terminal) * 1.5;                            // verse rarely ends in a stop
  score -= junk * 4;                                        // promo/nav content
  score -= numeric * 2;                                     // list of numbers, not a song
  // Length matters, but a whole page should not beat a real stanza block just
  // by being bigger - so it is damped hard.
  score += Math.min(Math.log10(real.length + 1), 1.6) * 0.6;
  return score;
}

/**
 * Split flattened text into blocks on blank lines, then keep the best-scoring
 * run of consecutive blocks. Lyrics arrive as several stanzas separated by
 * blanks, so the answer is usually a run rather than one block.
 */
function bestRegion(lines: string[]): string[] {
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const line of lines) {
    if (line) cur.push(line);
    else if (cur.length) { blocks.push(cur); cur = []; }
  }
  if (cur.length) blocks.push(cur);
  if (!blocks.length) return [];

  const scores = blocks.map((b) => lyricScore(b));
  const STRONG = 1.2;
  // A stanza has to be a few lines before it can be recognised as one, so a
  // two-line refrain or a lone "Chorus" scores nothing. Those sit between the
  // verses, and treating them as the end of the song truncates it halfway -
  // which is exactly what happened. Runs therefore step over short gaps and
  // stop only at a stretch of material that is clearly something else.
  const MAX_GAP = 3;

  let best = { from: 0, to: 0, total: -Infinity };
  for (let i = 0; i < blocks.length; i++) {
    if ((scores[i] ?? 0) < STRONG) continue; // a run must begin on a real stanza
    let total = 0;
    let gap = 0;
    for (let j = i; j < blocks.length; j++) {
      const s = scores[j] ?? 0;
      if (s >= STRONG) {
        total += s;
        gap = 0;
        if (total > best.total) best = { from: i, to: j, total };
      } else if (++gap > MAX_GAP) {
        break;
      }
    }
  }
  if (best.total === -Infinity) return [];

  const out: string[] = [];
  for (let i = best.from; i <= best.to; i++) {
    const block = blocks[i] ?? [];
    // Bridged blocks are kept only when they read like part of the song. A
    // short line between verses is usually a refrain cue and belongs; a long
    // one is metadata that happened to fall between them and does not.
    const strong = (scores[i] ?? 0) >= STRONG;
    if (!strong && block.some((l) => l.length > 80)) continue;
    if (out.length) out.push("");
    out.push(...block);
  }
  return out;
}

/**
 * Stanza numbers printed hard against the first word ("1When we walk") are a
 * typography convention, not part of the line. Split so the number becomes a
 * stanza break, which is what the song importer already understands.
 */
function normaliseStanzaNumbers(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const m = /^(\d{1,2})\s*([A-Z"'“‘].*)$/.exec(line);
    if (m && m[2]) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push(m[2]);
    } else {
      out.push(line);
    }
  }
  return out;
}

export function htmlToLyrics(html: string): string {
  const cleaned = stripChrome(html);

  // A container we recognise is trusted outright; scoring only has to guess
  // when we do not know the site.
  const known = findKnownContainer(cleaned);
  const lines = known ? toLines(known) : toLines(cleaned);

  const region = known ? lines : bestRegion(lines);
  const kept = normaliseStanzaNumbers(
    (region.length ? region : lines).filter((l) => !JUNK_LINE.test(l)),
  );

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
