/**
 * ProPresenter import (best-effort, offline, no native deps).
 *
 * .pro6  → XML document. Slides live in <RVDisplaySlide> elements; the lyric
 *          text is a base64-encoded RTF blob inside <NSString .../> under a
 *          <RVTextElement>. Group names (Verse 1, Chorus…) come from the
 *          enclosing <RVSlideGrouping name="…">.
 * .pro   → ProPresenter 7 uses a protobuf binary. We can't fully parse protobuf
 *          without the schema, so we do a resilient best-effort: pull any RTF
 *          runs we can find and any readable UTF-8 lyric-looking text. Group
 *          labels are recovered from embedded strings when present.
 *
 * Output: { title, sections[] } compatible with ParsedSection.
 */
import type { ParsedSection } from "./structure";

export type ParsedSong = { title: string; sections: ParsedSection[] };

const TYPE_PATTERNS: { re: RegExp; type: string; label: string }[] = [
  { re: /^pre[-\s]?chorus/i, type: "pre_chorus", label: "Pre-Chorus" },
  { re: /^chorus/i, type: "chorus", label: "Chorus" },
  { re: /^refrain/i, type: "refrain", label: "Refrain" },
  { re: /^bridge/i, type: "bridge", label: "Bridge" },
  { re: /^verse/i, type: "verse", label: "Verse" },
  { re: /^intro/i, type: "intro", label: "Intro" },
  { re: /^ending|^outro/i, type: "ending", label: "Ending" },
  { re: /^tag/i, type: "tag", label: "Tag" },
];

function labelToType(name: string): { type: string; label: string; number: number | null } {
  const clean = name.trim();
  for (const p of TYPE_PATTERNS) {
    if (p.re.test(clean)) {
      const m = clean.match(/(\d+)/);
      return { type: p.type, label: clean || p.label, number: m ? Number(m[1]) : null };
    }
  }
  return { type: "verse", label: clean || "Verse", number: null };
}

/** Strip RTF control words to recover plain text with line breaks. */
function rtfToText(rtf: string): string {
  let s = rtf;
  // Convert explicit line/paragraph breaks first.
  s = s.replace(/\\par[d]?\b/g, "\n").replace(/\\line\b/g, "\n");
  // Unicode escapes: \uNNNN? → char
  s = s.replace(/\\u(-?\d+)\??/g, (_, n) => {
    let code = Number(n);
    if (code < 0) code += 65536;
    return String.fromCharCode(code);
  });
  // Hex escapes: \'hh
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  // Drop RTF groups' font tables / color tables entirely.
  s = s.replace(/\{\\(?:fonttbl|colortbl|\*\\[^{}]*)[^{}]*\}/g, "");
  // Remove remaining control words (\word, optional number).
  s = s.replace(/\\[a-zA-Z]+-?\d* ?/g, "");
  // Remove stray braces.
  s = s.replace(/[{}]/g, "");
  // Normalise whitespace.
  return s
    .split("\n")
    .map((l) => l.replace(/\u0000/g, "").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeBase64(b64: string): string {
  try {
    return Buffer.from(b64.trim(), "base64").toString("utf8");
  } catch {
    return "";
  }
}

/** Parse a ProPresenter 6 (.pro6) XML document. */
export function parsePro6(xml: string, fallbackTitle: string): ParsedSong {
  const sections: ParsedSection[] = [];

  // Split into slide-group chunks so we can attach the right label to slides.
  // RVSlideGrouping has a name attribute; each contains RVDisplaySlides.
  const groupRe = /<RVSlideGrouping\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/RVSlideGrouping>/g;
  const counters: Record<string, number> = {};

  const pushGroup = (groupName: string, body: string) => {
    // Text runs: base64 RTF inside NSString elements.
    const texts: string[] = [];
    const nsRe = /<NSString[^>]*rvXMLIvarName="RTFData"[^>]*>([\s\S]*?)<\/NSString>/g;
    let m: RegExpExecArray | null;
    while ((m = nsRe.exec(body))) {
      const rtf = decodeBase64(m[1] ?? "");
      const txt = rtfToText(rtf);
      if (txt) texts.push(txt);
    }
    const lyrics = texts.join("\n").trim();
    if (!lyrics) return;
    let { type, label, number } = labelToType(groupName);
    if (number == null) {
      counters[type] = (counters[type] ?? 0) + 1;
      if (type === "verse" || type === "chorus") number = counters[type];
    }
    sections.push({ type, label, number, lyrics });
  };

  let g: RegExpExecArray | null;
  let matchedGroup = false;
  while ((g = groupRe.exec(xml))) {
    matchedGroup = true;
    pushGroup(g[1] || "Verse", g[2] ?? "");
  }

  // Fallback: no groupings - grab every RTFData blob as its own verse.
  if (!matchedGroup) {
    const nsRe = /<NSString[^>]*rvXMLIvarName="RTFData"[^>]*>([\s\S]*?)<\/NSString>/g;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = nsRe.exec(xml))) {
      const txt = rtfToText(decodeBase64(m[1] ?? ""));
      if (txt) {
        i += 1;
        sections.push({ type: "verse", label: `Verse ${i}`, number: i, lyrics: txt });
      }
    }
  }

  const titleAttr = xml.match(/CCLISongTitle="([^"]*)"/)?.[1];
  const title = (titleAttr || fallbackTitle).trim() || "Imported Song";
  return { title, sections };
}

/** Best-effort parse of a ProPresenter 7 (.pro) protobuf binary. */
export function parseProBinary(buf: Buffer, fallbackTitle: string): ParsedSong {
  const sections: ParsedSection[] = [];
  const raw = buf.toString("latin1");

  // 1) Try to recover RTF runs embedded in the binary.
  const rtfRuns = raw.match(/\{\\rtf[\s\S]*?\}\s*(?=\{\\rtf|$)/g) ?? [];
  let i = 0;
  for (const run of rtfRuns) {
    const txt = rtfToText(run);
    if (txt && /[A-Za-z\u00C0-\uFFFF]/.test(txt)) {
      i += 1;
      sections.push({ type: "verse", label: `Verse ${i}`, number: i, lyrics: txt });
    }
  }

  // 2) If nothing recovered, fall back to readable UTF-8 text chunks.
  if (!sections.length) {
    const utf8 = buf.toString("utf8");
    const chunks = utf8
      .split(/[\u0000-\u0008\u000e-\u001f]+/)
      .map((c) => c.trim())
      .filter((c) => c.length > 12 && /\s/.test(c) && /[A-Za-z\u00C0-\uFFFF]/.test(c));
    let j = 0;
    for (const c of chunks.slice(0, 40)) {
      j += 1;
      sections.push({ type: "verse", label: `Verse ${j}`, number: j, lyrics: c });
    }
  }

  return { title: fallbackTitle.trim() || "Imported Song", sections };
}

/** Route by extension. */
export function parseProPresenter(
  filename: string,
  data: Buffer,
): ParsedSong {
  const name = filename.toLowerCase();
  const fallback = filename.replace(/\.(pro6?|proBundle)$/i, "");
  if (name.endsWith(".pro6")) {
    return parsePro6(data.toString("utf8"), fallback);
  }
  // .pro (PP7) or unknown → binary best-effort.
  return parseProBinary(data, fallback);
}
