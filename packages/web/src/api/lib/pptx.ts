/**
 * PPTX import (best-effort, offline, no native deps — same philosophy as the
 * ProPresenter/.docx importers in this folder).
 *
 * A .pptx is a zip of OOXML parts. We don't attempt a pixel-exact render of
 * shapes/positions/SmartArt — that would need a full layout engine. Instead,
 * per slide, we pull:
 *   - every text run (<a:t>) grouped by paragraph (<a:p>) → lines of text,
 *     with the first non-empty line treated as the heading and the rest as
 *     body — matching how this app already shows text over a background.
 *   - the first embedded image referenced by the slide (its relationships
 *     file), used as the slide's background.
 * Good enough to get a real deck's words and pictures on screen fast; not a
 * substitute for PowerPoint if a deck relies on precise layout.
 */
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";

export type ParsedPptxSlide = {
  heading: string;
  body: string; // newline-separated, may be empty
  image: { data: Uint8Array; ext: string } | null;
  /** Slide background color as #RRGGBB (from the deck's design), or null. */
  bgColor: string | null;
  /** Body/title text color as #RRGGBB (from the deck's design), or null. */
  textColor: string | null;
};

export type ParsedPptx = {
  title: string;
  slides: ParsedPptxSlide[];
};

const IMAGE_EXT_BY_CONTENT: Record<string, string> = {
  png: "png", jpg: "jpg", jpeg: "jpg", gif: "gif", bmp: "bmp", tiff: "tiff", emf: "emf", wmf: "wmf",
};

function textOf(el: Element): string {
  return el.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

/** All text runs in a slide, grouped into paragraph lines (non-empty only). */
function extractLines(slideXml: string): string[] {
  const doc = new DOMParser().parseFromString(slideXml, "text/xml");
  const paragraphs = Array.from(doc.getElementsByTagName("a:p"));
  const lines: string[] = [];
  for (const para of paragraphs) {
    const runs = Array.from(para.getElementsByTagName("a:t"));
    const line = runs.map((r) => textOf(r)).join("");
    const trimmed = line.trim();
    if (trimmed) lines.push(trimmed);
  }
  return lines;
}

/* ---------------- design: colors from the deck's theme ---------------- */

/** clrScheme slot -> #RRGGBB, read from ppt/theme/theme1.xml. */
type ColorScheme = Record<string, string>;

const SCHEME_SLOTS = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

/**
 * A color slot holds either an explicit <a:srgbClr val="RRGGBB"/> or a
 * <a:sysClr lastClr="RRGGBB"/> (system colors like windowText carry their
 * resolved value in lastClr, which is what PowerPoint actually rendered).
 */
function colorFromNode(el: Element | undefined): string | null {
  if (!el) return null;
  const srgb = el.getElementsByTagName("a:srgbClr")[0]?.getAttribute("val");
  if (srgb) return `#${srgb}`;
  const sys = el.getElementsByTagName("a:sysClr")[0]?.getAttribute("lastClr");
  if (sys) return `#${sys}`;
  return null;
}

async function readColorScheme(zip: JSZip): Promise<ColorScheme> {
  const scheme: ColorScheme = {};
  try {
    const xml = await zip.file("ppt/theme/theme1.xml")?.async("string");
    if (!xml) return scheme;
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const clrScheme = doc.getElementsByTagName("a:clrScheme")[0];
    if (!clrScheme) return scheme;
    for (const slot of SCHEME_SLOTS) {
      const c = colorFromNode(clrScheme.getElementsByTagName(`a:${slot}`)[0]);
      if (c) scheme[slot] = c;
    }
  } catch {
    /* no theme — callers fall back to null */
  }
  return scheme;
}

/**
 * Resolve a fill element (<a:solidFill> parent) to #RRGGBB. Handles explicit
 * srgbClr and theme references (<a:schemeClr val="bg1"/>), including the
 * bg1/tx1/bg2/tx2 aliases that map onto the lt1/dk1/lt2/dk2 scheme slots.
 */
function resolveFill(fill: Element | undefined, scheme: ColorScheme): string | null {
  if (!fill) return null;
  const direct = fill.getElementsByTagName("a:srgbClr")[0]?.getAttribute("val");
  if (direct) return `#${direct}`;
  const schemeRef = fill.getElementsByTagName("a:schemeClr")[0]?.getAttribute("val");
  if (schemeRef) {
    const alias: Record<string, string> = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };
    return scheme[alias[schemeRef] ?? schemeRef] ?? null;
  }
  return null;
}

