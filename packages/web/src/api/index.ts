/**
 * Vifug - free, offline-first worship presentation software.
 * Created by Victor Abah.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { v4 as uuid } from "uuid";
import fsp from "node:fs/promises";
import nodePath from "node:path";
import { eq, asc, desc } from "drizzle-orm";
import mammoth from "mammoth";
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  s3Client,
  S3_BUCKET,
  s3Configured,
  missingS3Vars,
  s3EndpointHost,
  s3UsesPathStyle,
} from "./lib/s3";
import { db } from "./database";
import * as schema from "./database/schema";
import { parseStructure, guessTitle } from "./lib/structure";
import { parseProPresenter } from "./lib/propresenter";
import { htmlToLyrics, extractSongMeta, decodeEntities } from "./lib/html-to-lyrics";
import { getLiveState, setLiveState, subscribeLive } from "./lib/live-store";
import {
  getStage, setStage, subscribeStage,
  sendRemote, subscribeRemote,
} from "./lib/channels";
import {
  isServerlessRuntime,
  readSnapshot,
  writeSnapshot,
  appendRemoteCommand,
  readRemoteCommandsAfter,
  latestRemoteSeq,
  pruneRemoteCommands,
} from "./lib/channel-store";
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


/**
 * How long a long-poll request holds the connection open. Comfortably inside
 * a serverless invocation's ceiling, and long enough that an idle surface
 * makes a handful of requests a minute rather than one a second.
 */
const HOLD_MS = 20_000;
/** How often a held request re-checks the database. */
const POLL_INTERVAL_MS = 400;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Resolve with the snapshot once its rev passes `since`, or with null at the
 * deadline. A caller with no rev (-1) gets the current state immediately, so a
 * surface that has just loaded is in sync without waiting for the next change.
 */
async function holdForSnapshot(
  id: "live" | "stage",
  since: number,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + HOLD_MS;
  for (;;) {
    const state = await readSnapshot(id);
    const rev = typeof state.rev === "number" ? state.rev : 0;
    if (!Number.isFinite(since) || since < 0 || rev > since) return state;
    if (Date.now() >= deadline) return null;
    await sleep(POLL_INTERVAL_MS);
  }
}


/**
 * Recognise an anti-bot interstitial rather than importing it as a song.
 *
 * Matched on phrases these pages use about themselves, not on "this does not
 * look like lyrics" - a vaguer test would reject real songs, and a verse is
 * allowed to contain any words at all. Two hits are required for the same
 * reason: "access denied" alone could be a lyric, but it does not appear
 * beside "checking your browser" in one.
 */
const BOT_WALL_MARKERS = [
  "unusual activity",
  "checking your browser",
  "request for access",
  "verify you are human",
  "are you a robot",
  "please check the box",
  "enable javascript and cookies",
  "attention required",
  "ddos protection",
  "ray id",
  "access denied",
  "captcha",
];

function looksLikeBotWall(html: string): boolean {
  /**
   * Read from the page itself, not from what the extractor produced.
   *
   * A challenge page has no song in it, so once extraction correctly returns
   * nothing there is nothing left to test - and this check silently stopped
   * firing, handing back the generic "not enough text" instead of naming the
   * block. The evidence is in the page, so that is where to look for it.
   */
  const text = decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
  // Only the top of the page: a long lyric could coincidentally contain one of
  // these words, but a challenge page leads with them.
  const head = text.replace(/\s+/g, " ").slice(0, 1200).toLowerCase();
  const hits = BOT_WALL_MARKERS.filter((m) => head.includes(m));
  return hits.length >= 2;
}


/** image/video/audio from a MIME type, defaulting to image. */
function mediaKindFor(mimeType: string): "image" | "video" | "audio" {
  if (mimeType.startsWith("video")) return "video";
  if (mimeType.startsWith("audio")) return "audio";
  return "image";
}


/**
 * Recognise a page whose content is assembled in the browser.
 *
 * Checked only once extraction has already come up short, because these
 * markers appear on plenty of server-rendered pages too - a Next.js site can
 * perfectly well deliver its text in the HTML. It is the combination that
 * means anything: framework scaffolding present, and almost no words with it.
 */
