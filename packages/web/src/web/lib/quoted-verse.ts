/**
 * Finding the verse a preacher is QUOTING, without a reference being said.
 *
 * "For God so loved the world, that he gave his only begotten Son..." - no
 * book, no chapter, no number, and the congregation is already there. This
 * is the other half of following a sermon: a reference is how a reading
 * starts, quotation is how it gets preached.
 *
 * The whole design is about not being wrong. A wrong verse on the screen
 * because somebody said a common phrase is worse than a blank screen, so
 * this only answers on a long, contiguous, nearly-exact run of words that
 * lands on exactly ONE verse. A paraphrase finds nothing, which is the
 * right answer.
 */

export type QuoteHit = {
  code: string;
  name: string;
  chapter: number;
  verse: number;
  /** How many words of the matched run, which is also the confidence. */
  words: number;
};

/**
 * One version's text, flattened, normalised and indexed once.
 *
 * Parallel arrays rather than an array of objects: 31,000 verses is enough
 * that the per-object overhead is worth avoiding, and the only thing ever
 * done with them is scan.
 */
export type VerseCorpus = {
  versionId: string;
  /** Normalised verse text, space-padded at both ends for whole-word matching. */
  text: string[];
  code: string[];
  name: string[];
  chapter: number[];
  verse: number[];
  /**
   * word -> the verses containing it, for words rare enough to narrow
   * anything down. Common words are left out entirely: a posting list of
   * 8,000 verses for "the" costs memory and rules nothing out.
   */
  index: Map<string, number[]>;
};

/**
 * Same normalisation on both sides, which is the only reason this works at
 * all: a transcript has no capitals, no commas and no apostrophes where the
 * printed text has all three.
 */
export function normaliseVerse(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A word in more verses than this narrows nothing down, so it is not indexed. */
const COMMON_DF = 800;

/**
 * The shortest run of words allowed to decide anything.
 *
 * Six is not arbitrary. Five-word runs of ordinary English - "the word of
 * the Lord", "in the name of the" - appear in hundreds of verses and in
 * ordinary preaching; six begins to be a quotation. The uniqueness rule
 * below does the rest of the work.
 */
const MIN_RUN = 6;
/** Beyond this a longer match is not more convincing, only slower. */
const MAX_RUN = 12;

/** Build the scannable form of a version. Done once; takes a moment. */
export function buildCorpus(
  versionId: string,
  verses: { code: string; name: string; chapter: number; verse: number; text: string }[],
): VerseCorpus {
  const corpus: VerseCorpus = {
    versionId,
    text: Array.from({ length: verses.length }) as string[],
    code: Array.from({ length: verses.length }) as string[],
    name: Array.from({ length: verses.length }) as string[],
    chapter: Array.from({ length: verses.length }) as number[],
    verse: Array.from({ length: verses.length }) as number[],
    index: new Map(),
  };
  for (let i = 0; i < verses.length; i++) {
    const v = verses[i]!;
    const flat = normaliseVerse(v.text);
    corpus.text[i] = ` ${flat} `;
    corpus.code[i] = v.code;
    corpus.name[i] = v.name;
    corpus.chapter[i] = v.chapter;
    corpus.verse[i] = v.verse;
    // Each distinct word once per verse: a posting list wants verses, not
    // occurrences.
    const seen = new Set(flat.split(" "));
    for (const w of seen) {
      if (!w) continue;
      let list = corpus.index.get(w);
      if (list === undefined) {
        list = [];
        corpus.index.set(w, list);
      }
      // -1 marks a word already found to be too common to be worth keeping.
      if (list.length === 1 && list[0] === -1) continue;
      list.push(i);
      if (list.length > COMMON_DF) {
        list.length = 0;
        list.push(-1);
      }
    }
  }
  return corpus;
}

/** The posting list of the rarest indexed word in a window, or null. */
function narrowest(words: string[], corpus: VerseCorpus): number[] | null {
  let best: number[] | null = null;
  for (const w of words) {
    const list = corpus.index.get(w);
    if (!list || list.length === 0 || list[0] === -1) continue;
    if (!best || list.length < best.length) best = list;
  }
  return best;
}

/**
 * The verse being quoted in `sentence`, or null.
 *
 * Takes the longest run of the sentence's words that appears in exactly one
 * verse. "Exactly one" is the guard that matters: "and it came to pass" is
 * in hundreds of verses and settles nothing, so it is not allowed to settle
 * anything.
 *
 * Fast because of the index: any verse containing a run must contain every
 * word of it, so only the verses holding the run's rarest word are ever
 * looked at - a few dozen, not thirty thousand.
 */
export function findQuotedVerse(sentence: string, corpus: VerseCorpus): QuoteHit | null {
  const flat = normaliseVerse(sentence);
  const words = flat.split(" ").filter(Boolean);
  if (words.length < MIN_RUN) return null;

  // Longest first: a ten-word match is worth more than the six-word match
  // inside it, and the first length that works is the answer.
  const longest = Math.min(MAX_RUN, words.length);
  for (let len = longest; len >= MIN_RUN; len--) {
    for (let start = 0; start + len <= words.length; start++) {
      const run = words.slice(start, start + len);
      const candidates = narrowest(run, corpus);
      // Every word of the run is too common to index: by construction that
      // is not a distinctive quotation.
      if (!candidates) continue;
      const needle = ` ${run.join(" ")} `;
      let found = -1;
      let count = 0;
      for (const i of candidates) {
        if (corpus.text[i]!.includes(needle)) {
          count++;
          if (count > 1) break;
          found = i;
        }
      }
      if (count === 1 && found >= 0) {
        return {
          code: corpus.code[found]!,
          name: corpus.name[found]!,
          chapter: corpus.chapter[found]!,
          verse: corpus.verse[found]!,
          words: len,
        };
      }
    }
  }
  return null;
}

/** The form hooks/use-bible.ts's parseReference already understands. */
export function quoteToQuery(hit: QuoteHit): string {
  return `${hit.name} ${hit.chapter}:${hit.verse}`;
}
