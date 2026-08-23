/**
 * Add a Bible translation to the bundled offline library.
 *
 * Turns a folder of USFM files (what a Bible Society or Digital Bible Library
 * export normally looks like) into the per-book JSON the app reads, and
 * registers the version in public/bible/manifest.json. Nothing else has to
 * change: the Bible tab lists every version in the manifest, and Settings
 * builds its language-pack toggles from the same place.
 *
 * Usage (from packages/web):
 *   bun src/api/import-bible.ts --src ../../twi-usfm  --id twi --label "Asante Twi" --language "Asante Twi" --lang twi
 *   bun src/api/import-bible.ts --src ../../swa-usfm  --id swa --label "Swahili"     --language "Kiswahili"   --lang swa
 *
 *   --src       folder of .usfm/.sfm files, or a single pre-built JSON file
 *               shaped { "JHN": { "c": { "1": ["v1", ...] } }, ... }
 *   --id        short version id - the folder name, and part of slide ids
 *   --label     what the version dropdown shows
 *   --language  the language's own name, shown on the Settings toggle
 *   --lang      language code; anything other than "en" makes it a togglable
 *               pack rather than part of the always-on English core
 *   --dry       parse and report, write nothing
 *
 * This script only ever converts text it is given. It does not fetch, and it
 * cannot invent scripture: a book missing from --src is reported as missing
 * and left out, so a partial import is visibly partial rather than quietly
 * looking complete.
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

/** USFM book ids, in canonical order, as they appear in \id lines. */
const CANON = [
  "GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA", "1KI", "2KI",
  "1CH", "2CH", "EZR", "NEH", "EST", "JOB", "PSA", "PRO", "ECC", "SNG", "ISA", "JER",
  "LAM", "EZK", "DAN", "HOS", "JOL", "AMO", "OBA", "JON", "MIC", "NAM", "HAB", "ZEP",
  "HAG", "ZEC", "MAL", "MAT", "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL",
  "EPH", "PHP", "COL", "1TH", "2TH", "1TI", "2TI", "TIT", "PHM", "HEB", "JAS", "1PE",
  "2PE", "1JN", "2JN", "3JN", "JUD", "REV",
];

type Book = { c: Record<string, string[]> };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

function decodeXml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (_, name) => XML_ENTITIES[name.toLowerCase()] ?? `&${name};`);
}

/**
 * Beblia-style XML: <book number="1"><chapter number="1"><verse number="1">…
 *
 * Books are identified by NUMBER rather than a code, in the standard
 * 66-book Protestant order, so the number indexes straight into CANON.
 * Parsed with regex rather than a DOM: the structure is flat and regular,
 * the files are ~5MB, and it keeps the script dependency-free like the rest
 * of the import tooling.
 */
