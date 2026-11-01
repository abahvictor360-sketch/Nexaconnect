/**
 * Run with: bun test src/web/lib/spoken-ref.test.ts
 *
 * The false-positive cases matter more than the rest. Putting the wrong
 * verse on the screen mid-sermon is a mistake the whole room sees, so the
 * parser is allowed to stay silent and is not allowed to guess.
 */
import { expect, test } from "bun:test";
import { parseSpokenReference, spokenRefToQuery } from "./spoken-ref";

const BOOKS = [
  "genesis", "exodus", "psalms", "isaiah", "matthew", "mark", "luke", "john", "acts",
  "romans", "1 corinthians", "2 corinthians", "galatians", "ephesians", "philippians",
  "1 john", "2 john", "3 john", "revelation", "song of solomon", "1 timothy",
  "2 timothy", "hebrews", "james", "1 peter",
];

const said = (text: string) => {
  const ref = parseSpokenReference(text, BOOKS);
  return ref ? spokenRefToQuery(ref) : null;
};

test("plain spoken references", () => {
  expect(said("turn with me to John chapter three verse sixteen")).toBe("john 3:16");
  expect(said("john three sixteen")).toBe("john 3:16");
  expect(said("let us read Romans chapter eight verse twenty eight")).toBe("romans 8:28");
  expect(said("Genesis chapter one verse one")).toBe("genesis 1:1");
});

test("books that start with a number", () => {
  expect(said("first corinthians thirteen four")).toBe("1 corinthians 13:4");
  expect(said("second timothy chapter three verse sixteen")).toBe("2 timothy 3:16");
});

test("a single-chapter book is cited by verse alone", () => {
  expect(said("third john verse four")).toBe("3 john 1:4");
});

test("multi-word book names", () => {
  expect(said("song of solomon chapter two verse one")).toBe("song of solomon 2:1");
});

test("verse ranges", () => {
  expect(said("ephesians six verses ten to eighteen")).toBe("ephesians 6:10-18");
});

test("numbers the transcriber wrote as digits", () => {
  expect(said("john 3 16")).toBe("john 3:16");
  expect(said("romans 12 verse 2")).toBe("romans 12:2");
});

test("numbers above a hundred", () => {
  expect(said("psalms one hundred and nineteen verse one hundred and five")).toBe("psalms 119:105");
  expect(said("psalms chapter one hundred nineteen")).toBe("psalms 119");
});

test("the last reference spoken wins", () => {
  expect(said("as we saw in romans eight now turn to john three sixteen")).toBe("john 3:16");
});

test("a chapter on its own counts when the sentence is leading up to a reading", () => {
  expect(said("open your bibles to psalms twenty three")).toBe("psalms 23");
  expect(said("let us read from isaiah fifty three")).toBe("isaiah 53");
  expect(said("the book of acts chapter two")).toBe("acts 2");
});

test("ordinary speech that happens to contain a book and a number is not a reference", () => {
  expect(said("there were twelve disciples with john")).toBeNull();
  expect(said("john twelve of them were fishermen")).toBeNull();
  expect(said("mark my words three things will happen")).toBeNull();
  expect(said("james four of us went")).toBeNull();
});

test("no reference at all", () => {
  expect(said("and the lord was with him all the days of his life")).toBeNull();
  expect(said("the gospel of john tells us")).toBeNull();
});
