/**
 * Client-side render-time paginator (mirrors src/api/lib/paginator.ts).
 * Slides are computed, never stored.
 */

import { parseFormats, toRunLines, type TextAlign, type TextRun } from "./rich-text";

export type SectionInput = {
  id: string;
  label: string;
  type: string;
  lyrics: string;
  manualBreaks?: number[] | null;
  translationLyrics?: string | null;
  /** JSON TextFormat[] over `lyrics`; null = plain text. */
  format?: string | null;
  textAlign?: string | null;
};

export type PaginatorMode = "fixed" | "manual" | "autofit";

export type PaginatorOptions = {
  linesPerSlide: number;
  mode: PaginatorMode;
  dualLanguage?: boolean;
  maxLinesFit?: number;
};

export type Slide = {
  id: string;
  sectionId: string;
  sectionLabel: string;
  sectionType: string;
  sourceLines: string[];
  translationLines: string[];
  /** Formatted runs parallel to sourceLines; absent when the section is plain. */
  sourceRuns?: TextRun[][];
  textAlign?: TextAlign | null;
};

function chunk<T>(arr: T[], n: number): T[][] {
  if (n <= 0) n = 2;
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function splitAtIndexes<T>(arr: T[], breaks: number[]): T[][] {
  const sorted = [...new Set(breaks)].filter((b) => b > 0 && b < arr.length).sort((a, b) => a - b);
  const out: T[][] = [];
  let start = 0;
  for (const b of sorted) {
    out.push(arr.slice(start, b));
    start = b;
  }
  out.push(arr.slice(start));
  return out.filter((g) => g.length > 0);
}

export function generateSlides(section: SectionInput, options: PaginatorOptions): Slide[] {
  const lines = section.lyrics.split("\n").map((l) => l.replace(/\r$/, ""));
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();

  // Each line is chunked together with its own formatting runs. Splitting the
  // two separately and re-pairing them by index afterwards would go wrong the
  // moment a slide boundary lands mid-section, painting a colour onto whatever
  // line happened to take that position on the next slide.
  const formats = parseFormats(section.format);
  const runLines = formats.length ? toRunLines(section.lyrics, formats) : null;
  const entries = lines.map((text, i) => ({ text, runs: runLines?.[i] }));

  let groups: { text: string; runs?: TextRun[] }[][];
  if (options.mode === "manual" && section.manualBreaks && section.manualBreaks.length) {
    groups = splitAtIndexes(entries, section.manualBreaks);
  } else if (options.mode === "autofit") {
    groups = chunk(entries, Math.max(1, options.maxLinesFit ?? 4));
  } else {
    groups = chunk(entries, options.linesPerSlide);
  }

  let trLines: string[] = [];
  if (options.dualLanguage && section.translationLyrics) {
    trLines = section.translationLyrics.split("\n").map((l) => l.replace(/\r$/, ""));
  }

  const slides: Slide[] = [];
  let cursor = 0;
  groups.forEach((g, gi) => {
    const translationLines =
      options.dualLanguage && trLines.length ? trLines.slice(cursor, cursor + g.length) : [];
    slides.push({
      id: `${section.id}#${gi}`,
      sectionId: section.id,
      sectionLabel: section.label,
      sectionType: section.type,
      sourceLines: g.map((e) => e.text),
      translationLines,
      ...(runLines ? { sourceRuns: g.map((e) => e.runs ?? [{ text: e.text }]) } : {}),
      textAlign: (section.textAlign as TextAlign | null) ?? null,
    });
    cursor += g.length;
  });
  return slides;
}

export function buildRenderList(orderedSections: SectionInput[], options: PaginatorOptions): Slide[] {
  const out: Slide[] = [];
  orderedSections.forEach((section, itemIdx) => {
    const slides = generateSlides(section, options);
    slides.forEach((s, i) => out.push({ ...s, id: `${itemIdx}:${section.id}#${i}` }));
  });
  return out;
}
