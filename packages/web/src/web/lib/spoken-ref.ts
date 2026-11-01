/**
 * Scripture references as people SAY them.
 *
 * The typed parser in hooks/use-bible.ts reads "John 3:16" - the form
 * somebody types into a box. A preacher says "turn with me to the gospel of
 * John, chapter three, verse sixteen", and a transcriber writes exactly that:
 * words, not digits, with the book buried in a sentence. Nothing in the typed
 * parser can reach it, which is why this exists separately rather than as
 * another branch of that regular expression.
 *
 * It reads the END of a rolling transcript and answers one question: has a
 * reference just been spoken, and which one. Being wrong is worse than being
 * silent here - putting the wrong verse on the screen mid-sermon is a visible
 * mistake in front of a congregation - so it only answers when the shape is
 * unmistakable.
 */

export type SpokenRef = { book: string; chapter: number; verse: number | null; endVerse: number | null };

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
/** Said of a chapter or verse as often as the cardinal: "chapter third". */
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8,
  ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14,
  fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20,
};

/** The "1" in "1 John", however it was said or transcribed. */
const BOOK_PREFIX: Record<string, string> = {
  first: "1", "1st": "1", one: "1",
  second: "2", "2nd": "2", two: "2",
  third: "3", "3rd": "3", three: "3",
};

/**
 * A number as a run of words: "sixteen", "twenty one", "twenty-one", "116".
 * Returns the value and how many tokens it consumed, or null.
 */
