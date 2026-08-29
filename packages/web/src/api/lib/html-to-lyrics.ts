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

/**
 * Lines that are site chrome / promo, not lyrics.
 *
 * Two families. The first is promotion, which lyric blogs wrap around the song
 * - download links, streaming platforms, "kindly share". The second is the
 * furniture lyric sites print immediately above and below the words, inside
 * the same container as the song, where no structural rule can reach it:
 * credits lines, correction prompts, embed buttons, "you might also like".
 */
const JUNK_LINE =
  /https?:\/\/|www\.|download (mp3|audio|song)|watch (the )?video|stream (it|on)|available on|subscribe|follow (us|@)|instagram|facebook|twitter|youtube|spotify|apple music|audiomack|boomplay|itunes|listen (and|to|below)|video below|lyrics below|check out|kindly share|drop a comment|©|copyright|all rights reserved/i;

/**
 * Boilerplate printed inside the lyric container itself.
 *
 * Sites put credit lines, correction prompts and embed buttons in the same
 * element as the song, where no structural rule can reach them.
 *
 * Every pattern is anchored to the start of a line and every credit needs its
 * label punctuation, because these words are perfectly good lyrics otherwise:
 * a song may sing about a writer or a label, but it does not open a line with
 * "Writer:". Section headings are deliberately NOT here - structure.ts reads
 * "Verse 2" and "Chorus" to build the song's sections, so stripping them would
 * flatten every import into a single verse.
 */
const BOILERPLATE_LINE =
  /^\s*(?:writers?|written by|composers?|producers?|produced by|lyricist|published by|publisher|label|album|released|release date|genre|duration|submitted by|corrections?|source|track)\s*[:\-–]|^\s*(?:submit corrections?|add to playlist|you might also like|get tickets|embed|advertisement|sponsored|share this|related (?:songs?|posts?|lyrics)|more from|read more|print|report a problem|edit lyrics|add a translation|translations?)\s*$/i;

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
 * Class and id tokens that mark an element as not-the-song.
 *
 * Compared as whole tokens, never as substrings of the attribute. That
 * distinction is the entire lesson of this function: an earlier version tested
 * a regex against the raw attribute, and WordPress writes
 * `class="post type-post ... tag-dunsin-oyekan"` on the article holding the
 * song, so a rule meant for a tag CLOUD matched the tag LIST and deleted the
 * article - lyrics and all. What survived was the page furniture, which is
 * precisely what got imported.
 */
const CHROME_TOKENS = new Set([
  "ad", "ads", "adsbygoogle", "advert", "advertisement", "banner",
  "share", "shares", "sharing", "sharedaddy", "social", "reblog",
  "related", "jp-relatedposts", "recommended", "recommendations",
  "comment", "comments", "commentlist", "comment-form", "respond", "disqus",
  "breadcrumb", "breadcrumbs", "sidebar", "widget", "widget-area",
  "promo", "newsletter", "subscribe", "subscription", "follow",
  "cookie", "consent", "popup", "modal",
  "menu", "navbar", "nav-links", "navigation", "post-navigation", "pagination",
  "tags", "tag-cloud", "tagcloud", "author-box", "post-meta", "entry-meta",
  "entry-footer", "site-description", "site-header", "site-footer",
  "wpcom-actionbar", "actionbar", "jp-carousel", "sharing-hidden",
  "playlist", "toolbar", "skip-link", "screen-reader-text",
]);

/** Prefixes that are chrome whatever follows them. */
const CHROME_PREFIXES = ["wpcom-", "jp-relatedposts", "sharedaddy", "sd-", "a8c-"];

/** Does this element's own class/id mark it as chrome? */
function isChromeTag(openTag: string): boolean {
  const attrs = [...openTag.matchAll(/\b(?:class|id)\s*=\s*["']([^"']*)["']/gi)];
  for (const a of attrs) {
    for (const token of (a[1] ?? "").split(/\s+/)) {
      const t = token.trim().toLowerCase();
      if (!t) continue;
      if (CHROME_TOKENS.has(t)) return true;
      if (CHROME_PREFIXES.some((pre) => t.startsWith(pre))) return true;
    }
  }
  return false;
}

/**
 * Drop chrome elements whole, matching open to close by depth.
 *
 * Depth counting matters: these wrappers nest, and a non-greedy match to the
 * first closing tag leaves the tail of a share bar behind, which then reads as
 * a stanza.
 *
 * The caller checks how much text this removed and discards the result if it
 * took too much - see htmlToLyrics. A stripper that can delete the article is
 * worse than no stripper at all, so it is not trusted on its own.
 */
