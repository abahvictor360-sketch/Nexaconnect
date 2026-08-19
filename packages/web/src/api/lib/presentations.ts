import { v4 as uuid } from "uuid";
import { eq, asc, inArray } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";

const nowIso = () => new Date().toISOString();

export type PresentationSlideInput = {
  heading?: string | null;
  body?: string | null;
  backgroundId?: string | null;
  /** Design carried from an imported deck; null = inherit the app theme. */
  bgColor?: string | null;
  textColor?: string | null;
  /** JSON TextFormat[] over `body`: per-word colour and emphasis. */
  format?: string | null;
  /** Alignment override; null = inherit the theme's. */
  textAlign?: string | null;
};

export type FullPresentation = {
  presentation: typeof schema.presentations.$inferSelect;
  slides: (typeof schema.presentationSlides.$inferSelect)[];
};

export async function createPresentation(input: {
  title: string;
  source?: string;
  slides: PresentationSlideInput[];
}): Promise<string> {
  const id = uuid();
  const ts = nowIso();
  await db.insert(schema.presentations).values({
    id,
    title: input.title,
    source: input.source ?? "manual",
    createdAt: ts,
    updatedAt: ts,
  });
  if (input.slides.length) {
    await db.insert(schema.presentationSlides).values(
      input.slides.map((s, i) => ({
        id: uuid(),
        presentationId: id,
        orderIndex: i,
        heading: s.heading ?? null,
        body: s.body ?? null,
        backgroundId: s.backgroundId ?? null,
        bgColor: s.bgColor ?? null,
        textColor: s.textColor ?? null,
        format: s.format ?? null,
        textAlign: s.textAlign ?? null,
      })),
    );
  }
  return id;
}

export async function getFullPresentation(id: string): Promise<FullPresentation | null> {
  const [presentation] = await db.select().from(schema.presentations).where(eq(schema.presentations.id, id));
  if (!presentation) return null;
  const slides = await db
    .select()
    .from(schema.presentationSlides)
    .where(eq(schema.presentationSlides.presentationId, id))
    .orderBy(asc(schema.presentationSlides.orderIndex));
  return { presentation, slides };
}

/** Full replace of title + slides (mirrors the song editor's PUT semantics). */
export async function replacePresentation(
  id: string,
  input: { title?: string; slides?: PresentationSlideInput[] },
): Promise<boolean> {
  const [existing] = await db.select().from(schema.presentations).where(eq(schema.presentations.id, id));
  if (!existing) return false;

  await db
    .update(schema.presentations)
    .set({ title: input.title?.trim() || existing.title, updatedAt: nowIso() })
    .where(eq(schema.presentations.id, id));

  if (input.slides) {
    await db.delete(schema.presentationSlides).where(eq(schema.presentationSlides.presentationId, id));
    if (input.slides.length) {
      await db.insert(schema.presentationSlides).values(
        // bgColor/textColor were previously omitted here, so saving any edit
        // to a deck imported from PowerPoint silently threw away the design
        // that was imported with it.
        input.slides.map((s, i) => ({
          id: uuid(),
          presentationId: id,
          orderIndex: i,
          heading: s.heading ?? null,
          body: s.body ?? null,
          backgroundId: s.backgroundId ?? null,
          bgColor: s.bgColor ?? null,
          textColor: s.textColor ?? null,
          format: s.format ?? null,
          textAlign: s.textAlign ?? null,
        })),
      );
    }
  }
  return true;
}

export async function deletePresentation(id: string): Promise<void> {
  const slides = await db
    .select()
    .from(schema.presentationSlides)
    .where(eq(schema.presentationSlides.presentationId, id));

  // Pages rendered from an imported deck exist only to be this presentation's
  // backgrounds and are hidden from the media library, so deleting the deck
  // has to take them too - otherwise they pile up as rows nobody can see or
  // remove. Backgrounds the operator chose themselves are left alone: those
  // are library items that happen to be used here.
  const backgroundIds = slides.map((s) => s.backgroundId).filter((b): b is string => !!b);
  if (backgroundIds.length) {
    const used = await db.select().from(schema.media).where(inArray(schema.media.id, backgroundIds));
    const deckPages = used.filter((m) => m.role === "slide").map((m) => m.id);
    if (deckPages.length) {
      await db.delete(schema.media).where(inArray(schema.media.id, deckPages));
    }
  }

  await db.delete(schema.presentationSlides).where(eq(schema.presentationSlides.presentationId, id));
  await db.delete(schema.presentations).where(eq(schema.presentations.id, id));
}
