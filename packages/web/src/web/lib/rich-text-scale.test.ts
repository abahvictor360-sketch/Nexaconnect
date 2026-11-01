/**
 * Run with: bun test src/web/lib/rich-text-scale.test.ts
 *
 * Per-word sizing, which is the one mark that is a number rather than a
 * flag - so it has an identity value (1 = the slide's own size) that must
 * never be stored, or every slide grows a format range that does nothing.
 */
import { expect, test } from "bun:test";
import {
  applyMarks, marksInRange, normalize, runStyle, serializeFormats, toRunLines,
} from "./rich-text";
import { stepSize, SIZE_STEPS } from "../components/size-buttons";

test("sizing a selection stores a scale on exactly that range", () => {
  const out = applyMarks([], 0, 5, { scale: 1.5 });
  expect(out).toEqual([{ start: 0, end: 5, scale: 1.5 }]);
});

test("back to the slide's own size stores nothing at all", () => {
  const sized = applyMarks([], 0, 5, { scale: 1.5 });
  expect(applyMarks(sized, 0, 5, { scale: null })).toEqual([]);
  // 1 is the identity, so it is dropped rather than written out.
  expect(applyMarks([], 0, 5, { scale: 1 })).toEqual([]);
});

test("size merges with other marks rather than replacing them", () => {
  const bold = applyMarks([], 0, 5, { bold: true });
  const both = applyMarks(bold, 0, 5, { scale: 0.8 });
  expect(both).toEqual([{ start: 0, end: 5, bold: true, scale: 0.8 }]);
  // And clearing the size leaves the bold alone.
  expect(applyMarks(both, 0, 5, { scale: null })).toEqual([{ start: 0, end: 5, bold: true }]);
});

test("neighbouring ranges of the same size merge, different sizes do not", () => {
  expect(
    normalize([
      { start: 0, end: 3, scale: 1.5 },
      { start: 3, end: 6, scale: 1.5 },
    ]),
  ).toEqual([{ start: 0, end: 6, scale: 1.5 }]);
  expect(
    normalize([
      { start: 0, end: 3, scale: 1.5 },
      { start: 3, end: 6, scale: 0.8 },
    ]),
  ).toHaveLength(2);
});

test("a selection of mixed sizes reports no size, like the bold button", () => {
  const formats = [{ start: 0, end: 3, scale: 1.5 }];
  expect(marksInRange(formats, 0, 3).scale).toBe(1.5);
  expect(marksInRange(formats, 0, 6).scale).toBeUndefined();
});

test("a sized run renders as a ratio of the slide, not a point size", () => {
  expect(runStyle({ scale: 1.5 }).fontSize).toBe("1.5em");
  expect(runStyle({ scale: 1 }).fontSize).toBeUndefined();
  expect(runStyle({}).fontSize).toBeUndefined();
});

test("the size reaches the renderer as a run", () => {
  const lines = toRunLines("big small", [{ start: 0, end: 3, scale: 2.2 }]);
  expect(lines[0]).toEqual([{ text: "big", scale: 2.2 }, { text: " small" }]);
});

test("a slide with no sizing stores no sizing", () => {
  expect(serializeFormats(applyMarks([], 0, 5, { scale: 1 }))).toBe("[]");
});

test("A- and A+ walk the steps and stop at the ends", () => {
  expect(stepSize(1, 1)).toBe(1.25);
  expect(stepSize(1, -1)).toBe(0.8);
  expect(stepSize(SIZE_STEPS[0], -1)).toBe(SIZE_STEPS[0]);
  expect(stepSize(SIZE_STEPS[SIZE_STEPS.length - 1], 1)).toBe(SIZE_STEPS[SIZE_STEPS.length - 1]);
  // An odd stored value snaps to the nearest step rather than being stuck.
  expect(stepSize(1.31, 1)).toBe(1.5);
});