function stripChromeElements(html: string): string {
  const OPEN = /<(div|section|aside|ul|ol|span|p|nav|form)\b[^>]*>/gi;
  let out = html;
  // Bounded: each pass removes the outermost matches and nested ones go with
  // them; the cap stops a pathological document looping.
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    OPEN.lastIndex = 0;
    for (let m = OPEN.exec(out); m; m = OPEN.exec(out)) {
      if (!isChromeTag(m[0])) continue;
      const tag = (m[1] ?? "").toLowerCase();
      const inner = innerHtmlAt(out, m.index, tag);
      if (inner === null) continue; // unbalanced - leave it for the scorer
      const end = out.indexOf(inner, m.index) + inner.length;
      const close = out.indexOf(">", out.indexOf(`</${tag}`, end));
      if (close === -1) continue;
      out = out.slice(0, m.index) + " " + out.slice(close + 1);
      changed = true;
      OPEN.lastIndex = m.index;
    }
    if (!changed) break;
  }
  return out;
}

/** Rough visible-text length, for deciding whether a strip went too far. */
function textVolume(html: string): number {
  return toLines(html).join(" ").replace(/\s+/g, " ").trim().length;
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
 *
 * Split by how much they promise. A container named for lyrics contains the
 * lyrics and nothing else, so its contents are taken whole. A generic article
 * wrapper only narrows the search: `entry-content` is WordPress's name for the
 * whole post, and on a song blog that post opens with a paragraph about the
 * release, a download link and a streaming embed before the words start.
 * Trusting it outright imported all of that, which is the complaint.
 */
const TRUSTED_CONTAINERS: { pattern: RegExp; tag: string }[] = [
  // RDFa: hymnary.org and other library sites mark the work's text this way.
  { pattern: /<div\b[^>]*\bproperty\s*=\s*["']text["'][^>]*>/i, tag: "div" },
  { pattern: /<div\b[^>]*\bid\s*=\s*["']at_fulltext["'][^>]*>/i, tag: "div" },
  // Named for the song itself, on the sites that do that.
  { pattern: /<div\b[^>]*\bclass\s*=\s*["'][^"']*\b(lyric|lyrics|songtext|song-text|song_lyrics|lyricbox)\b[^"']*["'][^>]*>/i, tag: "div" },
  { pattern: /<section\b[^>]*\bclass\s*=\s*["'][^"']*\blyrics?\b[^"']*["'][^>]*>/i, tag: "section" },
  { pattern: /<div\b[^>]*\bdata-lyrics-container\s*=\s*["']true["'][^>]*>/i, tag: "div" },
  { pattern: /<pre\b[^>]*>/i, tag: "pre" },
];

/** Narrows the search but proves nothing - the winning stanzas are scored out of it. */
const WEAK_CONTAINERS: { pattern: RegExp; tag: string }[] = [
  { pattern: /<div\b[^>]*\bclass\s*=\s*["'][^"']*\b(entry-content|post-content|article-content|td-post-content)\b[^"']*["'][^>]*>/i, tag: "div" },
  { pattern: /<article\b[^>]*>/i, tag: "article" },
];

function findContainer(
  html: string,
  candidates: { pattern: RegExp; tag: string }[],
): string | null {
  for (const { pattern, tag } of candidates) {
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
  const base = stripChrome(html);

  /**
   * Narrow first, strip second.
   *
   * The other order let a chrome rule delete the very element holding the
   * song, and once that was gone the scorer found no stanzas and the page's
   * own furniture was imported in its place. Choosing the container first
   * means a mis-scoped rule can only ever remove something INSIDE the song's
   * container, never the container itself.
   */
  const trusted = findContainer(base, TRUSTED_CONTAINERS);
  const weak = trusted ? null : findContainer(base, WEAK_CONTAINERS);
  const scope = trusted ?? weak ?? base;

  // And even then, do not trust it blindly. If removing "chrome" took most of
  // the text with it, the rules matched something they should not have, and
  // the unstripped scope is the safer answer.
  const before = textVolume(scope);
  const stripped = stripChromeElements(scope);
  const cleaned = before > 0 && textVolume(stripped) < before * 0.4 ? scope : stripped;

  const lines = toLines(cleaned);
  const region = trusted ? lines : bestRegion(lines);

  /**
   * No recognisable song means no import.
   *
   * This used to fall back to every line on the page, on the theory that
   * something is better than nothing. It is not: what arrives is the header,
   * the post navigation and the comment form, filed in the library under the
   * song's name. Returning nothing lets the caller say it could not find the
   * lyrics, which is both true and actionable.
   */
  if (!region.length) return "";

  const kept = normaliseStanzaNumbers(
    region.filter((l) => !JUNK_LINE.test(l) && !BOILERPLATE_LINE.test(l)),
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

/* ---------------- who wrote it ---------------- */

/** The page's own title, untouched, for callers that need to split it. */
function rawPageTitle(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return decodeEntities(og[1]).trim();
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return t?.[1] ? decodeEntities(t[1]).trim() : null;
}

/**
 * Split a credit that names more than one act.
 *
 * Only the featuring forms, which are unambiguous. Not "&" and not a comma:
 * plenty of groups have one in their name, and turning a single act into two
 * is a worse error than leaving two joined - the operator can see the second
 * name either way, but a wrongly split one is filed under a group that does
 * not exist.
 */
function splitCredits(raw: string): string[] {
  return raw
    .split(/\s+(?:ft|ft\.|feat|feat\.|featuring|with)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Tidy a name: strip the label it was printed under, collapse space, cap length. */
function cleanName(raw: string): string {
  return decodeEntities(raw)
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s*(author|composer|writer|words|music|lyrics|by)\s*[:\-–]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** A plausible person or group name, as opposed to a stray fragment of page. */
function looksLikeName(s: string): boolean {
  if (s.length < 2 || s.length > 120) return false;
  if (/https?:\/\//.test(s)) return false;
  // A name is a handful of words, not a sentence.
  if (s.split(/\s+/).length > 8) return false;
  if (/[.!?]$/.test(s)) return false;
  return /[A-Za-z]/.test(s);
}

/** Names from schema.org JSON-LD, which is the most reliable source when present. */
function fromJsonLd(html: string): { title?: string; artists: string[] } {
  const out: { title?: string; artists: string[] } = { artists: [] };
  const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];

  const nameOf = (v: unknown): string[] => {
    if (typeof v === "string") return [v];
    if (Array.isArray(v)) return v.flatMap(nameOf);
    if (v && typeof v === "object") {
      const n = (v as { name?: unknown }).name;
      return typeof n === "string" ? [n] : [];
    }
    return [];
  };

  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    for (const key of ["byArtist", "author", "composer", "lyricist", "creator"]) {
      for (const n of nameOf(o[key])) out.artists.push(n);
    }
    const type = String(o["@type"] ?? "");
    if (!out.title && /Music(Composition|Recording)|Song/i.test(type) && typeof o.name === "string") {
      out.title = o.name;
    }
    // Nested graphs are common; walk everything rather than guess the shape.
    for (const v of Object.values(o)) if (v && typeof v === "object") visit(v);
  };

  for (const b of blocks) {
    try {
      visit(JSON.parse(b[1] ?? ""));
    } catch {
      // A malformed block is not worth failing the whole import over.
    }
  }
  return out;
}

/**
 * Names from RDFa and microdata.
 *
 * Library and hymn sites mark authorship structurally - hymnary wraps the
 * writer in `property="author" typeof="Person"` with the name in a nested
 * `property="name"`. That is schema.org rather than a site quirk, so the same
 * rule reads other catalogues too.
 */
function fromMarkupAttributes(html: string): string[] {
  const found: string[] = [];

  // An element tagged with an authorship role. The name is read from the
  // window that follows it rather than from its contents, because the closing
  // tag is often a long way off - hymnary puts a whole biography inside the
  // author container, so anything that waits for </div> either misses or
  // swallows the prose.
  const opener = /<\w+\b[^>]*\b(?:property|itemprop|rel)\s*=\s*["'][^"']*(?:author|composer|lyricist|byArtist|creator)[^"']*["'][^>]*>/gi;
  for (const m of html.matchAll(opener)) {
    const start = (m.index ?? 0) + m[0].length;
    const window = html.slice(start, start + 400);

    // Preferred: an explicit nested name, which is what schema.org markup uses.
    const named = /<[^>]+\b(?:property|itemprop)\s*=\s*["'](?:name)["'][^>]*>([^<]{1,120})</i.exec(window);
    if (named?.[1]) {
      const candidate = cleanName(named[1]);
      if (looksLikeName(candidate)) { found.push(candidate); continue; }
    }

    // Otherwise the first line of text inside, which covers sites that write
    // the name directly into the tagged element. Only the first text run is
    // taken - beyond that is biography, not a name.
    const firstText = /^[\s\S]{0,200}?>?([^<>]{2,120})</.exec("<" + window);
    const candidate = cleanName(firstText?.[1] ?? "");
    if (looksLikeName(candidate)) found.push(candidate);
  }

  // Meta tags used by music sites and CMSs.
  const metas = [
    /<meta[^>]+(?:property|name)\s*=\s*["'](?:music:musician|og:music:musician|author|article:author|twitter:creator)["'][^>]+content\s*=\s*["']([^"']+)["']/gi,
    /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+(?:property|name)\s*=\s*["'](?:music:musician|og:music:musician|author)["']/gi,
  ];
  for (const re of metas) {
    for (const m of html.matchAll(re)) {
      const candidate = cleanName(m[1] ?? "");
      if (looksLikeName(candidate)) found.push(candidate);
    }
  }

  return found;
}

/**
 * Artist and title split out of a page title like "Artist - Song Lyrics".
 *
 * A guess, and treated as one: only used when nothing structural was found,
 * because the halves can just as easily be the other way round and there is
 * no way to tell from the string alone which is which.
 */
function fromTitleString(raw: string): { title: string; artist?: string } {
  // Trim only what is actually decoration: a trailing site name after a
  // separator, then a trailing bare "Lyrics". Removing any dash-segment that
  // merely mentions "lyrics" deletes the song - "Artist - Song Lyrics" loses
  // the song and keeps the artist, which is the wrong half.
  const t = raw
    .replace(/\s*[|–—-]\s*(hymnary(\.org)?|genius|azlyrics|lyrics\.com|songselect|musixmatch)\s*$/i, "")
    .replace(/\s*[|–—-]?\s*\blyrics\b\s*$/i, "")
    .trim();

  // "Song Lyrics by Artist" leaves "Lyrics" in the middle, so it survives the
  // trailing-only trim above and ends up in the song's name. Trimmed again on
  // each half after the split, where it is trailing once more.
  const dropLyrics = (v: string) => v.replace(/\s*\blyrics\b\s*$/i, "").trim();

  const by = /^(.*?)\s+by\s+(.+)$/i.exec(t);
  if (by?.[1] && by[2] && looksLikeName(by[2])) {
    return { title: dropLyrics(by[1]), artist: by[2].trim() };
  }

  const dash = /^(.*?)\s+[-–—]\s+(.*)$/.exec(t);
  if (dash?.[1] && dash[2]) {
    // "Artist - Song" is the more common ordering on lyric sites.
    const [left, right] = [dash[1].trim(), dash[2].trim()];
    if (looksLikeName(left)) return { title: dropLyrics(right), artist: left };
  }
  return { title: t };
}

export type SongMeta = {
  title: string | null;
  /** Everyone credited, most reliable source first, de-duplicated. */
  artists: string[];
};

/**
 * Title and credits for an imported page.
 *
 * Structured data is preferred over anything parsed out of a title string:
 * JSON-LD and RDFa say which name is the writer, whereas "X - Y" only says
 * there are two things. The title string is the last resort.
 */
export function extractSongMeta(html: string): SongMeta {
  const ld = fromJsonLd(html);
  const structural = [...ld.artists, ...fromMarkupAttributes(html)]
    .map(cleanName)
    .filter(looksLikeName);

  // The RAW page title, not extractPageTitle's - that one cuts everything
  // after the first dash, which on "Artist - Song Lyrics" throws away the song
  // and keeps the artist. Splitting needs both halves intact.
  // A page title usually carries the site's name as a trailing segment. The
  // site tells us its own name in og:site_name, which is exact - better than
  // guessing from a hard-coded list, and it covers whatever site is next.
  const siteName = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i
    .exec(html)?.[1];
  let pageTitle = ld.title ?? rawPageTitle(html) ?? "";
  if (siteName) {
    const escaped = decodeEntities(siteName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pageTitle = pageTitle.replace(new RegExp(`\\s*[|\u2013\u2014-]\\s*${escaped}\\s*$`, "i"), "").trim();
  }
  const split = fromTitleString(pageTitle);

  const artists = (structural.length ? structural : split.artist ? [split.artist] : [])
    .flatMap(splitCredits)
    .filter(looksLikeName);

  // Case-insensitive de-duplication, keeping the first spelling seen.
  const seen = new Set<string>();
  const unique = artists.filter((a) => {
    const k = a.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { title: (ld.title ?? split.title ?? "").trim() || null, artists: unique.slice(0, 4) };
}
