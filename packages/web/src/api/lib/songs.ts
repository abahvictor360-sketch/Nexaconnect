import { v4 as uuid } from "uuid";
import { eq, asc } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import type { ParsedSection } from "./structure";

const nowIso = () => new Date().toISOString();

export type FullSong = {
  song: typeof schema.songs.$inferSelect;
  sections: (typeof schema.sections.$inferSelect)[];
  arrangements: {
    arrangement: typeof schema.arrangements.$inferSelect;
    items: (typeof schema.arrangementItems.$inferSelect)[];
  }[];
};

/** Create a song with sections and a default arrangement (all sections in order). */
export async function createSongWithSections(input: {
  title: string;
  source?: string;
  defaultLang?: string;
  authors?: string[];
  copyright?: string;
  ccliNumber?: string;
  tags?: string[];
  themeId?: string | null;
  backgroundId?: string | null;
  textColor?: string | null;
  sections: ParsedSection[];
}): Promise<string> {
  const songId = uuid();
  const ts = nowIso();
  await db.insert(schema.songs).values({
    id: songId,
    title: input.title,
    authors: input.authors ? JSON.stringify(input.authors) : null,
    copyright: input.copyright ?? null,
    ccliNumber: input.ccliNumber ?? null,
    defaultLang: input.defaultLang ?? "en",
    tags: input.tags ? JSON.stringify(input.tags) : null,
    themeId: input.themeId ?? null,
    backgroundId: input.backgroundId ?? null,
    textColor: input.textColor ?? null,
    source: input.source ?? "manual",
    createdAt: ts,
    updatedAt: ts,
  });

  const sectionRows = input.sections.map((s, i) => ({
    id: uuid(),
    songId,
    type: s.type,
    label: s.label,
    number: s.number ?? null,
    lang: input.defaultLang ?? "en",
    lyrics: s.lyrics,
    manualBreaks: null,
    orderIndex: i,
  }));
  if (sectionRows.length) await db.insert(schema.sections).values(sectionRows);

  await buildDefaultArrangement(songId, sectionRows.map((r) => r.id));
  return songId;
}

/** (Re)build the default arrangement to include all sections in order_index order. */
export async function buildDefaultArrangement(songId: string, sectionIdsInOrder?: string[]) {
  // Remove existing default arrangement(s)
  const existing = await db
    .select()
    .from(schema.arrangements)
    .where(eq(schema.arrangements.songId, songId));
  for (const a of existing) {
    if (a.isDefault) {
      await db.delete(schema.arrangementItems).where(eq(schema.arrangementItems.arrangementId, a.id));
      await db.delete(schema.arrangements).where(eq(schema.arrangements.id, a.id));
    }
  }

  let ids = sectionIdsInOrder;
  if (!ids) {
    const secs = await db
      .select()
      .from(schema.sections)
      .where(eq(schema.sections.songId, songId))
      .orderBy(asc(schema.sections.orderIndex));
    ids = secs.map((s) => s.id);
  }

  const arrId = uuid();
  await db.insert(schema.arrangements).values({
    id: arrId,
    songId,
    name: "Default",
    isDefault: 1,
  });
  if (ids.length) {
    await db.insert(schema.arrangementItems).values(
      ids.map((sectionId, i) => ({
        id: uuid(),
        arrangementId: arrId,
        sectionId,
        orderIndex: i,
      })),
    );
  }
  return arrId;
}

export async function getFullSong(songId: string): Promise<FullSong | null> {
  const [song] = await db.select().from(schema.songs).where(eq(schema.songs.id, songId));
  if (!song) return null;
  const sections = await db
    .select()
    .from(schema.sections)
    .where(eq(schema.sections.songId, songId))
    .orderBy(asc(schema.sections.orderIndex));
  const arrs = await db
    .select()
    .from(schema.arrangements)
    .where(eq(schema.arrangements.songId, songId));
  const arrangements = [];
  for (const a of arrs) {
    const items = await db
      .select()
      .from(schema.arrangementItems)
      .where(eq(schema.arrangementItems.arrangementId, a.id))
      .orderBy(asc(schema.arrangementItems.orderIndex));
    arrangements.push({ arrangement: a, items });
  }
  return { song, sections, arrangements };
}
