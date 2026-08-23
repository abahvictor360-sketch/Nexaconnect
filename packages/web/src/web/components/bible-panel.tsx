import { useEffect, useMemo, useRef, useState } from "react";
import { Search, BookOpen, Play, Eye } from "lucide-react";
import {
  useBibleManifest, useChapter, bookName, parseReference, searchVersion,
  type BibleVersion, type SearchHit,
} from "../hooks/use-bible";
import type { StageSlide } from "../lib/stage";
import { Spinner } from "./bits";
import { FormattableText } from "./formattable-text";
import { useVerseFormats } from "../hooks/use-verse-formats";
import { toRunLines, type TextFormat } from "../lib/rich-text";

/** Build a bible StageSlide for a single verse. */
export function verseSlide(
  version: BibleVersion,
  code: string,
  name: string,
  chapter: number,
  verse: number,
  text: string,
  slideIndex: number,
  slideCount: number,
  formats: TextFormat[] = [],
): StageSlide {
  return {
    kind: "bible",
    sourceLines: [text],
    translationLines: [],
    caption: `${name} ${chapter}:${verse}`,
    title: version.label,
    slideId: `${version.id}-${code}-${chapter}-${verse}`,
    slideIndex,
    slideCount,
    // A verse is one line, so its runs are a single-entry list. Omitted
    // entirely when unformatted so the output keeps rendering plain strings.
    ...(formats.length ? { sourceRuns: toRunLines(text, formats) } : {}),
  };
}

/**
 * Bible browser. Owns version / book / chapter / verse navigation and search.
 * It computes the "active" ordered slide list (a whole chapter, or search hits)
 * and lifts it to the operator via onSlidesChange so the shared stage can
 * preview/send exactly what is on screen. previewId/liveId drive highlighting.
 */
export type BibleLangToggles = { yor: boolean; hau: boolean; ibo: boolean };

