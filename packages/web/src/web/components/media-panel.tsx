import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Loader2, Trash2, Image as ImageIcon, Film, MonitorPlay, Square } from "lucide-react";
import { useMedia, useUploadMedia, useDeleteMedia, type MediaItem, type MediaKind } from "../hooks/use-media";
import { CapturePicker } from "./capture";
import { useLiveState } from "../hooks/use-live";
import { liveBus, type LiveCapture } from "../lib/live-bus";
import type { StageSlide } from "../lib/stage";
import type { LiveBackground } from "../lib/live-bus";

/** Audio has no screen representation, so this mode only offers what a
 * background can actually be - see LiveBackground's type union. */
const MEDIA_TABS: { key: MediaKind; label: string; accept: string }[] = [
  { key: "image", label: "Images", accept: "image/*" },
  { key: "video", label: "Videos", accept: "video/*" },
];

type Tab = MediaKind | "capture";

/**
 * Media tab: images, videos and live capture all preview -> live through the
 * SAME stage as lyrics, Bible and presentations. Click cues it into Preview;
 * double-click or GO LIVE sends it to the screen - nothing reaches the
 * congregation just by adding, selecting, or choosing a capture source.
 *
 * Capture is architecturally its own thing (a MediaStream mirrored via
 * liveBus, not a StageSlide background), so it gets its own tab rather than
 * being folded into the image/video grid.
 */
/** Small labeled slider, reused for the lower-third band's width/height. */
function OverlaySlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-[var(--v-text-faint)]">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="text-[var(--v-text)]">{value}%</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-[var(--v-accent)]"
      />
    </label>
  );
}