/** Background color declared directly on a slide/layout/master part. */
function backgroundColorOf(xml: string | undefined, scheme: ColorScheme): string | null {
  if (!xml) return null;
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const bg = doc.getElementsByTagName("p:bg")[0];
    if (!bg) return null;
    // Explicit fill on the background properties.
    const solid = bg.getElementsByTagName("a:solidFill")[0];
    const fromSolid = resolveFill(solid, scheme);
    if (fromSolid) return fromSolid;
    // <p:bgRef idx=".."><a:schemeClr val="bg1"/></p:bgRef> — the style index
    // points at a fillStyle we don't model, but its color child is the
    // dominant tone, which is what matters for readability.
    const bgRef = bg.getElementsByTagName("p:bgRef")[0];
    return resolveFill(bgRef, scheme);
  } catch {
    return null;
  }
}

/** First explicit run color in the slide's text, if the deck sets one. */
function textColorOf(xml: string | undefined, scheme: ColorScheme): string | null {
  if (!xml) return null;
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const runProps = Array.from(doc.getElementsByTagName("a:rPr"));
    for (const rPr of runProps) {
      const solid = rPr.getElementsByTagName("a:solidFill")[0];
      const c = resolveFill(solid, scheme);
      if (c) return c;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Readable text color for a background the deck supplied.
 * Most decks never set an explicit run color — they lean on PowerPoint's
 * theme defaults. Inheriting the app's text color instead would put white
 * text on a white imported background (invisible), so when a slide brings
 * its own background but no text color, derive one from the background's
 * perceived brightness.
 */
function readableTextOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const n = parseInt(m[1] ?? "", 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // Rec. 601 luma — the standard weighting for perceived brightness.
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.55 ? "#111111" : "#ffffff";
}

/** Follow a part's rels to the layout/master it inherits design from. */
async function relTargetOf(zip: JSZip, relsPath: string, typeSuffix: string): Promise<string | null> {
  try {
    const xml = await zip.file(relsPath)?.async("string");
    if (!xml) return null;
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    for (const rel of Array.from(doc.getElementsByTagName("Relationship"))) {
      if ((rel.getAttribute("Type") ?? "").endsWith(typeSuffix)) {
        const target = rel.getAttribute("Target") ?? "";
        const base = relsPath.replace(/\/_rels\/[^/]+$/, "");
        const parts = (base + "/" + target).split("/");
        const resolved: string[] = [];
        for (const p of parts) {
          if (p === "..") resolved.pop();
          else if (p !== "." && p !== "") resolved.push(p);
        }
        return resolved.join("/");
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** First image relationship target for a slide, resolved to a zip path. */
function firstImagePath(relsXml: string | undefined): string | null {
  if (!relsXml) return null;
  const doc = new DOMParser().parseFromString(relsXml, "text/xml");
  const rels = Array.from(doc.getElementsByTagName("Relationship"));
  for (const rel of rels) {
    const type = rel.getAttribute("Type") ?? "";
    const target = rel.getAttribute("Target") ?? "";
    if (type.endsWith("/image") && target) {
      // Targets are relative to ppt/slides/, e.g. "../media/image1.png".
      const parts = ("ppt/slides/" + target).split("/");
      const resolved: string[] = [];
      for (const p of parts) {
        if (p === "..") resolved.pop();
        else if (p !== ".") resolved.push(p);
      }
      return resolved.join("/");
    }
  }
  return null;
}

/** Slide order from presentation.xml + its rels; falls back to filename sort. */
async function slideFileOrder(zip: JSZip): Promise<string[]> {
  const fallback = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => {
      const na = Number(a.match(/(\d+)/)?.[1] ?? 0);
      const nb = Number(b.match(/(\d+)/)?.[1] ?? 0);
      return na - nb;
    });

  try {
    const presXml = await zip.file("ppt/presentation.xml")?.async("string");
    const relsXml = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
    if (!presXml || !relsXml) return fallback;

    const relDoc = new DOMParser().parseFromString(relsXml, "text/xml");
    const relEls = Array.from(relDoc.getElementsByTagName("Relationship"));
    const ridToPath = new Map<string, string>();
    for (const rel of relEls) {
      const id = rel.getAttribute("Id");
      const target = rel.getAttribute("Target");
      if (id && target && target.includes("slides/")) ridToPath.set(id, "ppt/" + target.replace(/^\.?\//, ""));
    }

    const presDoc = new DOMParser().parseFromString(presXml, "text/xml");
    const sldIds = Array.from(presDoc.getElementsByTagName("p:sldId"));
    const ordered: string[] = [];
    for (const sld of sldIds) {
      const rid = sld.getAttribute("r:id");
      const path = rid ? ridToPath.get(rid) : undefined;
      if (path && zip.file(path)) ordered.push(path);
    }
    return ordered.length ? ordered : fallback;
  } catch {
    return fallback;
  }
}

const MAX_SLIDES = 300;

export async function parsePptx(buffer: Buffer, fallbackTitle: string): Promise<ParsedPptx> {
  const zip = await JSZip.loadAsync(buffer);

  let title = fallbackTitle;
  try {
    const coreXml = await zip.file("docProps/core.xml")?.async("string");
    if (coreXml) {
      const doc = new DOMParser().parseFromString(coreXml, "text/xml");
      const t = doc.getElementsByTagName("dc:title")[0];
      if (t && textOf(t)) title = textOf(t);
    }
  } catch {
    /* keep fallbackTitle */
  }

  const scheme = await readColorScheme(zip);
  const slidePaths = (await slideFileOrder(zip)).slice(0, MAX_SLIDES);
  const slides: ParsedPptxSlide[] = [];
  // Layout/master parts are shared across many slides — parse each once.
  const inheritedBgCache = new Map<string, string | null>();

  for (const path of slidePaths) {
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const lines = extractLines(xml);
    const [heading = "", ...rest] = lines;

    const slideNum = path.match(/slide(\d+)\.xml$/)?.[1];
    const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
    const relsXml = await zip.file(relsPath)?.async("string");
    const imagePath = firstImagePath(relsXml);

    let image: ParsedPptxSlide["image"] = null;
    if (imagePath) {
      const entry = zip.file(imagePath);
      if (entry) {
        const data = await entry.async("uint8array");
        const ext = IMAGE_EXT_BY_CONTENT[imagePath.split(".").pop()?.toLowerCase() ?? ""] ?? "png";
        image = { data, ext };
      }
    }

    // Background color: PowerPoint resolves slide -> layout -> master, using
    // the first part that actually declares one. Mirror that inheritance so a
    // deck whose design lives on the master still comes across.
    let bgColor = backgroundColorOf(xml, scheme);
    if (!bgColor) {
      const layoutPath = await relTargetOf(zip, relsPath, "/slideLayout");
      if (layoutPath) {
        if (inheritedBgCache.has(layoutPath)) {
          bgColor = inheritedBgCache.get(layoutPath) ?? null;
        } else {
          const layoutXml = await zip.file(layoutPath)?.async("string");
          let resolved = backgroundColorOf(layoutXml, scheme);
          if (!resolved) {
            const layoutRels = layoutPath.replace(/([^/]+)$/, "_rels/$1.rels");
            const masterPath = await relTargetOf(zip, layoutRels, "/slideMaster");
            if (masterPath) {
              const masterXml = await zip.file(masterPath)?.async("string");
              resolved = backgroundColorOf(masterXml, scheme);
            }
          }
          inheritedBgCache.set(layoutPath, resolved);
          bgColor = resolved;
        }
      }
    }

    // Prefer the deck's own run color; otherwise derive one that stays legible
    // on the background we just imported (see readableTextOn).
    const textColor = textColorOf(xml, scheme) ?? (bgColor ? readableTextOn(bgColor) : null);

    // Skip fully-empty slides (no text, no image) rather than importing blanks.
    if (!heading && !rest.length && !image) continue;
    slides.push({ heading, body: rest.join("\n"), image, bgColor, textColor });
  }

  return { title, slides };
}
