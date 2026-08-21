/**
 * Render-time paginator - the heart of Vifug.
 * Slides are NOT stored; they are computed from a section + display options.
 * This single function absorbs the 2/3/custom/manual line feature and feeds
 * the (future) AI follower - every slide carries its own known text.
 */

export type SectionInput = {
  id: string;
  label: string;
  type: string;
  lyrics: string; // newline-separated
  manualBreaks?: number[] | null; // line indexes where user forced a break
  translationLyrics?: string | null; // aligned, newline-separated (optional)
};

export type PaginatorMode = "fixed" | "manual" | "autofit";

export type PaginatorOptions = {
  linesPerSlide: number; // for fixed mode (2, 3, custom N)
  mode: PaginatorMode;
  dualLanguage?: boolean;
  maxLinesFit?: number; // for autofit approximation
};

export type Slide = {
  id: string; // stable id: sectionId#index
  sectionId: string;
  sectionLabel: string;
  sectionType: string;
  sourceLines: string[];
  translationLines: string[];
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

/** Rough autofit: pack lines so no group exceeds maxLinesFit (defaults to a sane cap). */
function packToFit(lines: string[], maxLinesFit: number): string[][] {
  const cap = Math.max(1, maxLinesFit || 4);
  return chunk(lines, cap);
}

export function generateSlides(section: SectionInput, options: PaginatorOptions): Slide[] {
  const lines = section.lyrics.split("\n").map((l) => l.replace(/\r$/, ""));
  // Drop trailing empty lines but keep internal blanks meaningful only if surrounded.
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();

  let groups: string[][];
  if (options.mode === "manual" && section.manualBreaks && section.manualBreaks.length) {
    groups = splitAtIndexes(lines, section.manualBreaks);
  } else if (options.mode === "autofit") {
    groups = packToFit(lines, options.maxLinesFit ?? 4);
  } else {
    groups = chunk(lines, options.linesPerSlide);
  }

  // Dual-language: attach aligned translation lines by index.
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
      sourceLines: g,
      translationLines,
    });
    cursor += g.length;
  });

  return slides;
}

/** Expand an ordered arrangement (list of sections, repeats allowed) into a flat slide list. */
export function buildRenderList(orderedSections: SectionInput[], options: PaginatorOptions): Slide[] {
  const out: Slide[] = [];
  orderedSections.forEach((section, itemIdx) => {
    const slides = generateSlides(section, options);
    // Namespace slide ids by arrangement position so repeats get unique ids.
    slides.forEach((s, i) => out.push({ ...s, id: `${itemIdx}:${section.id}#${i}` }));
  });
  return out;
}