export function BiblePanel({
  onSlidesChange,
  onPreview,
  onSendLive,
  previewId,
  liveId,
  langs,
  cue,
}: {
  onSlidesChange: (slides: StageSlide[]) => void;
  onPreview: (index: number) => void;
  onSendLive: (index: number) => void;
  previewId: string | null;
  liveId: string | null;
  /** Language packs enabled in Settings → Bible. */
  langs: BibleLangToggles;
  /** External navigation request (e.g. cued from a service plan). */
  cue?: { versionId?: string; ref: string; nonce: number } | null;
}) {
  const manifest = useBibleManifest();
  const allVersions = manifest.data?.versions ?? [];
  // English core is always on; other language packs are gated by settings.
  // Version ids yor/hau/ibo map directly to the toggle keys.
  const versions = allVersions.filter(
    (v) => v.lang === "en" || (langs as Record<string, boolean>)[v.id] !== false,
  );
  const [versionId, setVersionId] = useState<string>("");
  useEffect(() => {
    // Pick a default, and fall back to the first enabled version if the current
    // one was just toggled off.
    if (!versions.length) return;
    if (!versionId || !versions.some((v) => v.id === versionId)) {
      setVersionId(versions[0].id);
    }
  }, [versions, versionId]);
  const version = versions.find((v) => v.id === versionId);

  const [code, setCode] = useState("JHN");
  const [chapter, setChapter] = useState(3);

  const chapterCount = version?.chapterCounts[code] ?? 0;
  useEffect(() => {
    // Only clamp once the version manifest is loaded (chapterCount > 0),
    // otherwise the default chapter gets reset before counts are known.
    if (chapterCount > 0 && chapter > chapterCount) setChapter(1);
  }, [chapterCount, chapter]);

  const chapterQ = useChapter(versionId || null, code, chapter);
  const verses = chapterQ.data ?? [];
  const name = bookName(manifest.data, code);

  /* ---- search ---- */
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Verse a typed reference points at (e.g. "john 3 16" → 16). We scroll to it
  // and let Enter preview→send it without the operator hunting for the verse.
  const [targetVerse, setTargetVerse] = useState<number | null>(null);
  /**
   * A verse asked for from somewhere else - the phone remote or a service plan
   * - waiting for its chapter to load so it can be cued. Distinct from
   * targetVerse, which only scrolls: a reference sent deliberately from
   * another device is a request to put that verse in preview.
   */
  const [cuedVerse, setCuedVerse] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { formatsFor, setFormatsFor } = useVerseFormats();

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!version || !manifest.data || query.trim().length < 2) {
      setHits(null);
      setSearching(false);
      setTargetVerse(null);
      return;
    }
    // Instant jump when the query is a reference like "John 3:16" / "john 3 16".
    const ref = parseReference(query, manifest.data);
    if (ref && version.books.includes(ref.code)) {
      setHits(null);
      setSearching(false);
      setCode(ref.code);
      setChapter(ref.chapter);
      // Remember the verse so we scroll to it (and Enter can preview/send it).
      setTargetVerse(ref.verse);
      return;
    }
    setTargetVerse(null);
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      const res = await searchVersion(version, manifest.data!, query);
      setHits(res);
      setSearching(false);
    }, 350);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, version, manifest.data]);

  // React to an external cue (from a service plan): jump to the version/ref.
  useEffect(() => {
    if (!cue || !manifest.data) return;
    if (cue.versionId && versions.some((v) => v.id === cue.versionId)) {
      setVersionId(cue.versionId);
    }
    const ref = parseReference(cue.ref, manifest.data);
    if (ref) {
      setQuery("");
      setHits(null);
      setCode(ref.code);
      setChapter(ref.chapter);
      // The verse was being parsed and then dropped, so "Psalm 3 16" from the
      // phone opened Psalm 3 at verse 1. Whoever asked for a verse wants that
      // verse cued, not the top of its chapter - but the chapter has to load
      // first, so it is remembered and acted on once the verses arrive.
      setTargetVerse(ref.verse);
      setCuedVerse(ref.verse);
    } else {
      setQuery(cue.ref);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cue?.nonce]);

  // The ordered slide list currently shown: search hits (if any) else chapter.
  const activeSlides = useMemo<StageSlide[]>(() => {
    if (!version) return [];
    if (hits) {
      return hits.map((h, i) =>
        verseSlide(
          version, h.code, h.name, h.chapter, h.verse, h.text, i, hits.length,
          formatsFor(`${version.id}-${h.code}-${h.chapter}-${h.verse}`),
        ),
      );
    }
    return verses.map((text, i) =>
      verseSlide(
        version, code, name, chapter, i + 1, text, i, verses.length,
        formatsFor(`${version.id}-${code}-${chapter}-${i + 1}`),
      ),
    );
  }, [version, hits, verses, code, name, chapter, formatsFor]);

  // Lift the visible slide list so the shared stage previews/sends the same set.
  useEffect(() => {
    onSlidesChange(activeSlides);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlides]);

  // Once the referenced chapter is loaded, scroll its target verse into view so
  // the operator never has to hunt for it.
  useEffect(() => {
    if (hits || targetVerse == null || !verses.length) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-verse="${targetVerse}"]`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [verses, targetVerse, hits]);

  // Cue the verse a remote or plan asked for, once its chapter has arrived.
  // Cleared immediately so it fires once and does not fight the operator if
  // they then move to another verse themselves.
  useEffect(() => {
    if (cuedVerse == null || hits || !verses.length) return;
    const idx = Math.min(Math.max(cuedVerse - 1, 0), verses.length - 1);
    setCuedVerse(null);
    onPreview(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verses, cuedVerse, hits]);

  // Enter in the search box drives Preview → Live for a typed reference:
  //   1st Enter → preview the referenced verse · 2nd Enter → send it live.
  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || !version || !manifest.data) return;
    const ref = parseReference(query, manifest.data);
    if (!ref || !version.books.includes(ref.code) || hits) return;
    e.preventDefault();
    // The reference effect has already navigated to code/chapter, so the verse
    // list is (or will be) this chapter. Target index = verse number - 1.
    const idx = Math.min(Math.max(ref.verse - 1, 0), Math.max(activeSlides.length - 1, 0));
    const targetSlideId = activeSlides[idx]?.slideId ?? null;
    if (targetSlideId && previewId === targetSlideId) onSendLive(idx);
    else onPreview(idx);
  };

  if (manifest.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[var(--v-text-faint)]">
        <Spinner /> Loading Bible…
      </div>
    );
  }
  if (manifest.isError || !version) {
    return <div className="p-6 text-sm text-[var(--v-text-faint)]">Bible data unavailable.</div>;
  }

  const books = manifest.data!.canon.filter((b) => version.books.includes(b.code));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Controls */}
      <div className="space-y-2 border-b border-[var(--v-border)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={versionId}
            onChange={(e) => setVersionId(e.target.value)}
            className="rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--v-accent)]"
          >
            {/* ~30 English versions - group by language so the list stays scannable */}
            <optgroup label="English">
              {versions.filter((v) => v.lang === "en").map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </optgroup>
            {versions.some((v) => v.lang !== "en") && (
              <optgroup label="Other languages">
                {versions.filter((v) => v.lang !== "en").map((v) => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </optgroup>
            )}
          </select>

          <select
            value={code}
            onChange={(e) => { setCode(e.target.value); setChapter(1); setQuery(""); setHits(null); }}
            className="rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--v-accent)]"
          >
            {books.map((b) => (
              <option key={b.code} value={b.code}>{b.name}</option>
            ))}
          </select>

          <select
            value={chapter}
            onChange={(e) => { setChapter(Number(e.target.value)); setQuery(""); setHits(null); }}
            className="rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--v-accent)]"
          >
            {Array.from({ length: chapterCount }, (_, i) => i + 1).map((c) => (
              <option key={c} value={c}>Ch {c}</option>
            ))}
          </select>

          <span className="ml-auto text-[11px] text-[var(--v-text-faint)]">
            More versions in Settings → Bible
          </span>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--v-text-faint)]" />
          {searching && <Spinner className="absolute right-2.5 top-1/2 -translate-y-1/2" />}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Reference (john 3 16) - Enter to preview, Enter again to go live"
            className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] py-2 pl-8 pr-8 text-sm outline-none focus:border-[var(--v-accent)]"
          />
        </div>
      </div>

      {/* Verse / result list */}
      <div ref={listRef} className="v-scroll min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--v-text-dim)]">
          <BookOpen className="h-4 w-4" />
          {hits ? `${hits.length} result${hits.length === 1 ? "" : "s"}` : `${name} ${chapter}`}
          {chapterQ.isFetching && !hits && <Spinner />}
        </div>
        {hits && !hits.length ? (
          <p className="px-1 py-8 text-center text-sm text-[var(--v-text-faint)]">No verses found.</p>
        ) : (
          <ul className="space-y-1">
            {activeSlides.map((s, i) => {
              const isLive = liveId === s.slideId;
              const isPreview = previewId === s.slideId;
              const isTarget = !hits && targetVerse === i + 1;
              return (
                <li key={s.slideId}>
                  <div
                    data-verse={hits ? undefined : i + 1}
                    className={`group flex items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors ${
                      isLive
                        ? "border-[var(--v-live)] bg-[var(--v-live-soft)]"
                        : isPreview
                          ? "border-[var(--v-accent)] bg-[var(--v-accent-soft)]"
                          : isTarget
                            ? "border-[var(--v-accent)]/50 bg-[var(--v-accent-soft)]/50"
                            : "border-transparent hover:bg-[var(--v-surface-3)]"
                    }`}
                  >
                    {/* A div rather than a button: the verse text has to be
                        selectable so it can be marked up, and a drag inside a
                        button does not reliably produce a selection. Clicks
                        that ended a selection are ignored so highlighting a
                        phrase does not also cue the verse. */}
                    <div
                      role="button"
                      tabIndex={0}
                      className="flex flex-1 cursor-pointer items-start gap-2 text-left"
                      onClick={() => {
                        if (window.getSelection()?.toString()) return;
                        onPreview(i);
                      }}
                      onDoubleClick={() => onSendLive(i)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onPreview(i);
                      }}
                    >
                      <span className="mt-0.5 shrink-0 text-right text-[11px] font-semibold text-[var(--v-accent)]">
                        {hits ? `${s.caption}` : i + 1}
                      </span>
                      <FormattableText
                        text={s.sourceLines[0] ?? ""}
                        formats={formatsFor(s.slideId ?? "")}
                        onFormatsChange={(f) => setFormatsFor(s.slideId ?? "", f)}
                        className="font-lyric text-sm leading-snug text-[var(--v-text)]"
                      />
                    </div>
                    {/* These are the primary actions on this screen, and they
                        were 22x22 - under the 24px minimum target size, and
                        genuinely fiddly to hit mid-service. The icon stays the
                        same size; the hit area around it grows. */}
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        title="Preview"
                        onClick={() => onPreview(i)}
                        className="grid h-7 w-7 place-items-center rounded text-[var(--v-text-faint)] hover:bg-[var(--v-surface-3)] hover:text-[var(--v-accent)]"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        title="Send live"
                        onClick={() => onSendLive(i)}
                        className="grid h-7 w-7 place-items-center rounded text-[var(--v-text-faint)] hover:bg-[var(--v-surface-3)] hover:text-[var(--v-live)]"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