function readNumber(tokens: string[], i: number): { value: number; next: number } | null {
  const t = tokens[i];
  if (t === undefined) return null;
  if (/^\d{1,3}$/.test(t)) return { value: parseInt(t, 10), next: i + 1 };
  if (t in ORDINALS) return { value: ORDINALS[t]!, next: i + 1 };
  if (t in TENS) {
    const nxt = tokens[i + 1];
    // "twenty one" is 21; "twenty" alone is 20.
    if (nxt && nxt in UNITS && UNITS[nxt]! >= 1 && UNITS[nxt]! <= 9) {
      return { value: TENS[t]! + UNITS[nxt]!, next: i + 2 };
    }
    return { value: TENS[t]!, next: i + 1 };
  }
  if (t in UNITS) {
    // "one hundred and sixteen", "one hundred sixteen"
    if (tokens[i + 1] === "hundred") {
      let j = i + 2;
      if (tokens[j] === "and") j++;
      const rest = readNumber(tokens, j);
      const base = UNITS[t]! * 100;
      if (rest && rest.value < 100) return { value: base + rest.value, next: rest.next };
      return { value: base, next: i + 2 };
    }
    return { value: UNITS[t]!, next: i + 1 };
  }
  return null;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    // Keep digits and letters; hyphens join number words ("twenty-one").
    .replace(/[-]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Longest book name wins, so "song of solomon" is not read as "song", and
 * "first john" is not read as the number one followed by "john".
 */
function matchBook(tokens: string[], i: number, names: string[]): { book: string; next: number } | null {
  let prefix = "";
  let start = i;
  const p = tokens[i];
  if (p !== undefined && p in BOOK_PREFIX && tokens[i + 1] !== undefined) {
    prefix = BOOK_PREFIX[p]!;
    start = i + 1;
  }
  // Try the longest run of words first - book names are up to three words
  // ("song of solomon", "acts of the apostles" is handled by the canon's own
  // naming, which this only has to match).
  for (let len = 4; len >= 1; len--) {
    const phrase = tokens.slice(start, start + len).join(" ");
    if (!phrase) continue;
    const want = prefix ? `${prefix} ${phrase}` : phrase;
    const hit = names.find((n) => n === want);
    if (hit) return { book: hit, next: start + len };
  }
  return null;
}

const FILLER = new Set(["chapter", "verse", "verses", "and", "the", "of", "vs", "v"]);

/**
 * Words that mean a reference is coming.
 *
 * Needed because a book name followed by a number is not always a citation:
 * "there were twelve disciples with John" is a sentence, not John 12. A bare
 * "Psalms twenty three" IS how people cite a psalm, though, so the rule
 * cannot simply demand two numbers. Something has to say "we are about to
 * read" - either a marker word around the numbers, or a verse number as
 * well, or one of these in the run-up.
 */
const CUES = new Set([
  "turn", "turning", "turned", "read", "reading", "reads", "go", "look", "open",
  "bible", "bibles", "scripture", "scriptures", "text", "passage", "book",
  "gospel", "letter", "epistle", "says", "said", "written", "find", "see",
]);

/**
 * The last reference spoken in `text`, or null.
 *
 * `bookNames` are the canon's names, already lowercased - passed in rather
 * than imported so this stays a pure function and can be tested without a
 * Bible loaded.
 */
export function parseSpokenReference(
  text: string,
  bookNames: string[],
  /**
   * What is already on the screen. A preacher names the book once and then
   * walks the passage - "verse seventeen", "and verse eighteen", "look at
   * chapter four" - and none of those say the book again. Without somewhere
   * to carry it, the screen stops following the moment the reading starts,
   * which is exactly when it matters.
   */
  context?: { book: string; chapter: number } | null,
): SpokenRef | null {
  const tokens = tokenize(text);
  const names = bookNames.map((n) => n.toLowerCase());
  let best: SpokenRef | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const book = matchBook(tokens, i, names);
    if (!book) continue;
    let j = book.next;
    // Skip "chapter" and friends between the book and the number. "verse" is
    // NOT skipped here - it marks what comes next as the verse, and eating it
    // would read "john verse sixteen" as chapter sixteen.
    while (j < tokens.length && FILLER.has(tokens[j]!) && tokens[j] !== "verse" && tokens[j] !== "verses") j++;

    let chapterValue: number;
    let verse: number | null = null;
    let endVerse: number | null = null;

    if (tokens[j] === "verse" || tokens[j] === "verses") {
      /*
       * "third John verse four" - no chapter said, because there is only one.
       *
       * Jude, Philemon, Obadiah and the short letters of John are always
       * cited this way, and reading the verse as a chapter would send the
       * screen to a chapter that does not exist.
       */
      const only = readNumber(tokens, j + 1);
      if (!only || only.value < 1) continue;
      chapterValue = 1;
      verse = only.value;
      j = only.next;
    } else {
      const chap = readNumber(tokens, j);
      if (!chap || chap.value < 1) continue;
      chapterValue = chap.value;
      j = chap.next;
    }

    // "verse sixteen", or just "sixteen" straight after the chapter.
    let k = j;
    while (k < tokens.length && FILLER.has(tokens[k]!)) k++;
    const v = verse === null ? readNumber(tokens, k) : null;
    if (v && v.value >= 1) {
      verse = v.value;
      let m = v.next;
      // "to", "through", "dash" for a range.
      if (tokens[m] === "to" || tokens[m] === "through" || tokens[m] === "till") {
        const end = readNumber(tokens, m + 1);
        if (end && end.value > v.value) {
          endVerse = end.value;
          m = end.next;
        }
      }
      j = m;
    }
    // The LAST one wins: a preacher recapping "...as we saw in Romans eight"
    // before reading "...John three sixteen" means the second one.
    // A range can follow a verse that came from either branch.
    if (verse !== null && endVerse === null) {
      let m = j;
      if (tokens[m] === "to" || tokens[m] === "through" || tokens[m] === "till") {
        const end = readNumber(tokens, m + 1);
        if (end && end.value > verse) {
          endVerse = end.value;
          j = end.next;
        }
      }
    }
    /*
     * Only answer when the shape is unmistakable.
     *
     * The wrong verse on the screen mid-sermon is a mistake the whole room
     * sees, so a book followed by one bare number is not enough on its own.
     * Any ONE of these settles it: the speaker said "chapter" or "verse", a
     * verse number came too, or the words just before were leading up to a
     * reading.
     */
    const saidMarker = tokens
      .slice(book.next, Math.min(j + 1, tokens.length))
      .some((t) => t === "chapter" || t === "verse" || t === "verses");
    const ledUpToIt = tokens.slice(Math.max(0, i - 5), i).some((t) => CUES.has(t));
    if (!saidMarker && verse === null && !ledUpToIt) {
      i = j - 1;
      continue;
    }
    best = { book: book.book, chapter: chapterValue, verse, endVerse };
    i = j - 1;
  }
  return best ?? followOn(tokens, context);
}

/**
 * "verse eighteen" on its own, carried onto the passage already showing.
 *
 * Only ever with an explicit "verse" or "chapter" said out loud. A bare
 * number is the single most common thing in a sermon - dates, counts, points
 * one two and three - and following those would move the screen constantly
 * for no reason.
 */
function followOn(
  tokens: string[],
  context?: { book: string; chapter: number } | null,
): SpokenRef | null {
  if (!context) return null;
  let found: SpokenRef | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    if (word !== "verse" && word !== "verses" && word !== "chapter") continue;
    const n = readNumber(tokens, i + 1);
    if (!n || n.value < 1) continue;

    if (word === "chapter") {
      // A new chapter of the same book. A verse may follow it straight away.
      let j = n.next;
      while (j < tokens.length && FILLER.has(tokens[j]!) && tokens[j] !== "verse" && tokens[j] !== "verses") j++;
      let verse: number | null = null;
      let endVerse: number | null = null;
      let after = n.next;
      if (tokens[j] === "verse" || tokens[j] === "verses") {
        const v = readNumber(tokens, j + 1);
        if (v && v.value >= 1) {
          verse = v.value;
          after = v.next;
          if (tokens[after] === "to" || tokens[after] === "through" || tokens[after] === "till") {
            const end = readNumber(tokens, after + 1);
            if (end && end.value > v.value) {
              endVerse = end.value;
              after = end.next;
            }
          }
        }
      }
      found = { book: context.book, chapter: n.value, verse, endVerse };
      // Past the verse words too: leaving them would let the loop read that
      // same "verse six" again on the next pass and pin it back onto the
      // chapter the screen is showing, undoing the chapter change.
      i = after - 1;
      continue;
    }

    let endVerse: number | null = null;
    let m = n.next;
    if (tokens[m] === "to" || tokens[m] === "through" || tokens[m] === "till" || tokens[m] === "down") {
      const start = tokens[m] === "down" && tokens[m + 1] === "to" ? m + 2 : m + 1;
      const end = readNumber(tokens, start);
      if (end && end.value > n.value) {
        endVerse = end.value;
        m = end.next;
      }
    }
    found = { book: context.book, chapter: context.chapter, verse: n.value, endVerse };
    i = m - 1;
  }
  return found;
}

/** The form hooks/use-bible.ts's parseReference already understands. */
export function spokenRefToQuery(ref: SpokenRef): string {
  const base = `${ref.book} ${ref.chapter}`;
  if (ref.verse === null) return base;
  return ref.endVerse ? `${base}:${ref.verse}-${ref.endVerse}` : `${base}:${ref.verse}`;
}

/**
 * The passage already on screen, read back off a Bible slide's caption.
 *
 * Captions are written "John 3:16" by verseSlide, which is the one place the
 * book and chapter the operator is actually sitting in can be had without
 * threading state up through the Bible panel. It is what lets "verse
 * eighteen", said on its own, land on the right chapter.
 */
export function contextFromCaption(caption?: string | null): { book: string; chapter: number } | null {
  if (!caption) return null;
  const m = /^(.+?)\s+(\d+)\s*:\s*\d+/.exec(caption.trim());
  if (!m) return null;
  return { book: m[1]!.toLowerCase(), chapter: parseInt(m[2]!, 10) };
}
