/**
 * Vifug Lyrics — free, offline-first worship presentation software.
 * Created by Victor Abah (github.com/abahvictor360-sketch).
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { v4 as uuid } from "uuid";
import fsp from "node:fs/promises";
import nodePath from "node:path";
import { eq, asc, desc } from "drizzle-orm";
import mammoth from "mammoth";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, S3_BUCKET } from "./lib/s3";
import { db } from "./database";
import * as schema from "./database/schema";
import { parseStructure, guessTitle } from "./lib/structure";
import { parseProPresenter } from "./lib/propresenter";
import { getLiveState, setLiveState, subscribeLive } from "./lib/live-store";
import {
  getStage, setStage, subscribeStage,
  sendRemote, subscribeRemote,
} from "./lib/channels";
import {
  createSongWithSections,
  buildDefaultArrangement,
  getFullSong,
} from "./lib/songs";
import {
  createPresentation,
  getFullPresentation,
  replacePresentation,
  deletePresentation,
} from "./lib/presentations";
import { parsePptx } from "./lib/pptx";

const nowIso = () => new Date().toISOString();

/**
 * Built-in themes guaranteed to exist (inserted lazily by GET /themes).
 * Matched by name — renaming one in the DB effectively forks it.
 */
const BUILTIN_THEMES: Omit<typeof schema.themes.$inferInsert, "id">[] = [
  {
    name: "Navy Blue",
    fontSize: null,
    fontWeight: 600,
    textColor: "#FFFFFF",
    textAlign: "center",
    textOutline: JSON.stringify({ color: "rgba(0,0,0,0.6)", width: 2 }),
    bgColor: "#0b1f3f",
    overlayScrim: 0,
    displayMode: "fullscreen",
    maxLines: 2,
    verticalPos: "center",
    safeMargin: 8,
    transition: "fade",
    transitionMs: 300,
  },
  {
    name: "Emerald Green",
    fontSize: null,
    fontWeight: 600,
    textColor: "#FFFFFF",
    textAlign: "center",
    textOutline: JSON.stringify({ color: "rgba(0,0,0,0.6)", width: 2 }),
    bgColor: "#064e3b",
    overlayScrim: 0,
    displayMode: "fullscreen",
    maxLines: 2,
    verticalPos: "center",
    safeMargin: 8,
    transition: "fade",
    transitionMs: 300,
  },
];

