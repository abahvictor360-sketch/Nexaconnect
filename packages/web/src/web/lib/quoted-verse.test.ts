/**
 * Run with: bun test src/web/lib/quoted-verse.test.ts
 *
 * Built against the real KJV that ships with the app, because the whole
 * question this answers - "is this run of words distinctive enough" - is a
 * property of the actual text, and a handful of invented verses would prove
 * nothing about it.
 *
 * The false-positive cases are the important ones. Silence is an acceptable
 * answer here; the wrong verse on the screen mid-sermon is not.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { buildCorpus, findQuotedVerse, quoteToQuery, type VerseCorpus } from "./quoted-verse";

const DIR = `${import.meta.dir}/../../../public/bible`;

function loadKjv(): VerseCorpus {
  const manifest = JSON.parse(readFileSync(`${DIR}/manifest.json`, "utf8")) as {
    canon: { code: string; name: string }[];
  };
  const names = new Map(manifest.canon.map((b) => [b.code, b.name]));
  const rows: { code: string; name: string; chapter: number; verse: number; text: string }[] = [];
  for (const file of readdirSync(`${DIR}/kjv`)) {
    if (!file.endsWith(".json")) continue;
    const code = file.replace(/\.json$/, "");
    const book = JSON.parse(readFileSync(`${DIR}/kjv/${file}`, "utf8")) as {
      c: Record<string, string[]>;
    };
    for (const [ch, verses] of Object.entries(book.c)) {
      verses.forEach((text, i) =>
        rows.push({ code, name: names.get(code) ?? code, chapter: Number(ch), verse: i + 1, text }),
      );
    }
  }
  return buildCorpus("kjv", rows);
}

const corpus = loadKjv();

const said = (s: string) => {
  const hit = findQuotedVerse(s, corpus);
  return hit ? quoteToQuery(hit) : null;
};

test("the corpus covers the whole KJV", () => {
  // Enough to be sure every book loaded, not a magic number to maintain.
  expect(corpus.text.length).toBeGreaterThan(30000);
});

test("a verse quoted exactly is found", () => {
  expect(said("for god so loved the world that he gave his only begotten son")).toBe("John 3:16");
  expect(said("the lord is my shepherd i shall not want")).toBe("Psalms 23:1");
});

test("a quote is found mid-sentence, with the preacher's own words around it", () => {
  expect(
    said("now listen to what Paul says here I can do all things through Christ which strengtheneth me amen"),
  ).toBe("Philippians 4:13");
});

test("a transcript without punctuation or capitals still matches", () => {
  expect(said("in the beginning god created the heaven and the earth")).toBe("Genesis 1:1");
});

test("ordinary preaching does not move the screen", () => {
  expect(said("good morning church it is so good to see all of you here today")).toBeNull();
  expect(said("turn with me if you would to the book that we were in last week")).toBeNull();
  expect(said("I want to talk this morning about what it means to walk by faith")).toBeNull();
});

test("a phrase common to many verses settles nothing", () => {
  // In hundreds of verses: it must not pick one of them.
  // 42 and 72 verses respectively in the KJV, so neither can pick one.
  expect(said("the word of the lord came unto me saying")).toBeNull();
  expect(said("and the lord spake unto moses saying")).toBeNull();
});

test("too short to be a quotation is ignored", () => {
  expect(said("god is love")).toBeNull();
  expect(said("the lord is my shepherd")).toBeNull();
});

test("a paraphrase finds nothing rather than something near it", () => {
  expect(said("god loved everybody in the world so much that he sent his son down")).toBeNull();
});

test("matching is fast enough to run on every sentence", () => {
  const sentences = [
    "for god so loved the world that he gave his only begotten son",
    "good morning church it is so good to see all of you here today",
    "and it came to pass in those days that",
    "I can do all things through Christ which strengtheneth me",
  ];
  const started = performance.now();
  for (let i = 0; i < 25; i++) for (const s of sentences) findQuotedVerse(s, corpus);
  const each = (performance.now() - started) / (25 * sentences.length);
  // A sentence arrives every few seconds; anything in this range is free.
  expect(each).toBeLessThan(25);
});
