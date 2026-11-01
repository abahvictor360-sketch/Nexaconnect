/**
 * Run with: bun test src/web/lib/spoken-version.test.ts
 *
 * As with the reference parser, the cases that matter are the ones where it
 * must stay quiet. Switching translation mid-sermon because somebody said
 * the word "message" is a visible mistake.
 */
import { expect, test } from "bun:test";
import { parseSpokenVersion } from "./spoken-version";

const ALL = ["kjv", "nkjv", "niv", "nirv", "esv", "nlt", "amp", "msg", "tpt", "gnt", "net", "web", "yor"];

test("a version named in full is heard", () => {
  expect(parseSpokenVersion("John three sixteen in the New Living Translation", ALL)).toBe("nlt");
  expect(parseSpokenVersion("let's read that in the King James", ALL)).toBe("kjv");
  expect(parseSpokenVersion("the English Standard Version says", ALL)).toBe("esv");
  expect(parseSpokenVersion("turn to Romans eight in the Amplified", ALL)).toBe("amp");
});

test("the longer name wins over the shorter one inside it", () => {
  expect(parseSpokenVersion("read it in the New International Readers Version", ALL)).toBe("nirv");
  expect(parseSpokenVersion("read it in the New International Version", ALL)).toBe("niv");
  expect(parseSpokenVersion("that's the New King James", ALL)).toBe("nkjv");
});

test("spelled-out letters are heard", () => {
  expect(parseSpokenVersion("look at it in the N I V", ALL)).toBe("niv");
  expect(parseSpokenVersion("the E S V renders it differently", ALL)).toBe("esv");
});

test("a short name needs a lead-in, so ordinary speech is left alone", () => {
  expect(parseSpokenVersion("the message of the cross is foolishness to them", ALL)).toBeNull();
  expect(parseSpokenVersion("he had a passion for the lost", ALL)).toBeNull();
  // With the lead-in it is clearly a request.
  expect(parseSpokenVersion("read that again in the Message", ALL)).toBe("msg");
  expect(parseSpokenVersion("the Passion Translation puts it this way", ALL)).toBe("tpt");
});

test("a version that is not installed or is switched off is ignored", () => {
  expect(parseSpokenVersion("in the New Living Translation", ["kjv", "niv"])).toBeNull();
  expect(parseSpokenVersion("in the Yoruba Bible", ["kjv"])).toBeNull();
  expect(parseSpokenVersion("in the Yoruba Bible", ALL)).toBe("yor");
});

test("no version named means no change", () => {
  expect(parseSpokenVersion("turn with me to John chapter three verse sixteen", ALL)).toBeNull();
  expect(parseSpokenVersion("", ALL)).toBeNull();
  expect(parseSpokenVersion("good morning church", ALL)).toBeNull();
});

test("a word that merely contains a version id does not count", () => {
  expect(parseSpokenVersion("have a look on the website this week", ALL)).toBeNull();
  expect(parseSpokenVersion("the safety net underneath all of this", ALL)).toBeNull();
});