function xmlToBooks(xml: string): { books: Record<string, Book>; meta: { translation?: string; status?: string } } {
  const books: Record<string, Book> = {};
  const head = /<bible\b([^>]*)>/i.exec(xml)?.[1] ?? "";
  const meta = {
    translation: /translation="([^"]*)"/i.exec(head)?.[1],
    status: /status="([^"]*)"/i.exec(head)?.[1],
  };

  const bookRe = /<book\s+number="(\d+)"[^>]*>([\s\S]*?)<\/book>/gi;
  for (let b = bookRe.exec(xml); b; b = bookRe.exec(xml)) {
    const code = CANON[Number(b[1]) - 1];
    if (!code) {
      console.warn(`  skipped book number ${b[1]} - outside the 66-book canon`);
      continue;
    }
    const chapters: Record<string, string[]> = {};
    const chapRe = /<chapter\s+number="(\d+)"[^>]*>([\s\S]*?)<\/chapter>/gi;
    for (let c = chapRe.exec(b[2]); c; c = chapRe.exec(b[2])) {
      const verses: string[] = [];
      const vRe = /<verse\s+number="(\d+)"[^>]*>([\s\S]*?)<\/verse>/gi;
      for (let v = vRe.exec(c[2]); v; v = vRe.exec(c[2])) {
        verses[Number(v[1]) - 1] = decodeXml(v[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
      }
      for (let i = 0; i < verses.length; i++) if (verses[i] === undefined) verses[i] = "";
      if (verses.length) chapters[c[1]] = verses;
    }
    if (Object.keys(chapters).length) books[code] = { c: chapters };
  }
  return { books, meta };
}

/**
 * USFM to plain verses.
 *
 * Deliberately a subset: chapter and verse markers carry the structure, and
 * the rest of USFM is either formatting (\p, \q1, \b) or apparatus
 * (\f footnotes, \x cross-references, \s headings) with no place on a
 * projector slide. Character-level markers like `\nd LORD\nd*` are unwrapped
 * to their text rather than dropped, so no words are lost.
 */
function usfmToBook(usfm: string): Book {
  const chapters: Record<string, string[]> = {};
  let chapter = "";
  let verseNo = 0;
  let buf: string[] = [];

  const flush = () => {
    if (!chapter || verseNo <= 0) return;
    const text = buf
      .join(" ")
      .replace(/\\[fx]\s[\s\S]*?\\[fx]\*/g, "")   // footnotes / cross-refs, contents and all
      .replace(/\\\+?[a-z]+\d*\*/g, "")            // closing char markers (\nd*, \+wj*)
      .replace(/\\\+?[a-z]+\d*\s?/g, "")           // opening char + paragraph markers
      .replace(/\|[^\\]*/g, "")                    // \w attributes (glory|strong="H3519")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return;
    (chapters[chapter] ??= [])[verseNo - 1] = text;
    buf = [];
  };

  for (const raw of usfm.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const c = /^\\c\s+(\d+)/.exec(line);
    if (c) {
      flush();
      chapter = c[1];
      verseNo = 0;
      chapters[chapter] ??= [];
      continue;
    }
    // A single line can hold several verses: "\v 1 text \v 2 more".
    if (/^\\v\s/.test(line) || /\s\\v\s/.test(line)) {
      for (const part of line.split(/(?=\\v\s)/)) {
        const v = /^\\v\s+(\d+)(?:[-,]\d+)?\s*([\s\S]*)$/.exec(part.trim());
        if (v) {
          flush();
          verseNo = Number(v[1]);
          if (v[2]) buf.push(v[2]);
        } else if (verseNo > 0) {
          buf.push(part);
        }
      }
      continue;
    }
    // Headings, intros and metadata are not verses.
    if (/^\\(id|ide|h|toc\d?|mt\d?|ms\d?|s\d?|r|sp|cl|cp|rem|usfm|iot|io\d|ip|imt\d?)\b/.test(line)) continue;
    if (verseNo > 0) buf.push(line);
  }
  flush();

  // Fill a gap left by a missing verse number so array indices stay aligned
  // with verse numbers instead of silently shifting everything after the hole.
  for (const ch of Object.keys(chapters)) {
    const arr = chapters[ch];
    for (let i = 0; i < arr.length; i++) if (arr[i] === undefined) arr[i] = "";
  }
  return { c: chapters };
}

/** Which canonical book a USFM file is, from its \id line or its filename. */
function bookCodeOf(file: string, usfm: string): string | null {
  const id = /^\\id\s+([A-Z0-9]{3})/m.exec(usfm);
  if (id && CANON.includes(id[1])) return id[1];
  const upper = path.basename(file).toUpperCase();
  return CANON.find((code) => upper.includes(code)) ?? null;
}

async function main() {
  const src = arg("src");
  const id = arg("id");
  const label = arg("label") ?? id;
  const language = arg("language") ?? label;
  const lang = arg("lang") ?? id;
  const dry = process.argv.includes("--dry");

  if (!src || !id) {
    console.error("Need --src <folder-or-json> and --id <version-id>. See the header of this file.");
    process.exit(1);
  }
  if (!fsSync.existsSync(src)) {
    console.error(`--src not found: ${src}`);
    process.exit(1);
  }

  const books: Record<string, Book> = {};
  let sourceNote = arg("copyright");

  if ((await fs.stat(src)).isFile() && /\.xml$/i.test(src)) {
    const { books: parsed, meta } = xmlToBooks(await fs.readFile(src, "utf8"));
    Object.assign(books, parsed);
    // Keep the translation's own rights notice with the data rather than
    // dropping it: these files carry one, and it belongs on screen/in About.
    sourceNote ??= [meta.translation, meta.status].filter(Boolean).join(" - ") || undefined;
  } else if ((await fs.stat(src)).isFile()) {
    const parsed = JSON.parse(await fs.readFile(src, "utf8")) as Record<string, Book>;
    for (const [code, book] of Object.entries(parsed)) {
      if (CANON.includes(code) && book?.c) books[code] = book;
      else console.warn(`  skipped "${code}" - not a canonical book code, or no chapters`);
    }
  } else {
    const files = (await fs.readdir(src)).filter((f) => /\.(usfm|sfm|txt)$/i.test(f));
    if (!files.length) {
      console.error(`No .usfm/.sfm files in ${src}`);
      process.exit(1);
    }
    for (const f of files) {
      const usfm = await fs.readFile(path.join(src, f), "utf8");
      const code = bookCodeOf(f, usfm);
      if (!code) {
        console.warn(`  skipped ${f} - could not tell which book it is`);
        continue;
      }
      const book = usfmToBook(usfm);
      if (!Object.keys(book.c).length) {
        console.warn(`  skipped ${f} (${code}) - no verses found`);
        continue;
      }
      books[code] = book;
    }
  }

  const present = CANON.filter((c) => books[c]);
  const missing = CANON.filter((c) => !books[c]);
  const verses = present.reduce(
    (n, c) => n + Object.values(books[c].c).reduce((m, v) => m + v.filter(Boolean).length, 0),
    0,
  );

  console.log(`\n${label} (${id}): ${present.length}/66 books, ${verses.toLocaleString()} verses`);
  if (missing.length) console.log(`Missing ${missing.length}: ${missing.join(" ")}`);
  if (dry) {
    console.log("\n--dry: nothing written.");
    return;
  }
  if (!present.length) {
    console.error("Nothing to write.");
    process.exit(1);
  }

  const bibleDir = path.join(process.cwd(), "public", "bible");
  const outDir = path.join(bibleDir, id);
  await fs.mkdir(outDir, { recursive: true });
  for (const code of present) {
    await fs.writeFile(path.join(outDir, `${code}.json`), JSON.stringify(books[code]));
  }

  // Register in the manifest, replacing any previous entry for this id so a
  // re-import corrects itself instead of duplicating the version.
  const manifestPath = path.join(bibleDir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
    canon: unknown[];
    versions: Record<string, unknown>[];
  };
  const chapterCounts: Record<string, number> = {};
  for (const code of present) chapterCounts[code] = Object.keys(books[code].c).length;

  manifest.versions = manifest.versions.filter((v) => v.id !== id);
  manifest.versions.push({
    id, label, language, lang, books: present, chapterCounts,
    ...(sourceNote ? { copyright: sourceNote } : {}),
  });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`\nWrote public/bible/${id}/ and registered it in manifest.json.`);
  console.log("It appears in the Bible tab's version list, with a toggle under Settings > Bible.");
}

await main();