const app = new Hono()
  .basePath("api")
  .use(cors({ origin: (origin) => origin ?? "*", credentials: true, exposeHeaders: ["set-auth-token"] }))
  .get("/health", (c) => c.json({ status: "ok" }, 200))

  // ---------- SONGS ----------
  .get("/songs", async (c) => {
    const q = (c.req.query("q") ?? "").trim().toLowerCase();
    const rows = await db.select().from(schema.songs).orderBy(asc(schema.songs.title));
    const list = rows
      .map((s) => ({
        id: s.id,
        title: s.title,
        authors: s.authors ? (JSON.parse(s.authors) as string[]) : [],
        tags: s.tags ? (JSON.parse(s.tags) as string[]) : [],
        defaultLang: s.defaultLang,
        source: s.source,
        ccliNumber: s.ccliNumber,
        copyright: s.copyright,
        updatedAt: s.updatedAt,
      }))
      .filter((s) =>
        q
          ? s.title.toLowerCase().includes(q) ||
            s.authors.some((a) => a.toLowerCase().includes(q)) ||
            s.tags.some((t) => t.toLowerCase().includes(q))
          : true,
      );
    return c.json({ songs: list }, 200);
  })

  .get("/songs/:id", async (c) => {
    const full = await getFullSong(c.req.param("id"));
    if (!full) return c.json({ error: "not found" }, 404);
    return c.json(full, 200);
  })

  .post("/songs", async (c) => {
    const body = await c.req.json<{
      title?: string;
      defaultLang?: string;
      authors?: string[];
      copyright?: string;
      ccliNumber?: string;
      tags?: string[];
      themeId?: string | null;
      backgroundId?: string | null;
      textColor?: string | null;
      sections?: { type: string; label: string; number?: number | null; lyrics: string }[];
    }>();
    const sections = (body.sections ?? []).map((s) => ({
      type: s.type || "verse",
      label: s.label || "Verse",
      number: s.number ?? null,
      lyrics: s.lyrics ?? "",
    }));
    const id = await createSongWithSections({
      title: body.title?.trim() || "Untitled Song",
      defaultLang: body.defaultLang,
      authors: body.authors,
      copyright: body.copyright,
      ccliNumber: body.ccliNumber,
      tags: body.tags,
      themeId: body.themeId,
      backgroundId: body.backgroundId,
      textColor: body.textColor,
      sections,
      source: "manual",
    });
    return c.json({ id }, 201);
  })

  // Full replace of a song's meta + sections; rebuilds default arrangement.
  .put("/songs/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{
      title?: string;
      defaultLang?: string;
      authors?: string[];
      copyright?: string;
      ccliNumber?: string;
      tags?: string[];
      themeId?: string | null;
      backgroundId?: string | null;
      textColor?: string | null;
      sections?: { type: string; label: string; number?: number | null; lyrics: string; manualBreaks?: number[] | null }[];
    }>();
    const [existing] = await db.select().from(schema.songs).where(eq(schema.songs.id, id));
    if (!existing) return c.json({ error: "not found" }, 404);

    await db
      .update(schema.songs)
      .set({
        title: body.title?.trim() || existing.title,
        defaultLang: body.defaultLang ?? existing.defaultLang,
        authors: body.authors ? JSON.stringify(body.authors) : existing.authors,
        copyright: body.copyright ?? existing.copyright,
        ccliNumber: body.ccliNumber ?? existing.ccliNumber,
        tags: body.tags ? JSON.stringify(body.tags) : existing.tags,
        themeId: body.themeId !== undefined ? body.themeId : existing.themeId,
        backgroundId: body.backgroundId !== undefined ? body.backgroundId : existing.backgroundId,
        textColor: body.textColor !== undefined ? body.textColor : existing.textColor,
        updatedAt: nowIso(),
      })
      .where(eq(schema.songs.id, id));

    if (body.sections) {
      await db.delete(schema.sections).where(eq(schema.sections.songId, id));
      const rows = body.sections.map((s, i) => ({
        id: uuid(),
        songId: id,
        type: s.type || "verse",
        label: s.label || "Verse",
        number: s.number ?? null,
        lang: body.defaultLang ?? existing.defaultLang,
        lyrics: s.lyrics ?? "",
        manualBreaks: s.manualBreaks && s.manualBreaks.length ? JSON.stringify(s.manualBreaks) : null,
        orderIndex: i,
      }));
      if (rows.length) await db.insert(schema.sections).values(rows);
      await buildDefaultArrangement(id, rows.map((r) => r.id));
    }
    return c.json({ ok: true }, 200);
  })

  .delete("/songs/:id", async (c) => {
    const id = c.req.param("id");
    const arrs = await db.select().from(schema.arrangements).where(eq(schema.arrangements.songId, id));
    for (const a of arrs) {
      await db.delete(schema.arrangementItems).where(eq(schema.arrangementItems.arrangementId, a.id));
    }
    await db.delete(schema.arrangements).where(eq(schema.arrangements.songId, id));
    await db.delete(schema.sections).where(eq(schema.sections.songId, id));
    await db.delete(schema.songs).where(eq(schema.songs.id, id));
    return c.json({ ok: true }, 200);
  })

  // ---------- ARRANGEMENT (default: reorder + repeats) ----------
  // Save the ordered list of sectionIds (repeats allowed) for the default arrangement.
  .put("/songs/:id/arrangement", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ sectionIds: string[] }>();
    const [song] = await db.select().from(schema.songs).where(eq(schema.songs.id, id));
    if (!song) return c.json({ error: "not found" }, 404);

    const existing = await db.select().from(schema.arrangements).where(eq(schema.arrangements.songId, id));
    let arr = existing.find((a) => a.isDefault);
    if (!arr) {
      const arrId = uuid();
      await db.insert(schema.arrangements).values({ id: arrId, songId: id, name: "Default", isDefault: 1 });
      arr = { id: arrId, songId: id, name: "Default", isDefault: 1 };
    }
    await db.delete(schema.arrangementItems).where(eq(schema.arrangementItems.arrangementId, arr.id));
    if (body.sectionIds.length) {
      await db.insert(schema.arrangementItems).values(
        body.sectionIds.map((sectionId, i) => ({
          id: uuid(),
          arrangementId: arr!.id,
          sectionId,
          orderIndex: i,
        })),
      );
    }
    return c.json({ ok: true }, 200);
  })

  // ---------- IMPORT ----------
  // Accepts plain text OR uploaded file (.txt/.docx) via multipart.
  .post("/import", async (c) => {
    const contentType = c.req.header("content-type") ?? "";
    let raw = "";
    let title = "";
    let source = "import_txt";

    if (contentType.includes("multipart/form-data")) {
      const form = await c.req.formData();
      const file = form.get("file");
      const givenTitle = form.get("title");
      if (file && file instanceof File) {
        const name = file.name.toLowerCase();
        if (name.endsWith(".pro6") || name.endsWith(".pro")) {
          // ProPresenter document → parse straight to sections (skip text parser).
          const buf = Buffer.from(await file.arrayBuffer());
          const givenName = (givenTitle as string) || file.name.replace(/\.(pro6?|)$/i, "");
          const parsed = parseProPresenter(file.name, buf);
          const finalTitle = (givenName || parsed.title).trim() || "Imported Song";
          if (!parsed.sections.length) return c.json({ error: "no lyrics found in ProPresenter file" }, 400);
          const id = await createSongWithSections({
            title: finalTitle,
            sections: parsed.sections,
            source: "import_propresenter",
          });
          return c.json({ id, sectionCount: parsed.sections.length }, 201);
        }
        if (name.endsWith(".docx")) {
          const buf = Buffer.from(await file.arrayBuffer());
          const result = await mammoth.extractRawText({ buffer: buf });
          raw = result.value;
          source = "import_docx";
        } else {
          raw = await file.text();
          source = "import_txt";
        }
        title = (givenTitle as string) || file.name.replace(/\.(txt|docx)$/i, "");
      }
    } else {
      const body = await c.req.json<{ text?: string; title?: string }>();
      raw = body.text ?? "";
      title = body.title ?? "";
    }

    if (!raw.trim()) return c.json({ error: "no content to import" }, 400);
    const finalTitle = (title || guessTitle(raw)).trim() || "Untitled Song";
    const sections = parseStructure(raw, finalTitle);
    const id = await createSongWithSections({ title: finalTitle, sections, source });
    return c.json({ id, sectionCount: sections.length }, 201);
  })

  // Preview parse without saving.
  .post("/import/preview", async (c) => {
    const body = await c.req.json<{ text?: string; title?: string }>();
    const raw = body.text ?? "";
    const finalTitle = (body.title || guessTitle(raw)).trim();
    const sections = parseStructure(raw, finalTitle);
    return c.json({ title: finalTitle, sections }, 200);
  })

  // ---------- PRESENTATIONS ----------
  // "Store words, not slide images" applied to freeform decks: build slides
  // in-app, or import a .pptx (best-effort text + first image per slide —
  // not a pixel-exact PowerPoint renderer).
  .get("/presentations", async (c) => {
    const rows = await db.select().from(schema.presentations).orderBy(desc(schema.presentations.updatedAt));
    const withCounts = await Promise.all(
      rows.map(async (p) => {
        const slides = await db
          .select()
          .from(schema.presentationSlides)
          .where(eq(schema.presentationSlides.presentationId, p.id));
        return { ...p, slideCount: slides.length };
      }),
    );
    return c.json({ presentations: withCounts }, 200);
  })
  .get("/presentations/:id", async (c) => {
    const full = await getFullPresentation(c.req.param("id"));
    if (!full) return c.json({ error: "not found" }, 404);
    const slidesWithUrls = await Promise.all(
      full.slides.map(async (s) => {
        let backgroundUrl: string | null = null;
        if (s.backgroundId) {
          const [m] = await db.select().from(schema.media).where(eq(schema.media.id, s.backgroundId));
          if (m) backgroundUrl = await resolveMediaUrl(m.uri);
        }
        return { ...s, backgroundUrl };
      }),
    );
    return c.json({ presentation: full.presentation, slides: slidesWithUrls }, 200);
  })
  .post("/presentations", async (c) => {
    const body = await c.req.json<{
      title?: string;
      slides?: { heading?: string; body?: string; backgroundId?: string | null; bgColor?: string | null; textColor?: string | null }[];
    }>();
    const id = await createPresentation({
      title: body.title?.trim() || "Untitled Presentation",
      slides: body.slides ?? [],
    });
    return c.json({ id }, 201);
  })
  .put("/presentations/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{
      title?: string;
      slides?: { heading?: string; body?: string; backgroundId?: string | null; bgColor?: string | null; textColor?: string | null }[];
    }>();
    const ok = await replacePresentation(id, body);
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true }, 200);
  })
  .delete("/presentations/:id", async (c) => {
    await deletePresentation(c.req.param("id"));
    return c.json({ ok: true }, 200);
  })
  // Import a .pptx file: extracted text becomes heading/body, the first
  // embedded image per slide becomes its background (stored like any other
  // local media item, so it works fully offline).
  .post("/presentations/import-pptx", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "no file" }, 400);
    const buf = Buffer.from(await file.arrayBuffer());
    const fallbackTitle = (typeof body.title === "string" && body.title) || file.name.replace(/\.pptx$/i, "");

    let parsed: Awaited<ReturnType<typeof parsePptx>>;
    try {
      parsed = await parsePptx(buf, fallbackTitle);
    } catch {
      return c.json({ error: "Couldn't read this .pptx file — it may be corrupted or password-protected." }, 400);
    }
    if (!parsed.slides.length) return c.json({ error: "No readable slides found in this file." }, 400);

    await fsp.mkdir(mediaDir(), { recursive: true });
    const slideInputs: {
      heading: string; body: string; backgroundId: string | null;
      bgColor: string | null; textColor: string | null;
    }[] = [];
    for (const s of parsed.slides) {
      let backgroundId: string | null = null;
      if (s.image) {
        const name = `${Date.now()}-${uuid().slice(0, 8)}.${s.image.ext}`;
        await fsp.writeFile(nodePath.join(mediaDir(), name), s.image.data);
        const mediaId = uuid();
        await db.insert(schema.media).values({ id: mediaId, type: "image", uri: `local:${name}`, loop: 1, fit: "cover" });
        backgroundId = mediaId;
      }
      slideInputs.push({
        heading: s.heading,
        body: s.body,
        backgroundId,
        bgColor: s.bgColor,
        textColor: s.textColor,
      });
    }

    const id = await createPresentation({ title: parsed.title, source: "import_pptx", slides: slideInputs });
    return c.json({ id, slideCount: slideInputs.length }, 201);
  })

  // ---------- THEMES ----------
  .get("/themes", async (c) => {
    let rows = await db.select().from(schema.themes);
    // Self-heal the built-in palette themes so existing installs (whose DB was
    // seeded before these were added) pick them up without a migration.
    const missing = BUILTIN_THEMES.filter((b) => !rows.some((r) => r.name === b.name));
    if (missing.length) {
      for (const t of missing) await db.insert(schema.themes).values({ ...t, id: uuid() });
      rows = await db.select().from(schema.themes);
    }
    return c.json({ themes: rows }, 200);
  })
  .post("/themes", async (c) => {
    const body = await c.req.json<Partial<typeof schema.themes.$inferInsert>>();
    const id = uuid();
    await db.insert(schema.themes).values({ ...body, id, name: body.name || "Untitled Theme" });
    return c.json({ id }, 201);
  })
  .put("/themes/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<Partial<typeof schema.themes.$inferInsert>>();
    await db.update(schema.themes).set(body).where(eq(schema.themes.id, id));
    return c.json({ ok: true }, 200);
  })

  // ---------- MEDIA / BACKGROUNDS ----------
  // List all backgrounds (images/videos/colors) in the library.
  .get("/media", async (c) => {
    const rows = await db.select().from(schema.media).orderBy(desc(schema.media.createdAt));
    // Refresh presigned GET URLs for S3-hosted media so previews never expire.
    const withUrls = await Promise.all(
      rows.map(async (m) => ({ ...m, url: await resolveMediaUrl(m.uri) })),
    );
    return c.json({ media: withUrls }, 200);
  })
  // Direct upload to LOCAL storage — the offline path used by the desktop app
  // (and any deployment without S3 creds). Files land in MEDIA_DIR (defaults
  // to ./media next to the process cwd; the Electron server points it at
  // userData/media) and are served back from /media/file/:name below.
  .post("/media/upload", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "no file" }, 400);
    const safe = (file.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
    const name = `${Date.now()}-${uuid().slice(0, 8)}-${safe}`;
    await fsp.mkdir(mediaDir(), { recursive: true });
    await fsp.writeFile(nodePath.join(mediaDir(), name), new Uint8Array(await file.arrayBuffer()));
    const mimeType = file.type || "";
    const type = mimeType.startsWith("video")
      ? "video"
      : mimeType.startsWith("audio")
        ? "audio"
        : "image";
    const id = uuid();
    await db.insert(schema.media).values({ id, type, uri: `local:${name}`, loop: 1, fit: "cover" });
    const [row] = await db.select().from(schema.media).where(eq(schema.media.id, id));
    return c.json({ media: { ...row, url: await resolveMediaUrl(row!.uri) } }, 201);
  })
  // Serve a locally stored background. Same-origin, so the operator preview,
  // projector window and stream overlay can all load it.
  .get("/media/file/:name", async (c) => {
    const name = nodePath.basename(c.req.param("name")); // no traversal
    try {
      const data = await fsp.readFile(nodePath.join(mediaDir(), name));
      const ext = nodePath.extname(name).toLowerCase();
      const mime: Record<string, string> = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
        ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp", ".avif": "image/avif",
        ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/mp4",
        ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
        ".aac": "audio/aac", ".flac": "audio/flac",
      };
      return c.body(new Uint8Array(data).buffer as ArrayBuffer, 200, {
        "Content-Type": mime[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      });
    } catch {
      return c.json({ error: "not found" }, 404);
    }
  })
  // Presign an upload target on Tigris/S3. Client PUTs the file directly.
  .post("/media/presign", async (c) => {
    const { filename, contentType } = await c.req.json<{ filename: string; contentType: string }>();
    const safe = (filename || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `backgrounds/${Date.now()}-${uuid().slice(0, 8)}-${safe}`;
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: 600 },
    );
    return c.json({ url, key }, 200);
  })
  // Register a media record (from an uploaded S3 key OR a direct external URL).
  .post("/media", async (c) => {
    const body = await c.req.json<{
      type: "image" | "video" | "audio" | "color";
      uri: string; // s3 key, external url, or hex color
      loop?: boolean;
      fit?: "cover" | "contain" | "fill";
      /** Video only: true = plays silently (the usual "background" case). */
      muted?: boolean;
    }>();
    const id = uuid();
    await db.insert(schema.media).values({
      id,
      type: body.type,
      uri: body.uri,
      loop: body.loop === false ? 0 : 1,
      fit: body.fit ?? "cover",
      muted: body.muted === false ? 0 : 1,
    });
    const [row] = await db.select().from(schema.media).where(eq(schema.media.id, id));
    if (!row) return c.json({ error: "media not found after insert" }, 500);
    return c.json({ media: { ...row, url: await resolveMediaUrl(row.uri) } }, 201);
  })
  // Edit an existing item's playback (loop / fit / sound) without re-uploading.
  .put("/media/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ loop?: boolean; fit?: "cover" | "contain" | "fill"; muted?: boolean }>();
    const patch: Partial<typeof schema.media.$inferInsert> = {};
    if (body.loop !== undefined) patch.loop = body.loop ? 1 : 0;
    if (body.fit !== undefined) patch.fit = body.fit;
    if (body.muted !== undefined) patch.muted = body.muted ? 1 : 0;
    await db.update(schema.media).set(patch).where(eq(schema.media.id, id));
    const [row] = await db.select().from(schema.media).where(eq(schema.media.id, id));
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ media: { ...row, url: await resolveMediaUrl(row.uri) } }, 200);
  })
  .delete("/media/:id", async (c) => {
    const id = c.req.param("id");
    await db.delete(schema.media).where(eq(schema.media.id, id));
    return c.json({ ok: true }, 200);
  })

  // ---------- TRANSLATIONS (multi-language) ----------
  // Get all translations for a song (grouped by sectionId).
  .get("/songs/:id/translations", async (c) => {
    const songId = c.req.param("id");
    const secs = await db.select().from(schema.sections).where(eq(schema.sections.songId, songId));
    const secIds = new Set(secs.map((s) => s.id));
    const all = await db.select().from(schema.translations);
    const rows = all.filter((t) => secIds.has(t.sectionId));
    return c.json({ translations: rows }, 200);
  })
  // Upsert a translation for a section+lang.
  .put("/sections/:sectionId/translations/:lang", async (c) => {
    const sectionId = c.req.param("sectionId");
    const lang = c.req.param("lang");
    const { lyrics, source } = await c.req.json<{ lyrics: string; source?: string }>();
    const existing = (await db.select().from(schema.translations)).find(
      (t) => t.sectionId === sectionId && t.lang === lang,
    );
    if (!lyrics?.trim()) {
      if (existing) await db.delete(schema.translations).where(eq(schema.translations.id, existing.id));
      return c.json({ ok: true, deleted: true }, 200);
    }
    if (existing) {
      await db
        .update(schema.translations)
        .set({ lyrics, source: source ?? "human" })
        .where(eq(schema.translations.id, existing.id));
      return c.json({ id: existing.id }, 200);
    }
    const id = uuid();
    await db.insert(schema.translations).values({ id, sectionId, lang, lyrics, source: source ?? "human" });
    return c.json({ id }, 201);
  })

  // ---------- LIVE SYNC (server) for streaming / OBS / NDI bridge ----------
  // Operator pushes the current live state; server keeps latest + fans out via SSE.
  .get("/live/state", (c) => c.json({ state: getLiveState() }, 200))
  .post("/live/state", async (c) => {
    const state = await c.req.json<Record<string, unknown>>();
    setLiveState(state);
    return c.json({ ok: true }, 200);
  })
  // Server-Sent Events feed consumed by the browser-source / stream page.
  .get("/live/stream", (c) => {
    return streamSSE(c, async (stream) => {
      // Send current state immediately so a fresh client is in sync.
      await stream.writeSSE({ event: "live", data: JSON.stringify(getLiveState()) });
      const unsub = subscribeLive((s) => {
        stream.writeSSE({ event: "live", data: JSON.stringify(s) }).catch(() => {});
      });
      // Heartbeat keeps proxies from closing the connection.
      let alive = true;
      stream.onAbort(() => {
        alive = false;
        unsub();
      });
      while (alive) {
        await stream.sleep(15000);
        if (!alive) break;
        await stream.writeSSE({ event: "ping", data: String(Date.now()) });
      }
    });
  })

  // ---------- STAGE DISPLAY (operator -> worship team screen) ----------
  // Operator pushes the current + next slide + notes; /stage renders it.
  .get("/stage/state", (c) => c.json({ state: getStage() }, 200))
  .post("/stage/state", async (c) => {
    const state = await c.req.json<Record<string, unknown>>();
    setStage(state);
    return c.json({ ok: true }, 200);
  })
  .get("/stage/stream", (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: "stage", data: JSON.stringify(getStage()) });
      const unsub = subscribeStage((s) => {
        stream.writeSSE({ event: "stage", data: JSON.stringify(s) }).catch(() => {});
      });
      let alive = true;
      stream.onAbort(() => {
        alive = false;
        unsub();
      });
      while (alive) {
        await stream.sleep(15000);
        if (!alive) break;
        await stream.writeSSE({ event: "ping", data: String(Date.now()) });
      }
    });
  })

  // ---------- REMOTE CONTROL (phone/tablet -> operator) ----------
  // Remote POSTs a command; operator listens on the SSE feed and executes it.
  // Manual override still wins: the operator app is the single source of truth.
  .post("/remote/command", async (c) => {
    const cmd = await c.req.json<{ action: string; index?: number }>();
    if (!cmd?.action) return c.json({ error: "no action" }, 400);
    sendRemote({ action: cmd.action, index: cmd.index });
    return c.json({ ok: true }, 200);
  })
  .get("/remote/stream", (c) => {
    return streamSSE(c, async (stream) => {
      const unsub = subscribeRemote((cmd) => {
        stream.writeSSE({ event: "command", data: JSON.stringify(cmd) }).catch(() => {});
      });
      let alive = true;
      stream.onAbort(() => {
        alive = false;
        unsub();
      });
      while (alive) {
        await stream.sleep(15000);
        if (!alive) break;
        await stream.writeSSE({ event: "ping", data: String(Date.now()) });
      }
    });
  })

  // ---------- AI AUTO-FOLLOW (Deepgram) ----------
  // Returns a short-lived config for the client to open a Deepgram live WS.
  // Key stays server-side; we hand the browser a temporary token when possible.
  .get("/autofollow/config", async (c) => {
    // Server env key wins; otherwise use the key saved in app Settings → AI.
    let key = process.env.DEEPGRAM_API_KEY;
    let language = "en";
    // Always read settings: env key wins for the key, but the language always
    // comes from app Settings → AI.
    const [row] = await db.select().from(schema.settings).where(eq(schema.settings.id, "app"));
    if (row) {
      try {
        const cfg = JSON.parse(row.config) as { deepgramApiKey?: string | null; autoFollowLang?: string | null };
        if (!key) key = cfg.deepgramApiKey?.trim() || undefined;
        if (cfg.autoFollowLang) language = cfg.autoFollowLang;
      } catch { /* ignore malformed config */ }
    }
    if (!key) return c.json({ enabled: false, reason: "no_key" }, 200);
    // Deepgram's auto language detection ("multi") requires nova-3; single
    // languages run on nova-2 (broadest per-language coverage).
    const model = language === "multi" ? "nova-3" : "nova-2";
    return c.json({ enabled: true, key, model, language, provider: "deepgram" }, 200);
  })

  // ---------- SETTINGS (single row) ----------
  .get("/settings", async (c) => {
    const [row] = await db.select().from(schema.settings).where(eq(schema.settings.id, "app"));
    if (!row) {
      const def = defaultSettings();
      await db.insert(schema.settings).values({ id: "app", config: JSON.stringify(def) });
      return c.json({ config: def }, 200);
    }
    return c.json({ config: JSON.parse(row.config) }, 200);
  })
  .put("/settings", async (c) => {
    const body = await c.req.json<{ config: Record<string, unknown> }>();
    const [row] = await db.select().from(schema.settings).where(eq(schema.settings.id, "app"));
    const config = JSON.stringify(body.config ?? {});
    if (!row) await db.insert(schema.settings).values({ id: "app", config });
    else await db.update(schema.settings).set({ config }).where(eq(schema.settings.id, "app"));
    return c.json({ ok: true }, 200);
  })

  // ---------- PLAYLISTS ----------
  .get("/playlists", async (c) => {
    const rows = await db.select().from(schema.playlists).orderBy(desc(schema.playlists.createdAt));
    return c.json({ playlists: rows }, 200);
  })
  .post("/playlists", async (c) => {
    const body = await c.req.json<{ name?: string; serviceDate?: string }>();
    const id = uuid();
    await db.insert(schema.playlists).values({
      id,
      name: body.name?.trim() || "Untitled Service",
      serviceDate: body.serviceDate ?? null,
      createdAt: nowIso(),
    });
    return c.json({ id }, 201);
  })
  .get("/playlists/:id", async (c) => {
    const id = c.req.param("id");
    const [pl] = await db.select().from(schema.playlists).where(eq(schema.playlists.id, id));
    if (!pl) return c.json({ error: "not found" }, 404);
    const items = await db
      .select()
      .from(schema.playlistItems)
      .where(eq(schema.playlistItems.playlistId, id))
      .orderBy(asc(schema.playlistItems.orderIndex));
    return c.json({ playlist: pl, items }, 200);
  })
  // Replace the full ordered item list. Accepts rich items (song/scripture/
  // blank/header). Back-compat: a `songIds` array is treated as song items.
  .put("/playlists/:id/items", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{
      songIds?: string[];
      items?: {
        itemType: string;
        songId?: string | null;
        scriptureRef?: string | null;
        scriptureVersion?: string | null;
        label?: string | null;
      }[];
    }>();
    await db.delete(schema.playlistItems).where(eq(schema.playlistItems.playlistId, id));

    const rows =
      body.items?.map((it, i) => ({
        id: uuid(),
        playlistId: id,
        itemType: it.itemType || "song",
        songId: it.songId ?? null,
        scriptureRef: it.scriptureRef ?? null,
        scriptureVersion: it.scriptureVersion ?? null,
        label: it.label ?? null,
        orderIndex: i,
      })) ??
      body.songIds?.map((songId, i) => ({
        id: uuid(),
        playlistId: id,
        itemType: "song",
        songId,
        scriptureRef: null,
        scriptureVersion: null,
        label: null,
        orderIndex: i,
      })) ??
      [];

    if (rows.length) await db.insert(schema.playlistItems).values(rows);
    return c.json({ ok: true }, 200);
  })
  // Rename / re-date a service plan.
  .patch("/playlists/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ name?: string; serviceDate?: string | null }>();
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name.trim() || "Untitled Service";
    if (body.serviceDate !== undefined) patch.serviceDate = body.serviceDate;
    if (Object.keys(patch).length) {
      await db.update(schema.playlists).set(patch).where(eq(schema.playlists.id, id));
    }
    return c.json({ ok: true }, 200);
  })
  // Delete a service plan and its items.
  .delete("/playlists/:id", async (c) => {
    const id = c.req.param("id");
    await db.delete(schema.playlistItems).where(eq(schema.playlistItems.playlistId, id));
    await db.delete(schema.playlists).where(eq(schema.playlists.id, id));
    return c.json({ ok: true }, 200);
  });

