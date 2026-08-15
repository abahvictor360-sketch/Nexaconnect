/**
 * Song structure detector for imports.
 * Splits raw text into sections by blank-line blocks and recognizes headers
 * like "Chorus", "Verse 2", "Bridge", "Pre-Chorus", "Tag", "Intro", "Ending".
 */

export type ParsedSection = {
  type: string;
  label: string;
  number: number | null;
  lyrics: string;
};

const TYPE_PATTERNS: { re: RegExp; type: string; label: string }[] = [
  { re: /^pre[-\s]?chorus\b/i, type: "pre_chorus", label: "Pre-Chorus" },
  { re: /^chorus\b/i, type: "chorus", label: "Chorus" },
  { re: /^refrain\b/i, type: "refrain", label: "Refrain" },
  { re: /^bridge\b/i, type: "bridge", label: "Bridge" },
  { re: /^verse\b/i, type: "verse", label: "Verse" },
  { re: /^intro\b/i, type: "intro", label: "Intro" },
  { re: /^ending\b|^outro\b/i, type: "ending", label: "Ending" },
  { re: /^tag\b/i, type: "tag", label: "Tag" },
];

function detectHeader(line: string): { type: string; label: string; number: number | null } | null {
  // Strip common wrappers: [Chorus], (Verse 1), Chorus:, VERSE 2
  const cleaned = line.trim().replace(/^[\[\(]|[\]\):]+$/g, "").trim();
  if (!cleaned || cleaned.length > 24) return null;
  for (const p of TYPE_PATTERNS) {
    if (p.re.test(cleaned)) {
      const num = cleaned.match(/(\d+)/)?.[1];
      const number = num ? parseInt(num, 10) : null;
      const label = number ? `${p.label} ${number}` : p.label;
      return { type: p.type, label, number };
    }
  }
  return null;
}

/**
 * Force a blank-line break before every header line that doesn't already
 * have one. Word/docx extraction (mammoth) and plain copy-pasted text often
 * lose the blank line between sections even though "Chorus" / "Verse 2"
 * still sit on their own line - without this, the whole document collapses
 * into one blank-line block and only the very first header is ever detected.
 */
function forceBreaksBeforeHeaders(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let prevBlank = true; // start of text counts as blank - no break needed before line 1
  for (const line of lines) {
    const isHeader = !!detectHeader(line.trim());
    if (isHeader && !prevBlank) out.push("");
    out.push(line);
    prevBlank = line.trim() === "";
  }
  return out.join("\n");
}

export function parseStructure(raw: string, title?: string): ParsedSection[] {
  let text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return [];
  text = forceBreaksBeforeHeaders(text);

  let blocks = text.split(/\n\s*\n/).map((b) => b.replace(/\n+$/, "")).filter((b) => b.trim());

  // Drop a leading title-only block: a single-line first block that isn't a
  // section header and matches the song title (case-insensitive). This keeps
  // "Song Title\n\nVerse 1\n..." style imports from treating the title as lyrics.
  if (blocks.length > 1) {
    const firstBlock = (blocks[0] ?? "").trim();
    const isSingleLine = !firstBlock.includes("\n");
    const t = title?.trim().toLowerCase();
    if (
      isSingleLine &&
      !detectHeader(firstBlock) &&
      (t ? firstBlock.toLowerCase() === t : firstBlock.toLowerCase() === guessTitle(text).toLowerCase())
    ) {
      blocks = blocks.slice(1);
    }
  }
  const sections: ParsedSection[] = [];
  const counters: Record<string, number> = {};

  const pushSection = (type: string, label: string, number: number | null, lines: string[]) => {
    const lyrics = lines.join("\n").trim();
    if (!lyrics) return;
    sections.push({ type, label, number, lyrics });
  };

  for (const block of blocks) {
    const lines = block.split("\n");
    const first = lines[0]?.trim() ?? "";
    const header = detectHeader(first);

    if (header) {
      const body = lines.slice(1);
      let { type, label, number } = header;
      // Auto-number verses if header had no number and there are multiple.
      if (number == null) {
        counters[type] = (counters[type] ?? 0) + 1;
        if (type === "verse") {
          number = counters[type];
          label = `Verse ${number}`;
        }
      }
      pushSection(type, label, number, body);
    } else {
      // No header - treat as a verse; auto-number.
      counters.verse = (counters.verse ?? 0) + 1;
      const number = counters.verse;
      pushSection("verse", `Verse ${number}`, number, lines);
    }
  }

  // If everything collapsed to one unlabeled block, still return it as Verse 1.
  if (!sections.length && text) {
    sections.push({ type: "verse", label: "Verse 1", number: 1, lyrics: text });
  }

  return sections;
}

/** Fallback title guess from filename or first line. */
export function guessTitle(input: string): string {
  // First non-empty line that ISN'T a section header (e.g. "Verse 1", "Chorus").
  const firstLine = input
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !detectHeader(l));
  return (firstLine ?? "Untitled Song").slice(0, 120);
}
