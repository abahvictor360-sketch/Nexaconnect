/**
 * Seed the bundled library:
 *  - 100 public-domain hymns (from open-hymnal-json)
 *  - Curated Nigerian gospel / Afro-gospel songs
 *  - A default dark high-contrast theme
 *  - Default settings row
 *
 * Run: bun run src/api/seed.ts   (from packages/web)
 */
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { db } from "./database";
import * as schema from "./database/schema";
import { createSongWithSections } from "./lib/songs";
import { parseStructure } from "./lib/structure";
import { nigerianGospel } from "./seed-data/nigerian-gospel";
import hymnData from "./seed-data/hymns.json";

type HymnLyric = { verse?: number; content: string; type: string };
type Hymn = { id: number; number: string; title: string; lyrics: HymnLyric[]; category?: string };

// Seed every hymn in the bundled public-domain dataset (300 as of v1.0.1).
const HYMN_LIMIT = Infinity;

function hymnToSections(h: Hymn) {
  let verseCount = 0;
  const sections = h.lyrics.map((l) => {
    if (l.type === "chorus") {
      return { type: "chorus", label: "Chorus", number: null as number | null, lyrics: l.content.trim() };
    }
    verseCount += 1;
    const num = l.verse ?? verseCount;
    return { type: "verse", label: `Verse ${num}`, number: num, lyrics: l.content.trim() };
  });
  return sections.filter((s) => s.lyrics);
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");

  const existing = await db.select().from(schema.songs);
  if (existing.length > 0 && !force) {
    console.log(`Library already has ${existing.length} songs. Use --force to reseed (this wipes songs).`);
    await ensureThemeAndSettings();
    return;
  }

  if (force && existing.length) {
    console.log("Force reseed - wiping songs, sections, arrangements...");
    await db.delete(schema.arrangementItems);
    await db.delete(schema.arrangements);
    await db.delete(schema.translations);
    await db.delete(schema.sections);
    await db.delete(schema.songs);
  }

  // --- Hymns ---
  const hymns = (hymnData as { hymns: Hymn[] }).hymns.slice(0, HYMN_LIMIT);
  let hymnCount = 0;
  for (const h of hymns) {
    const sections = hymnToSections(h);
    if (!sections.length) continue;
    await createSongWithSections({
      title: h.title,
      sections,
      source: "library",
      tags: ["hymn", h.category ?? "traditional"].filter(Boolean),
      copyright: "Public Domain",
    });
    hymnCount++;
  }
  console.log(`Seeded ${hymnCount} hymns.`);

  // --- Nigerian gospel ---
  let ngCount = 0;
  for (const s of nigerianGospel) {
    const sections = parseStructure(s.raw);
    if (!sections.length) continue;
    await createSongWithSections({
      title: s.title,
      authors: s.authors,
      copyright: s.copyright,
      ccliNumber: s.ccliNumber,
      tags: s.tags ?? ["nigerian", "gospel"],
      defaultLang: s.lang ?? "en",
      sections,
      source: "library",
    });
    ngCount++;
  }
  console.log(`Seeded ${ngCount} Nigerian gospel songs.`);

  await ensureThemeAndSettings();

  const total = await db.select().from(schema.songs);
  console.log(`Done. Library now has ${total.length} songs.`);
}

async function ensureThemeAndSettings() {
  const themes = await db.select().from(schema.themes);
  let themeId = themes[0]?.id;
  if (!themes.length) {
    themeId = uuid();
    await db.insert(schema.themes).values({
      id: themeId,
      name: "Vifug Dark",
      fontSize: null, // auto-fit
      fontWeight: 600,
      textColor: "#FFFFFF",
      textAlign: "center",
      textOutline: JSON.stringify({ color: "rgba(0,0,0,0.6)", width: 2 }),
      bgColor: "#0a0a0c",
      overlayScrim: 0,
      displayMode: "fullscreen",
      maxLines: 2,
      verticalPos: "center",
      safeMargin: 8,
      transition: "fade",
      transitionMs: 300,
    });
    console.log("Created default theme 'Vifug Dark'.");
  }

  const [settingsRow] = await db.select().from(schema.settings).where(eq(schema.settings.id, "app"));
  const config = {
    activeThemeId: themeId ?? null,
    linesPerSlide: 2,
    paginatorMode: "fixed",
    songDisplayLang: null,
    dualLanguage: false,
    output: { displayId: null, resolution: "auto" },
    ui: { language: "en" },
    // The installer ships this database, so a row written here IS a fresh
    // install and must ask the welcome question. Without the flag the app
    // reads it as absent/false and silently skips the dialog.
    //
    // Deliberately set only on the insert path below: an existing settings row
    // means someone already using the app, and re-raising the dialog on
    // upgrade would offer to wipe a library they have been building.
    firstRun: true,
  };
  if (!settingsRow) {
    await db.insert(schema.settings).values({ id: "app", config: JSON.stringify(config) });
    console.log("Created default settings.");
  } else {
    // keep existing but ensure activeThemeId set
    const cur = JSON.parse(settingsRow.config);
    if (!cur.activeThemeId && themeId) {
      cur.activeThemeId = themeId;
      await db.update(schema.settings).set({ config: JSON.stringify(cur) }).where(eq(schema.settings.id, "app"));
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
