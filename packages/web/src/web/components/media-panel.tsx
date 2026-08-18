import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Loader2, Trash2, Image as ImageIcon, Film } from "lucide-react";
import { useMedia, useUploadMedia, useDeleteMedia, type MediaItem, type MediaKind } from "../hooks/use-media";
import type { StageSlide } from "../lib/stage";
import type { LiveBackground } from "../lib/live-bus";

/** Audio has no screen representation, so this mode only offers what a
 * background can actually be - see LiveBackground's type union. */
const TABS: { key: MediaKind; label: string; accept: string }[] = [
  { key: "image", label: "Images", accept: "image/*" },
  { key: "video", label: "Videos", accept: "video/*" },
];

/**
 * Media tab: images and videos preview -> live through the SAME stage as
 * lyrics, Bible and presentations (StageSlide with kind "media", each
 * carrying the file as its background, no text). Click cues it into Preview;
 * double-click or GO LIVE sends it to the screen - nothing reaches the
 * congregation just by adding or selecting a file.
 */
export function MediaPanel({
  onSlidesChange,
  onPreview,
  onSendLive,
  previewId,
  liveId,
}: {
  onSlidesChange: (slides: StageSlide[]) => void;
  onPreview: (index: number) => void;
  onSendLive: (index: number) => void;
  previewId: string | null;
  liveId: string | null;
}) {
  const media = useMedia();
  const upload = useUploadMedia();
  const del = useDeleteMedia();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<MediaKind>("image");

  const items = useMemo<MediaItem[]>(
    () => (media.data ?? []).filter((m) => m.type === tab),
    [media.data, tab],
  );

  const slides = useMemo<StageSlide[]>(
    () =>
      items.map((m, i) => {
        const background: LiveBackground = {
          type: m.type === "video" ? "video" : "image",
          url: m.url,
          fit: m.fit === "contain" || m.fit === "fill" ? m.fit : "cover",
          loop: !!m.loop,
          muted: m.muted !== 0,
        };
        return {
          kind: "media",
          sourceLines: [],
          translationLines: [],
          caption: "",
          title: "",
          slideId: m.id,
          slideIndex: i,
          slideCount: items.length,
          background,
        };
      }),
    [items],
  );

  useEffect(() => {
    onSlidesChange(slides);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides]);

  const active = TABS.find((t) => t.key === tab)!;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b border-[var(--v-border)] px-3 py-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
              tab === t.key
                ? "bg-[var(--v-surface-3)] text-[var(--v-accent)]"
                : "text-[var(--v-text-faint)] hover:text-[var(--v-text)]"
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={upload.isPending}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2.5 py-1.5 text-xs hover:bg-[var(--v-surface)] disabled:opacity-50"
        >
          {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Add {active.label.toLowerCase()}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={active.accept}
          multiple
          className="hidden"
          onChange={(e) => {
            for (const f of Array.from(e.target.files ?? [])) upload.mutate(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="v-scroll min-h-0 flex-1 overflow-y-auto p-5">
        {media.isLoading && <p className="text-xs text-[var(--v-text-faint)]">Loading…</p>}

        {!media.isLoading && !items.length && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[var(--v-surface-2)]">
              {tab === "image" ? (
                <ImageIcon className="h-8 w-8 text-[var(--v-text-faint)]" />
              ) : (
                <Film className="h-8 w-8 text-[var(--v-text-faint)]" />
              )}
            </div>
            <div>
              <p className="font-display text-lg font-semibold">No {active.label.toLowerCase()} yet</p>
              <p className="text-sm text-[var(--v-text-faint)]">
                Add {active.label.toLowerCase()}, then click one to preview it before sending it live.
              </p>
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {items.map((m, i) => {
              const slide = slides[i]!;
              const isLive = liveId === slide.slideId;
              const isPreview = previewId === slide.slideId && !isLive;
              return (
                <div
                  key={m.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onPreview(i)}
                  onDoubleClick={() => onSendLive(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onPreview(i);
                  }}
                  title="Click to preview, double-click to send live"
                  className={`group relative aspect-video cursor-pointer overflow-hidden rounded-xl border-2 bg-black transition-all duration-150 ${
                    isLive
                      ? "v-live-pulse border-[var(--v-live)] ring-2 ring-[var(--v-live)]/40"
                      : isPreview
                        ? "border-[var(--v-accent)] ring-2 ring-[var(--v-accent)]/30 shadow-[0_0_16px_var(--v-accent-glow)]"
                        : "border-[var(--v-border)] hover:-translate-y-0.5 hover:border-[var(--v-accent)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.5)]"
                  }`}
                >
                  {m.type === "video" ? (
                    <video src={m.url} muted className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <img src={m.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  )}
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
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      del.mutate(m.id);
                    }}
                    aria-label="Delete"
                    className="absolute right-1.5 top-1.5 hidden rounded bg-black/60 p-1 text-white hover:text-red-400 group-hover:block"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
