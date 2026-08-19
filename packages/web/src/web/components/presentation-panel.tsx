import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Upload, Pencil, Trash2, MonitorPlay, Loader2, FileType2, X } from "lucide-react";
import { VButton, Spinner } from "./bits";
import { PresentationEditor } from "./presentation-editor";
import {
  usePresentationList, useFullPresentation, useDeletePresentation, useImportPptx,
  type PresentationListItem,
} from "../hooks/use-presentations";
import { useMedia } from "../hooks/use-media";
import type { StageSlide } from "../lib/stage";
import type { LiveBackground } from "../lib/live-bus";
import { parseFormats, toRunLines, type TextAlign, type TextRun } from "../lib/rich-text";
import { useDeckImport } from "../hooks/use-deck-import";
import { isSlideImage } from "../lib/deck-render";

/**
 * Presentations tab: build slide decks in-app or import a .pptx, then preview
 * / send them live through the SAME preview -> live stage as lyrics and Bible
 * (StageSlide with kind "presentation", each carrying its own background).
 */
export function PresentationsPanel({
  onSlidesChange,
  onPreview,
  onSendLive,
  previewId,
  liveId,
  cue,
}: {
  onSlidesChange: (slides: StageSlide[]) => void;
  onPreview: (index: number) => void;
  onSendLive: (index: number) => void;
  previewId: string | null;
  liveId: string | null;
  /** Externally chosen deck (e.g. a plan item or the phone remote) - selects it, doesn't cue a slide. */
  cue?: { presentationId: string; nonce: number } | null;
}) {
  const list = usePresentationList();
  const media = useMedia();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (cue?.presentationId) setSelectedId(cue.presentationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cue?.nonce]);
  const full = useFullPresentation(selectedId);
  const del = useDeletePresentation();
  const importPptx = useImportPptx();
  const [editorOpen, setEditorOpen] = useState<false | "new" | "edit">(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  /** Shown after a .pptx import, which cannot carry the deck's design. */
  const [designHint, setDesignHint] = useState(false);
  /**
   * Render pages at 1280 rather than 1920. Roughly halves the time a long deck
   * takes to come in, which on twenty-plus slides is the difference between a
   * short wait and one that feels broken.
   */
  const [fastImport, setFastImport] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const deck = useDeckImport();

  // Pick the first presentation once the library loads, if nothing's selected.
  useEffect(() => {
    if (!selectedId && list.data?.length) setSelectedId(list.data[0].id);
  }, [list.data, selectedId]);

  const activeSlides = useMemo<StageSlide[]>(() => {
    if (!full.data) return [];
    const title = full.data.presentation.title;
    return full.data.slides.map((s, i) => {
      // The heading is prepended and blank lines dropped, so the formatting
      // runs have to be carried through the same filtering or they would end
      // up painted onto the wrong lines. Each line travels with its own runs
      // rather than being re-matched by index afterwards.
      const formats = parseFormats(s.format);
      const bodyLines = s.body ? s.body.split("\n") : [];
      const bodyRuns = toRunLines(s.body ?? "", formats);
      const entries = [
        ...(s.heading ? [{ text: s.heading, runs: undefined as TextRun[] | undefined }] : []),
        ...bodyLines.map((text, li) => ({ text, runs: bodyRuns[li] })),
      ].filter((e) => e.text.trim().length > 0);
      const lines = entries.map((e) => e.text);
      const sourceRuns = formats.length
        ? entries.map((e) => e.runs ?? [{ text: e.text }])
        : undefined;
      const m = s.backgroundId ? media.data?.find((x) => x.id === s.backgroundId) : undefined;
      const background: LiveBackground = m
        ? {
            type: m.type,
            url: m.url,
            fit: m.fit === "contain" || m.fit === "fill" ? m.fit : "cover",
            loop: !!m.loop,
            muted: m.muted !== 0,
          }
        : null;
      return {
        kind: "presentation",
        sourceLines: lines,
        translationLines: [],
        caption: "",
        title,
        slideId: s.id,
        slideIndex: i,
        slideCount: full.data!.slides.length,
        background,
        bgColor: s.bgColor,
        textColor: s.textColor,
        sourceRuns,
        textAlign: (s.textAlign as TextAlign | null) ?? null,
      };
    });
  }, [full.data, media.data]);

  useEffect(() => {
    onSlidesChange(activeSlides);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlides]);

  /**
   * Route an import by what was actually chosen.
   *
   * A PDF or a set of exported images was rendered by PowerPoint itself, so it
   * comes in exactly as designed. A .pptx can only give up its text - the
   * design lives in a layout engine this app does not have - so it still
   * imports, but the operator is told how to get the real thing.
   */
  const onImportFiles = async (files: File[]) => {
    setImportError(null);
    deck.reset();

    const pptx = files.find((f) => /\.pptx$/i.test(f.name));
    const exact = files.filter((f) => /\.pdf$/i.test(f.name) || isSlideImage(f));

    if (exact.length) {
      const base = exact[0]!.name.replace(/\.[^.]+$/, "").replace(/[-_]\d+$/, "");
      const id = await deck.importDeck(exact, base || "Imported presentation", fastImport ? "faster" : "sharp");
      if (id) setSelectedId(id);
      return;
    }

    if (pptx) {
      importPptx.mutate(pptx, {
        onSuccess: (d) => {
          setSelectedId(d.id);
          setDesignHint(true);
        },
        onError: (err) => setImportError(err instanceof Error ? err.message : "Import failed"),
      });
      return;
    }

    setImportError("Choose a PowerPoint file, a PDF, or exported slide images.");
  };

  const doDelete = (id: string) => {
    del.mutate(id, {
      onSuccess: () => {
        if (selectedId === id) setSelectedId(null);
        setConfirmDelete(null);
      },
    });
  };

  return (
    <div className="flex min-h-0 flex-1">
      {/* Library: saved presentations */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--v-border)]">
        <div className="flex gap-1.5 border-b border-[var(--v-border)] p-2">
          <VButton variant="subtle" size="sm" className="flex-1" onClick={() => setEditorOpen("new")}>
            <Plus className="h-3.5 w-3.5" /> New
          </VButton>
          <VButton
            variant="subtle"
            size="sm"
            className="flex-1"
            onClick={() => fileRef.current?.click()}
            disabled={importPptx.isPending || deck.busy}
          >
            {importPptx.isPending || deck.busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}{" "}
            Import
          </VButton>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pptx,.pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) onImportFiles(files);
            }}
          />
        </div>

        {/* Rendering a PDF at full projector resolution is the slow part of an
            import, and on a long deck it is slow enough to look broken. This
            trades detail nobody will see for roughly half the wait. */}
        <label className="flex cursor-pointer items-start gap-2 border-b border-[var(--v-border)] px-2.5 py-2 text-[11px] text-[var(--v-text-faint)] hover:text-[var(--v-text-dim)]">
          <input
            type="checkbox"
            checked={fastImport}
            onChange={(e) => setFastImport(e.target.checked)}
            className="mt-0.5 accent-[var(--v-accent)]"
          />
          <span className="min-w-0">Faster PDF import <span className="opacity-70">- about half the time, slightly less detail</span></span>
        </label>

        {/* Progress for a PDF/image import, which can take a while on a big
            deck and otherwise looks like the app has frozen. */}
        {deck.busy && (
          <div className="border-b border-[var(--v-border)] px-2.5 py-2 text-[11px] text-[var(--v-text-dim)]">
            <p className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--v-accent)]" />
              {deck.step}
              {deck.total > 0 && ` ${deck.done}/${deck.total}`}
            </p>
            {deck.total > 0 && (
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--v-surface-3)]">
                <div
                  className="h-full rounded-full bg-[var(--v-accent)] transition-[width]"
                  style={{ width: `${Math.round((deck.done / deck.total) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}
        {/* A .pptx carries words, not layout. Rather than let an operator
            discover that at 9am on Sunday, say it at the moment of import and
            give the one-step fix. */}
        {designHint && (
          <div className="border-b border-[var(--v-border)] bg-[var(--v-accent-soft)] px-2.5 py-2 text-[11px] text-[var(--v-accent)]">
            <p className="flex items-start gap-1.5">
              <FileType2 className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1">
                <b className="font-semibold">Text imported, not the design.</b> To get the slides
                looking exactly as they do in PowerPoint, open the deck there and choose
                <b className="font-semibold"> File &rsaquo; Save as &rsaquo; PDF</b>, then import that
                PDF here.
              </span>
              <button onClick={() => setDesignHint(false)} className="shrink-0 opacity-70 hover:opacity-100">
                <X className="h-3 w-3" />
              </button>
            </p>
          </div>
        )}
        {(importError || deck.error) && (
          <div className="flex items-start gap-1.5 border-b border-[var(--v-border)] bg-[var(--v-live-soft)] px-2.5 py-2 text-[11px] text-[var(--v-live)]">
            <span className="min-w-0 flex-1">{importError || deck.error}</span>
            <button onClick={() => { setImportError(null); deck.reset(); }}><X className="h-3 w-3" /></button>
          </div>
        )}
        <ul className="v-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
          {list.isLoading && (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-[var(--v-text-faint)]">
              <Spinner /> Loading…
            </div>
          )}
          {list.data?.length === 0 && (
            <p className="px-1 py-6 text-center text-xs text-[var(--v-text-faint)]">
              No presentations yet. Create one or import a .pptx.
            </p>
          )}
          {list.data?.map((p: PresentationListItem) => (
            <li key={p.id}>
              <div
                onClick={() => setSelectedId(p.id)}
                className={`group flex cursor-pointer items-center gap-2 rounded-lg border-l-2 px-2.5 py-2 text-sm transition-colors ${
                  selectedId === p.id
                    ? "border-[var(--v-accent)] bg-[var(--v-accent-soft)] text-[var(--v-text)]"
                    : "border-transparent hover:bg-[var(--v-surface-3)]"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.title}</div>
                  <div className="flex items-center gap-1 truncate text-[11px] text-[var(--v-text-faint)]">
                    {p.source === "import_pptx" && <FileType2 className="h-3 w-3 shrink-0" />}
                    {p.slideCount} slide{p.slideCount === 1 ? "" : "s"}
                  </div>
                </div>
                {confirmDelete === p.id ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => doDelete(p.id)} className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-[var(--v-live)] hover:bg-[var(--v-live-soft)]">
                      Delete
                    </button>
                    <button onClick={() => setConfirmDelete(null)} className="rounded px-1 text-[var(--v-text-faint)] hover:text-[var(--v-text)]">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(p.id);
                    }}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-[var(--v-text-faint)] hover:text-[var(--v-live)]" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </aside>

      {/* Selected presentation's slides */}
      <main className="flex min-w-0 flex-1 flex-col">
        {!selectedId && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[var(--v-surface-2)]">
              <MonitorPlay className="h-8 w-8 text-[var(--v-text-faint)]" />
            </div>
            <div>
              <p className="font-display text-lg font-semibold">Select a presentation</p>
              <p className="text-sm text-[var(--v-text-faint)]">Pick one from the library, or create / import a new one.</p>
            </div>
          </div>
        )}
        {selectedId && full.isLoading && (
          <div className="flex flex-1 items-center justify-center gap-2 text-[var(--v-text-faint)]">
            <Spinner /> Loading presentation…
          </div>
        )}
        {selectedId && full.data && (
          <>
            <div className="flex items-center justify-between border-b border-[var(--v-border)] px-5 py-3">
              <h1 className="truncate font-display text-lg font-semibold">{full.data.presentation.title}</h1>
              <VButton variant="subtle" size="sm" onClick={() => setEditorOpen("edit")}>
                <Pencil className="h-4 w-4" /> Edit
              </VButton>
            </div>
            <div className="v-scroll min-h-0 flex-1 overflow-y-auto p-5">
              {activeSlides.length === 0 ? (
                <p className="text-sm text-[var(--v-text-faint)]">This presentation has no slides yet. Click Edit to add some.</p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                  {activeSlides.map((slide, i) => {
                    const isLive = liveId === slide.slideId;
                    const isPreview = previewId === slide.slideId && !isLive;
                    return (
                      <button
                        key={slide.slideId ?? i}
                        onClick={() => onPreview(i)}
                        onDoubleClick={() => onSendLive(i)}
                        className={`group relative aspect-video overflow-hidden rounded-xl border-2 bg-black text-left transition-all duration-150 ${
                          isLive
                            ? "v-live-pulse border-[var(--v-live)] ring-2 ring-[var(--v-live)]/40"
                            : isPreview
                              ? "border-[var(--v-accent)] ring-2 ring-[var(--v-accent)]/30 shadow-[0_0_16px_var(--v-accent-glow)]"
                              : "border-[var(--v-border)] hover:-translate-y-0.5 hover:border-[var(--v-accent)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.5)]"
                        }`}
                      >
                        {slide.background?.type === "color" && (
                          <span className="absolute inset-0" style={{ background: slide.background.url }} />
                        )}
                        {slide.background?.type === "image" && (
                          <img src={slide.background.url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
                        )}
                        {slide.background?.type === "video" && (
                          <video src={slide.background.url} muted className="absolute inset-0 h-full w-full object-cover opacity-70" />
                        )}
                        {slide.background && <span className="absolute inset-0 bg-black/35" />}
                        <div className="relative flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
                          {slide.sourceLines.length === 0 && !slide.background && (
                            <MonitorPlay className="h-5 w-5 text-white/30" />
                          )}
                          {slide.sourceLines.map((l, li) => (
                            <div key={li} className="font-lyric text-[11px] leading-tight text-white/90 line-clamp-2">
                              {l}
                            </div>
                          ))}
                        </div>
                        {isLive && (
                          <span className="absolute left-1.5 top-1.5 rounded bg-[var(--v-live)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                            Live
                          </span>
                        )}
                        {isPreview && (
                          <span className="absolute left-1.5 top-1.5 rounded bg-[var(--v-accent)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-black">
                            Preview
                          </span>
                        )}
                        <span className="absolute bottom-1 right-1.5 text-[9px] text-white/40">{i + 1}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {editorOpen && (
        <PresentationEditor
          presentation={editorOpen === "edit" ? full.data ?? null : null}
          onClose={(savedId) => {
            setEditorOpen(false);
            if (savedId) setSelectedId(savedId);
          }}
        />
      )}
    </div>
  );
}