export function MediaPanel({
  onSlidesChange,
  onPreview,
  onSendLive,
  previewId,
  liveId,
  pendingCapture,
  onCueCapture,
}: {
  onSlidesChange: (slides: StageSlide[]) => void;
  onPreview: (index: number) => void;
  onSendLive: (index: number) => void;
  previewId: string | null;
  liveId: string | null;
  /** Capture cued into preview but not yet live (lives in the parent - GO LIVE commits it). */
  pendingCapture: LiveCapture;
  onCueCapture: (capture: NonNullable<LiveCapture>) => void;
}) {
  const media = useMedia();
  const upload = useUploadMedia();
  const del = useDeleteMedia();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("image");
  const [capturePickerOpen, setCapturePickerOpen] = useState(false);
  const live = useLiveState();

  // Whichever capture is on screen right now (live) or cued and awaiting GO
  // LIVE (pending) - overlay/nameplate controls edit this one. Live edits go
  // straight to the bus so the change shows immediately, mirroring how the
  // Stream panel's video-volume slider updates the projector without a resend.
  const currentCapture = live.capture ?? pendingCapture;
  const updateCapture = (patch: Partial<NonNullable<LiveCapture>>) => {
    if (!currentCapture) return;
    const updated = { ...currentCapture, ...patch };
    if (live.capture) liveBus().setCapture(updated);
    else onCueCapture(updated);
  };
  const bgImages = (media.data ?? []).filter((m) => m.type === "image");

  const items = useMemo<MediaItem[]>(
    () => (tab === "capture" ? [] : (media.data ?? []).filter((m) => m.type === tab)),
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

  const activeMedia = MEDIA_TABS.find((t) => t.key === tab);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b border-[var(--v-border)] px-3 py-2">
        {MEDIA_TABS.map((t) => (
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
          onClick={() => setTab("capture")}
          className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
            tab === "capture"
              ? "bg-[var(--v-surface-3)] text-[var(--v-accent)]"
              : "text-[var(--v-text-faint)] hover:text-[var(--v-text)]"
          }`}
        >
          Capture
        </button>
        {activeMedia && (
          <>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={upload.isPending}
              className="ml-auto flex items-center gap-1.5 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2.5 py-1.5 text-xs hover:bg-[var(--v-surface)] disabled:opacity-50"
            >
              {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Add {activeMedia.label.toLowerCase()}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={activeMedia.accept}
              multiple
              className="hidden"
              onChange={(e) => {
                for (const f of Array.from(e.target.files ?? [])) upload.mutate(f);
                e.target.value = "";
              }}
            />
          </>
        )}
      </div>

      {tab === "capture" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-5 text-center">
          {live.capture ? (
            <>
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[var(--v-live-soft)]">
                <MonitorPlay className="h-8 w-8 text-[var(--v-live)]" />
              </div>
              <div>
                <p className="font-display text-lg font-semibold">Live: {live.capture.name}</p>
                <p className="text-sm text-[var(--v-text-faint)]">This capture is on the screen right now.</p>
              </div>
              <button
                onClick={() => liveBus().setCapture(null)}
                className="flex items-center gap-1.5 rounded-md border border-[var(--v-live)] px-3 py-1.5 text-xs font-medium text-[var(--v-live)] hover:bg-[var(--v-live-soft)]"
              >
                <Square className="h-3.5 w-3.5" /> Stop capture
              </button>
            </>
          ) : pendingCapture ? (
            <>
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[var(--v-accent-soft)]">
                <MonitorPlay className="h-8 w-8 text-[var(--v-accent)]" />
              </div>
              <div>
                <p className="font-display text-lg font-semibold">Previewing: {pendingCapture.name}</p>
                <p className="text-sm text-[var(--v-text-faint)]">
                  Check the Preview panel, then press GO LIVE to send it to the screen.
                </p>
              </div>
              <button
                onClick={() => setCapturePickerOpen(true)}
                className="rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-3 py-1.5 text-xs hover:bg-[var(--v-surface)]"
              >
                Change source
              </button>
            </>
          ) : (
            <>
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[var(--v-surface-2)]">
                <MonitorPlay className="h-8 w-8 text-[var(--v-text-faint)]" />
              </div>
              <div>
                <p className="font-display text-lg font-semibold">No source chosen</p>
                <p className="text-sm text-[var(--v-text-faint)]">
                  Pick a camera, capture card, screen or window to preview before sending it live.
                </p>
              </div>
              <button
                onClick={() => setCapturePickerOpen(true)}
                className="flex items-center gap-1.5 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-3 py-1.5 text-xs hover:bg-[var(--v-surface)]"
              >
                <MonitorPlay className="h-3.5 w-3.5" /> Choose source
              </button>
            </>
          )}

          {currentCapture && (
            <div className="w-full max-w-sm space-y-3 rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-2)] p-3 text-left">
              {currentCapture.layout === "overlay" && (
                <div className="space-y-2 border-b border-[var(--v-border)] pb-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--v-text-faint)]">
                    Lyrics / Bible over video
                  </p>
                  <div className="flex gap-1.5">
                    {(["fullscreen", "lower_third"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => updateCapture({ overlayMode: m })}
                        className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
                          (currentCapture.overlayMode ?? "fullscreen") === m
                            ? "border-[var(--v-accent)] bg-[var(--v-accent-soft)] text-[var(--v-accent)]"
                            : "border-[var(--v-border)] hover:bg-[var(--v-surface-3)]"
                        }`}
                      >
                        {m === "fullscreen" ? "Full screen" : "Lower third"}
                      </button>
                    ))}
                  </div>

                  {currentCapture.overlayMode === "lower_third" && (
                    <>
                      <OverlaySlider
                        label="Band height"
                        min={10}
                        max={80}
                        value={currentCapture.overlayHeightPct ?? 32}
                        onChange={(v) => updateCapture({ overlayHeightPct: v })}
                      />
                      <OverlaySlider
                        label="Band width"
                        min={20}
                        max={100}
                        value={currentCapture.overlayWidthPct ?? 100}
                        onChange={(v) => updateCapture({ overlayWidthPct: v })}
                      />
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1.5 text-[11px] text-[var(--v-text-faint)]">
                          Background color
                          <input
                            type="color"
                            value={currentCapture.overlayBgColor ?? "#0a0a0c"}
                            onChange={(e) => updateCapture({ overlayBgColor: e.target.value, overlayBgImage: null })}
                            className="h-6 w-8 cursor-pointer rounded border border-[var(--v-border)] bg-transparent p-0"
                          />
                        </label>
                        {currentCapture.overlayBgImage && (
                          <button
                            onClick={() => updateCapture({ overlayBgImage: null })}
                            className="text-[11px] text-[var(--v-text-faint)] underline hover:text-[var(--v-text)]"
                          >
                            Clear image
                          </button>
                        )}
                      </div>
                      {bgImages.length > 0 && (
                        <div>
                          <p className="mb-1 text-[11px] text-[var(--v-text-faint)]">Or use an image background</p>
                          <div className="flex flex-wrap gap-1.5">
                            {bgImages.map((m) => (
                              <button
                                key={m.id}
                                onClick={() => updateCapture({ overlayBgImage: m.url })}
                                className={`h-9 w-14 overflow-hidden rounded border-2 ${
                                  currentCapture.overlayBgImage === m.url
                                    ? "border-[var(--v-accent)]"
                                    : "border-[var(--v-border)] hover:border-[var(--v-accent)]"
                                }`}
                              >
                                <img src={m.url} alt="" className="h-full w-full object-cover" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--v-text-faint)]">
                  Preacher nameplate
                </p>
                <input
                  type="text"
                  placeholder="Name"
                  value={currentCapture.nameplate?.name ?? ""}
                  onChange={(e) => {
                    const name = e.target.value;
                    updateCapture({ nameplate: name ? { ...currentCapture.nameplate, name } : null });
                  }}
                  className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2 py-1.5 text-xs outline-none focus:border-[var(--v-accent)]"
                />
                {currentCapture.nameplate?.name && (
                  <input
                    type="text"
                    placeholder="Title (optional, e.g. Senior Pastor)"
                    value={currentCapture.nameplate?.title ?? ""}
                    onChange={(e) =>
                      updateCapture({ nameplate: { name: currentCapture.nameplate!.name, title: e.target.value } })
                    }
                    className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2 py-1.5 text-xs outline-none focus:border-[var(--v-accent)]"
                  />
                )}
                <p className="text-[10px] text-[var(--v-text-faint)]">
                  Shows over the video on every layout. Clear the name to hide it.
                </p>
              </div>
            </div>
          )}

          {capturePickerOpen && (
            <CapturePicker
              onClose={() => setCapturePickerOpen(false)}
              onPick={(s, layout) => {
                // Cue it, don't broadcast it: GO LIVE commits the capture.
                onCueCapture({ sourceId: s.id, name: s.name, kind: s.kind, layout });
                setCapturePickerOpen(false);
              }}
            />
          )}
        </div>
      ) : (
        <div className="v-scroll min-h-0 flex-1 overflow-y-auto p-5">
          {media.isLoading && <p className="text-xs text-[var(--v-text-faint)]">Loading…</p>}

          {!media.isLoading && !items.length && activeMedia && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[var(--v-surface-2)]">
                {tab === "image" ? (
                  <ImageIcon className="h-8 w-8 text-[var(--v-text-faint)]" />
                ) : (
                  <Film className="h-8 w-8 text-[var(--v-text-faint)]" />
                )}
              </div>
              <div>
                <p className="font-display text-lg font-semibold">No {activeMedia.label.toLowerCase()} yet</p>
                <p className="text-sm text-[var(--v-text-faint)]">
                  Add {activeMedia.label.toLowerCase()}, then click one to preview it before sending it live.
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
      )}
    </div>
  );
}