/**
 * Resolve a media `uri` to a usable browser URL.
 * - hex color (e.g. "#112233") → returned as-is (the client treats it as a color)
 * - external http(s) URL → returned as-is
 * - anything else is treated as an S3 key → presigned GET URL (7-day expiry)
 */
/** Directory for locally stored background media (offline / desktop mode). */
function mediaDir(): string {
  return process.env.MEDIA_DIR || nodePath.join(process.cwd(), "media");
}

async function resolveMediaUrl(uri: string): Promise<string> {
  if (!uri) return "";
  if (uri.startsWith("#") || uri.startsWith("http://") || uri.startsWith("https://")) return uri;
  // Locally stored file → same-origin API route (works in every window).
  if (uri.startsWith("local:")) return `/api/media/file/${encodeURIComponent(uri.slice(6))}`;
  try {
    return await getSignedUrl(s3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: uri }), {
      expiresIn: 60 * 60 * 24 * 7,
    });
  } catch {
    return uri;
  }
}

function defaultSettings() {
  return {
    activeThemeId: null as string | null,
    linesPerSlide: 2,
    paginatorMode: "fixed" as const,
    songDisplayLang: null as string | null,
    dualLanguage: false,
    secondaryLang: null as string | null,
    autoFollow: false,
    deepgramApiKey: null as string | null,
    autoFollowLang: "en" as string | null,
    autoFollowThreshold: 0.34,
    autoFollowLookahead: 3,
    ndi: { enabled: false, sourceName: "Vifug Lyrics", frameRate: 30 },
    advanceGoesLive: true,
    bibleLangs: { yor: true, hau: true, ibo: true },
    lyricTheme: null as Record<string, unknown> | null,
    bibleTheme: null as Record<string, unknown> | null,
    presentationTheme: null as Record<string, unknown> | null,
    output: { displayId: null as number | null, resolution: "auto" },
    ui: { language: "en" },
    announcement: { enabled: false, text: "", speed: 22, bgColor: null as string | null, textColor: null as string | null },
    mediaDefaults: { fit: "cover" as const, videoSound: false },
  };
}

export type AppType = typeof app;
export default app;