const APP_SHELL_MARKERS: RegExp[] = [
  /__NEXT_DATA__/,
  /id=["']__next["']/i,
  /id=["']__nuxt["']/i,
  /window\.__NUXT__/,
  /data-reactroot/i,
  /\bng-version\b/i,
  /data-server-rendered/i,
  /id=["'](?:root|app)["'][^>]*>\s*<\/div>/i,
];

function looksLikeAppShell(html: string): boolean {
  return APP_SHELL_MARKERS.some((re) => re.test(html));
}


/**
 * What an S3 error actually means for someone holding a Cloudflare dashboard.
 *
 * The SDK's own message names the operation, not the fix. These are the three
 * failures a first-time bucket produces, and each has a different remedy in a
 * different place.
 */
function writeFailureHint(code: string | undefined, status: number | null | undefined): string {
  if (code === "AccessDenied" || status === 403) {
    return (
      "The credentials reached the bucket and were refused. On R2 that is the API token: it needs " +
      "Object Read & Write rather than read-only, and it must be scoped to this bucket - a token " +
      "scoped to a different one fails exactly like this. Check too that the account id in the " +
      "endpoint belongs to the same account as the token."
    );
  }
  if (code === "NoSuchBucket" || status === 404) {
    return "The endpoint answered but has no bucket by that name. Check S3_BUCKET for a typo, and that the bucket lives in the account the endpoint names.";
  }
  if (code === "InvalidAccessKeyId" || code === "SignatureDoesNotMatch") {
    return "The key or secret is wrong. Regenerate the API token and set both values again - the secret is shown only once.";
  }
  return "Check the endpoint, the bucket name, and that the access key may write to it.";
}

const nowIso = () => new Date().toISOString();

/**
 * Built-in themes guaranteed to exist (inserted lazily by GET /themes).
 * Matched by name - renaming one in the DB effectively forks it.
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
      sections?: {
        type: string; label: string; number?: number | null; lyrics: string;
        format?: string | null; textAlign?: string | null;
      }[];
    }>();
    const sections = (body.sections ?? []).map((s) => ({
      type: s.type || "verse",
      label: s.label || "Verse",
      number: s.number ?? null,
      lyrics: s.lyrics ?? "",
      format: s.format ?? null,
      textAlign: s.textAlign ?? null,
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
      sections?: {
        type: string; label: string; number?: number | null; lyrics: string;
        manualBreaks?: number[] | null; format?: string | null; textAlign?: string | null;
      }[];
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
        format: s.format ?? null,
        textAlign: s.textAlign ?? null,
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
    let authors: string[] = [];

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
      const body = await c.req.json<{ text?: string; title?: string; authors?: string[] }>();
      raw = body.text ?? "";
      title = body.title ?? "";
      authors = body.authors ?? [];
    }

    if (!raw.trim()) return c.json({ error: "no content to import" }, 400);
    const finalTitle = (title || guessTitle(raw)).trim() || "Untitled Song";
    const sections = parseStructure(raw, finalTitle);
    const id = await createSongWithSections({
      title: finalTitle,
      sections,
      source,
      // Credits found on the page travel with the song, so an import from a
      // link files itself under its writer instead of arriving anonymous.
      authors: authors.length ? authors : undefined,
    });
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

  // Fetch a lyrics webpage and hand back plain text + a guessed title - the
  // SAME shape the paste-text box already produces, so the existing
  // preview/save flow in ImportModal handles the rest unchanged. Nothing is
  // saved here; the operator still reviews before importing, same as every
  // other import path.
  .post("/import/from-url", async (c) => {
    const body = await c.req.json<{ url?: string }>();
    const url = (body.url ?? "").trim();
    if (!url) return c.json({ error: "no url given" }, 400);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return c.json({ error: "that doesn't look like a valid link" }, 400);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return c.json({ error: "only http/https links are supported" }, 400);
    }
    let html: string;
    try {
      const res = await fetch(parsed.toString(), {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return c.json({ error: `the page returned an error (${res.status})` }, 502);
      html = await res.text();
    } catch {
      return c.json({ error: "couldn't reach that link - check it and the network" }, 502);
    }
    const text = htmlToLyrics(html);

    /**
     * A blocked fetch does not look like a failure. Lyrics sites answer a
     * server-side request with a bot check - a captcha, an "unusual activity"
     * notice, a Cloudflare interstitial - and they answer it with 200 and a
     * page full of prose, so res.ok is true and the length gate below is
     * comfortably cleared. The result was a song whose words were "We're
     * checking your browser, please wait...", filed in the library under the
     * title the operator expected.
     */
    if (looksLikeBotWall(html)) {
      return c.json(
        {
          error: `${parsed.hostname} blocked the fetch and returned a bot check instead of the song.`,
          hint:
            "Sites that do this cannot be read from a server, and working around the check is not something this app will do. " +
            "Open the page yourself and paste the words into New song, or import a .txt, .docx or ProPresenter file.",
        },
        422,
      );
    }

    if (text.replace(/\s/g, "").length < 40) {
      /**
       * "Not enough text" is true but rarely the reason, and it sends people
       * looking at the wrong thing. A page built with React, Next, Nuxt or
       * Angular ships a near-empty shell and fills it in the browser, so a
       * server fetch receives the scaffolding and none of the words. Saying so
       * is the difference between "this app is broken" and "this page cannot
       * be read this way".
       */
      if (looksLikeAppShell(html)) {
        return c.json(
          {
            error: `${parsed.hostname} builds its pages in the browser, so the fetch received an empty shell with no words in it.`,
            hint:
              "Nothing on the server can read a page like this, and this app will not pretend to be a browser to get around that. " +
              "Open it yourself and paste the words into New song, or import a .txt, .docx or ProPresenter file.",
          },
          422,
        );
      }
      return c.json({ error: "couldn't find enough lyric text on that page" }, 422);
    }
    const meta = extractSongMeta(html, parsed.toString());
    const title = meta.title || guessTitle(text) || "";
    // Credits come back alongside the words so the song is filed under its
    // writer rather than needing it typed in from the page afterwards.
    return c.json({ text, title, authors: meta.artists }, 200);
  })

  // ---------- PRESENTATIONS ----------
  // "Store words, not slide images" applied to freeform decks: build slides
  // in-app, or import a .pptx (best-effort text + first image per slide -
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
      slides?: {
        heading?: string; body?: string; backgroundId?: string | null;
        bgColor?: string | null; textColor?: string | null;
        format?: string | null; textAlign?: string | null;
      }[];
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
      slides?: {
        heading?: string; body?: string; backgroundId?: string | null;
        bgColor?: string | null; textColor?: string | null;
        format?: string | null; textAlign?: string | null;
      }[];
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
      return c.json({ error: "Couldn't read this .pptx file - it may be corrupted or password-protected." }, 400);
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
    const all = await db.select().from(schema.media).orderBy(desc(schema.media.createdAt));
    // Pages rendered out of an imported deck belong to their presentation, not
    // to the library. Listing them would bury the operator's own backgrounds
    // under a page-per-slide of every deck ever imported, and offer each one
    // as a background for songs and scripture, which is never what is wanted.
    const rows = all.filter((m) => m.role !== "slide");
    // Refresh presigned GET URLs for S3-hosted media so previews never expire.
    const withUrls = await Promise.all(
      rows.map(async (m) => ({ ...m, url: await resolveMediaUrl(m.uri) })),
    );
    return c.json({ media: withUrls }, 200);
  })
  // Direct upload to LOCAL storage - the offline path used by the desktop app
  // (and any deployment without S3 creds). Files land in MEDIA_DIR (defaults
  // to ./media next to the process cwd; the Electron server points it at
  // userData/media) and are served back from /media/file/:name below.
  .post("/media/upload", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "no file" }, 400);
    const safe = (file.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
    const name = `${Date.now()}-${uuid().slice(0, 8)}-${safe}`;

    /**
     * With a bucket configured, put the file there from here rather than on
     * disk.
     *
     * The presigned route is still the better path for anything large - the
     * browser uploads straight to the bucket with no size ceiling - but it
     * requires a CORS rule on the bucket, and until someone adds one every
     * upload fails. Sending the bytes through the server needs no CORS at all,
     * because the browser is only ever talking to this origin. So the two are
     * complementary: presign when the bucket allows it, this when it does not.
     *
     * The ceiling here is the platform's request body limit (~4.5 MB on
     * Vercel), which is why this is the fallback and not the default.
     */
    if (s3Configured()) {
      const key = `backgrounds/${name}`;
      try {
        await s3Client().send(
          new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            Body: new Uint8Array(await file.arrayBuffer()),
            ContentType: file.type || "application/octet-stream",
          }),
          // Bounded, because an endpoint that never answers otherwise hangs
          // until the platform kills the request - and a killed request tells
          // the operator nothing, while this returns a sentence naming the
          // bucket. Generous enough for a real upload over a slow line.
          { abortSignal: AbortSignal.timeout(25_000) },
        );
      } catch (err) {
        // Logged as well as returned. The SDK's message is the only thing that
        // distinguishes a wrong key from an unreachable host from a name the
        // certificate does not cover, and a 502 in the access log says none of
        // them.
        console.error("[media] bucket upload failed", { key, error: err });
        const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
        return c.json(
          {
            error: "the storage bucket rejected the upload",
            detail: e.message ?? String(err),
            // The same reading the storage probe gives, so the operator is not
            // told one thing at upload time and another when they go looking.
            hint: writeFailureHint(e.name, e.$metadata?.httpStatusCode),
          },
          502,
        );
      }
      const type = mediaKindFor(file.type);
      const id = uuid();
      const role = typeof body.role === "string" && body.role === "slide" ? "slide" : null;
      await db.insert(schema.media).values({ id, type, uri: key, loop: 1, fit: "cover", role });
      const [row] = await db.select().from(schema.media).where(eq(schema.media.id, id));
      return c.json({ media: { ...row, url: await resolveMediaUrl(row!.uri) } }, 201);
    }

    try {
      await fsp.mkdir(mediaDir(), { recursive: true });
      await fsp.writeFile(nodePath.join(mediaDir(), name), new Uint8Array(await file.arrayBuffer()));
    } catch (err) {
      // The offline path needs somewhere to write. Serverless has nowhere, and
      // this is where an unconfigured deployment lands after presign fails.
      return c.json(
        {
          error: "local media storage is not writable",
          detail: (err as Error).message,
          hint: s3Configured()
            ? "MEDIA_DIR is not writable. On a read-only filesystem, uploads must go to object storage."
            : `Object storage is not configured (missing ${missingS3Vars().join(", ")}) and the local disk is not writable.`,
        },
        503,
      );
    }
    const mimeType = file.type || "";
    const type = mimeType.startsWith("video")
      ? "video"
      : mimeType.startsWith("audio")
        ? "audio"
        : "image";
    const id = uuid();
    // "slide" marks a deck page: stored and served like any other file, but
    // kept out of the library listing.
    const role = typeof body.role === "string" && body.role === "slide" ? "slide" : null;
    await db.insert(schema.media).values({ id, type, uri: `local:${name}`, loop: 1, fit: "cover", role });
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
    // The client falls back to local disk when this fails, which on a
    // serverless deployment fails again on a read-only filesystem - so an
    // unhelpful error here surfaces as an upload that just does not work.
    const missing = missingS3Vars();
    if (missing.length) {
      return c.json(
        {
          error: "object storage is not configured",
          missing,
          hint: "Set these in the deployment's environment. A hosted deployment has no writable disk, so uploads need a bucket (Cloudflare R2, Tigris or S3). The bucket also needs a CORS rule allowing PUT from this origin.",
        },
        503,
      );
    }
    const { filename, contentType } = await c.req.json<{ filename: string; contentType: string }>();
    const safe = (filename || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `backgrounds/${Date.now()}-${uuid().slice(0, 8)}-${safe}`;
    const url = await getSignedUrl(
      s3Client(),
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
    const body = await c.req.json<{
      loop?: boolean; fit?: "cover" | "contain" | "fill"; muted?: boolean;
      colorFilter?: string | null;
    }>();
    const patch: Partial<typeof schema.media.$inferInsert> = {};
    if (body.loop !== undefined) patch.loop = body.loop ? 1 : 0;
    if (body.fit !== undefined) patch.fit = body.fit;
    if (body.muted !== undefined) patch.muted = body.muted ? 1 : 0;
    if (body.colorFilter !== undefined) patch.colorFilter = body.colorFilter;
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

  // ---------- RECORDINGS ----------
  // A recording of the live output, saved beside the media library rather
  // than into it: it is an artefact of a service that already happened, not
  // something to pick as a background, so listing it among backgrounds would
  // only bury them.
  .post("/recordings/save", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "no file" }, 400);
    const dir = recordingsDir();
    await fsp.mkdir(dir, { recursive: true });
    const given = typeof body.name === "string" ? body.name : "";
    const safe = (given || file.name || "recording.webm").replace(/[^a-zA-Z0-9._-]/g, "_");
    const name = /\.webm$/i.test(safe) ? safe : `${safe}.webm`;
    await fsp.writeFile(nodePath.join(dir, name), new Uint8Array(await file.arrayBuffer()));
    return c.json({ name, folder: dir }, 201);
  })

  // ---------- LUTS (uploaded .cube 3D color-grading tables) ----------
  // List is deliberately light (no `cube` body) - the picker just needs
  // names; the actual table is fetched once a LUT is selected and parsed/
  // cached client-side, since re-parsing thousands of rows on every render
  // of a list nobody scrolls through would be wasted work.
  .get("/luts", async (c) => {
    const rows = await db
      .select({ id: schema.luts.id, name: schema.luts.name, createdAt: schema.luts.createdAt })
      .from(schema.luts)
      .orderBy(desc(schema.luts.createdAt));
    return c.json({ luts: rows }, 200);
  })
  .post("/luts/upload", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "no file" }, 400);
    const text = await file.text();
    // Cheap sanity check rather than a full parse - a real .cube always
    // declares its size, and this catches "wrong file entirely" without
    // needing the parser (which lives client-side) duplicated here.
    if (!/LUT_3D_SIZE/i.test(text)) {
      return c.json({ error: "That doesn't look like a .cube LUT file (no LUT_3D_SIZE found)." }, 400);
    }
    const id = uuid();
    const name = file.name.replace(/\.cube$/i, "") || "Untitled LUT";
    await db.insert(schema.luts).values({ id, name, cube: text });
    return c.json({ lut: { id, name } }, 201);
  })
  .get("/luts/:id", async (c) => {
    const [row] = await db.select().from(schema.luts).where(eq(schema.luts.id, c.req.param("id")));
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ lut: row }, 200);
  })
  .delete("/luts/:id", async (c) => {
    await db.delete(schema.luts).where(eq(schema.luts.id, c.req.param("id")));
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
  .get("/live/state", async (c) =>
    c.json({ state: isServerlessRuntime() ? await readSnapshot("live") : getLiveState() }, 200),
  )
  .post("/live/state", async (c) => {
    const state = await c.req.json<Record<string, unknown>>();
    // In-memory too even when serverless: within a single warm instance it
    // still serves the SSE feed, and it costs one assignment.
    setLiveState(state);
    if (isServerlessRuntime()) await writeSnapshot("live", state);
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
  .get("/stage/state", async (c) =>
    c.json({ state: isServerlessRuntime() ? await readSnapshot("stage") : getStage() }, 200),
  )
  .post("/stage/state", async (c) => {
    const state = await c.req.json<Record<string, unknown>>();
    setStage(state);
    if (isServerlessRuntime()) await writeSnapshot("stage", state);
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
  // Tells the Remote page whether it must ask for a PIN before showing
  // controls. Never returns the PIN itself - only whether one is required.
  .get("/remote/auth", async (c) => {
    const { requirePin } = await remoteAuthConfig();
    return c.json({ requirePin }, 200);
  })
  // Exchange a PIN for permission to drive the service. Returns ok:false
  // rather than an error code so a wrong PIN is a normal UI state.
  .post("/remote/auth", async (c) => {
    const { pin } = await c.req.json<{ pin?: string }>();
    const cfg = await remoteAuthConfig();
    if (!cfg.requirePin) return c.json({ ok: true }, 200);
    return c.json({ ok: !!cfg.pin && pin === cfg.pin }, 200);
  })
  .post("/remote/command", async (c) => {
    const cmd = await c.req.json<{
      action: string;
      index?: number;
      pin?: string;
      songId?: string;
      ref?: string;
      versionId?: string;
      presentationId?: string;
      mediaId?: string;
    }>();
    if (!cmd?.action) return c.json({ error: "no action" }, 400);
    // The server listens on 0.0.0.0 so phones on the Wi-Fi can reach it, which
    // also means an unauthenticated command endpoint would let anyone on the
    // network blank the screen mid-service. Every command carries the PIN.
    const cfg = await remoteAuthConfig();
    if (cfg.requirePin && (!cfg.pin || cmd.pin !== cfg.pin)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const command = {
      action: cmd.action,
      index: cmd.index,
      songId: cmd.songId,
      ref: cmd.ref,
      versionId: cmd.versionId,
      presentationId: cmd.presentationId,
      mediaId: cmd.mediaId,
    };
    sendRemote(command);
    if (isServerlessRuntime()) {
      await appendRemoteCommand(command);
      void pruneRemoteCommands();
    }
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

  /**
   * Whether uploads can work here, without having to attempt one to find out.
   * Reports only which variable names are absent - never a value, an endpoint
   * or a bucket - so it is safe on a public deployment.
   */
  .get("/media/storage", async (c) => {
    const missing = missingS3Vars();
    const state = {
      objectStorage: missing.length ? "unconfigured" : "configured",
      missing,
      // Enough to spot a wrong account id or the wrong addressing style at a
      // glance. Host and bucket only - never a key, never a secret.
      endpointHost: s3EndpointHost(),
      bucket: process.env.S3_BUCKET ?? null,
      addressing: s3UsesPathStyle() ? "path" : "virtual-hosted",
    };

    /**
     * ?check=1 actually writes, because nothing short of writing proves a
     * token may write.
     *
     * "Configured" only ever meant four variables are present. It cannot tell
     * a correct setup from a read-only token, a bucket the token is not scoped
     * to, or an account id that does not match - all of which arrive as the
     * same "Access Denied" at the end of an upload, long after the operator
     * has stopped thinking about credentials. This puts the answer one request
     * away from whoever is configuring it.
     */
    if (c.req.query("check") === undefined || missing.length) return c.json(state, 200);

    const key = `.vifug-write-test-${uuid().slice(0, 8)}`;
    try {
      await s3Client().send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: new Uint8Array([0]),
          ContentType: "application/octet-stream",
        }),
        { abortSignal: AbortSignal.timeout(20_000) },
      );
    } catch (err) {
      const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
      return c.json(
        {
          ...state,
          canWrite: false,
          code: e.name ?? "Error",
          status: e.$metadata?.httpStatusCode ?? null,
          detail: e.message ?? String(err),
          hint: writeFailureHint(e.name, e.$metadata?.httpStatusCode),
        },
        200,
      );
    }

    // Best effort: a stray zero-byte probe object is untidy, not harmful, and
    // a token allowed to write but not delete should still report success.
    try {
      await s3Client().send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    } catch {
      /* ignore */
    }
    return c.json({ ...state, canWrite: true }, 200);
  })

  // ---------- LONG-POLL TRANSPORT (serverless / over the internet) ----------
  /**
   * Which transport the client should use for the three channels.
   *
   * SSE needs one process holding every connection. Serverless has none, so a
   * stream opened there is attached to whichever instance answered and sees
   * nothing the operator does on another - which is precisely why the remote
   * worked on the same Wi-Fi and not over the internet. Long-poll is the
   * transport that survives that, and the client asks rather than guesses so
   * the desktop and Bun builds keep using SSE unchanged.
   */
  .get("/realtime", (c) =>
    c.json({ transport: isServerlessRuntime() ? "poll" : "sse", holdMs: HOLD_MS }, 200),
  )
  /**
   * Hold the request open until the snapshot's rev passes the caller's, or
   * until HOLD_MS. Returning 204 on no-change lets the client re-poll straight
   * away with no payload, so an idle service costs one small request every
   * HOLD_MS per surface rather than a busy loop.
   */
  .get("/live/poll", async (c) => {
    const since = Number(c.req.query("rev") ?? -1);
    const state = await holdForSnapshot("live", since);
    return state ? c.json({ state }, 200) : c.body(null, 204);
  })
  .get("/stage/poll", async (c) => {
    const since = Number(c.req.query("rev") ?? -1);
    const state = await holdForSnapshot("stage", since);
    return state ? c.json({ state }, 200) : c.body(null, 204);
  })
  /**
   * Commands after `seq`. A caller with no seq gets the current head and no
   * backlog: joining should not replay a service's worth of "next" presses.
   */
  .get("/remote/poll", async (c) => {
    const raw = c.req.query("seq");
    if (raw === undefined) return c.json({ commands: [], seq: await latestRemoteSeq() }, 200);
    const after = Number(raw);
    const deadline = Date.now() + HOLD_MS;
    for (;;) {
      const batch = await readRemoteCommandsAfter(after);
      if (batch.commands.length) return c.json(batch, 200);
      if (Date.now() >= deadline) return c.json({ commands: [], seq: after }, 200);
      await sleep(POLL_INTERVAL_MS);
    }
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

  // ---------- LIBRARY RESET (first-run "start empty") ----------
  // Wipes the song library only. Backgrounds, themes, fonts and settings are
  // left alone - someone choosing "build my own" still wants their look.
  // Presentations are kept too: they aren't part of the bundled hymn set.
  .post("/library/clear", async (c) => {
    await db.delete(schema.arrangementItems);
    await db.delete(schema.arrangements);
    await db.delete(schema.translations);
    await db.delete(schema.sections);
    await db.delete(schema.playlistItems);
    await db.delete(schema.songs);
    return c.json({ ok: true }, 200);
  })

  // ---------- SETTINGS (single row) ----------
  .get("/settings", async (c) => {
    let [row] = await db.select().from(schema.settings).where(eq(schema.settings.id, "app"));
    if (!row) {
      const def = defaultSettings();
      await db.insert(schema.settings).values({ id: "app", config: JSON.stringify(def) });
      [row] = await db.select().from(schema.settings).where(eq(schema.settings.id, "app"));
    }
    const config = JSON.parse(row!.config) as Record<string, unknown>;

    /**
     * Make sure a PIN exists before handing Settings something to display.
     *
     * remoteAuthConfig() creates one on first read, but only /remote/auth and
     * /remote/command ever called it - so an operator who opened Settings
     * before any phone had connected saw an empty PIN and no way to produce
     * one, on the panel whose whole job is to show it. Ordered after the
     * defaults insert on purpose: remoteAuthConfig writes a config of its own
     * when no row exists, which would leave the settings row holding nothing
     * but a remote block.
     *
     * Costs an extra round trip only on the read that generates it; once a PIN
     * is stored this is the same single query it always was, which matters
     * because the projector and stream pages poll this every four seconds.
     */
    const remote = (config.remote ?? {}) as { requirePin?: boolean; pin?: string | null };
    if (remote.requirePin !== false && !remote.pin) {
      await remoteAuthConfig();
      const [fresh] = await db.select().from(schema.settings).where(eq(schema.settings.id, "app"));
      if (fresh) return c.json({ config: JSON.parse(fresh.config) }, 200);
    }
    return c.json({ config }, 200);
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
  /**
   * cwd through a structural cast, not the ambient type.
   *
   * packages/mobile imports AppType from this package, so this file is also
   * compiled under Expo's tsconfig - where `process` is React Native's
   * { env: ProcessEnv } with no cwd. That is why `bun run typecheck` fails on
   * the mobile package on a clean checkout, and it has nothing to do with
   * mobile: it is this line, seen through a different tsconfig. Same value at
   * runtime either way.
   */
  const cwd = (process as unknown as { cwd?: () => string }).cwd?.() ?? ".";
  return process.env.MEDIA_DIR || nodePath.join(cwd, "media");
}

/**
 * Where recordings of the live output go - a sibling of the media folder
 * (Documents/Vifug/Recordings next to .../Media), so both sit together
 * somewhere the operator can actually find them in Explorer.
 */
function recordingsDir(): string {
  return nodePath.join(nodePath.dirname(mediaDir()), "Recordings");
}

async function resolveMediaUrl(uri: string): Promise<string> {
  if (!uri) return "";
  if (uri.startsWith("#") || uri.startsWith("http://") || uri.startsWith("https://")) return uri;
  // Locally stored file → same-origin API route (works in every window).
  if (uri.startsWith("local:")) return `/api/media/file/${encodeURIComponent(uri.slice(6))}`;
  // An S3 key with no bucket configured cannot be signed; returning the raw
  // key lets the listing render with a broken image rather than 500 the whole
  // media library over one row.
  if (!s3Configured()) return uri;
  try {
    return await getSignedUrl(s3Client(), new GetObjectCommand({ Bucket: S3_BUCKET, Key: uri }), {
      expiresIn: 60 * 60 * 24 * 7,
    });
  } catch {
    return uri;
  }
}

/**
 * Remote-control PIN state, read fresh from settings on every command so
 * changing it in Settings takes effect immediately - no restart, and any
 * phone still holding the old PIN is locked out at once.
 *
 * A PIN is generated on first read rather than at install time, so existing
 * installs upgrading into this get one automatically instead of silently
 * staying open to the whole network.
 */
async function remoteAuthConfig(): Promise<{ requirePin: boolean; pin: string | null }> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.id, "app"));
  let cfg: Record<string, unknown> = {};
  try {
    cfg = row ? (JSON.parse(row.config) as Record<string, unknown>) : {};
  } catch {
    /* malformed config - fall through to defaults, which lock the remote */
  }
  const remote = (cfg.remote ?? {}) as { requirePin?: boolean; pin?: string | null };
  const requirePin = remote.requirePin !== false;
  let pin = remote.pin ?? null;
  if (requirePin && !pin) {
    pin = String(Math.floor(1000 + Math.random() * 9000));
    const next = { ...cfg, remote: { requirePin: true, pin } };
    const config = JSON.stringify(next);
    if (row) await db.update(schema.settings).set({ config }).where(eq(schema.settings.id, "app"));
    else await db.insert(schema.settings).values({ id: "app", config });
  }
  return { requirePin, pin };
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
    ndi: { enabled: false, sourceName: "Vifug", frameRate: 30 },
    advanceGoesLive: true,
    bibleLangs: {} as Record<string, boolean>,
    lyricTheme: null as Record<string, unknown> | null,
    bibleTheme: null as Record<string, unknown> | null,
    presentationTheme: null as Record<string, unknown> | null,
    output: { displayId: null as number | null, resolution: "auto", autoProjector: true },
    ui: { language: "en" },
    announcement: { enabled: false, text: "", speed: 22, bgColor: null as string | null, textColor: null as string | null },
    mediaDefaults: { fit: "cover" as const, videoSound: false },
    // The companion Remote can drive the service from any phone on the Wi-Fi.
    // Locked by default: the embedded server listens on 0.0.0.0, so without a
    // PIN anyone on the same network could take over mid-service.
    remote: { requirePin: true, pin: null as string | null },
    // Microphone used by Auto-Follow (and any future audio feature). null =
    // the system default input.
    audio: { inputDeviceId: null as string | null, inputLabel: null as string | null },
    // Stream/browser-source output geometry and encoding hints. Read by the
    // /stream page and shown in the guide for matching OBS to the app.
    stream: {
      canvas: "1920x1080",
      fps: 30,
      bitrateKbps: 4500,
      encoder: "x264" as "x264" | "nvenc" | "qsv" | "amf" | "videotoolbox",
    },
    // Operator keyboard shortcuts (action -> KeyboardEvent.key). Empty object
    // = use the built-in defaults in DEFAULT_SHORTCUTS.
    shortcuts: {} as Record<string, string[]>,
    // Cleared once the welcome dialog has been answered on this install.
    firstRun: true,
  };
}

export type AppType = typeof app;
export default app;
