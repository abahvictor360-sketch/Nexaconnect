import { MediaImg, MediaVideo } from "./media-el";
import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Loader2, Trash2, Image as ImageIcon, Film, MonitorPlay, Square, X, Frame } from "lucide-react";
import { useSessionMedia, useMedia, useUploadMedia, useDeleteMedia, useUpdateMedia, type MediaItem, type MediaKind } from "../hooks/use-media";
import { UploadError } from "./upload-error";
import { CapturePicker } from "./capture";
import { useLiveState } from "../hooks/use-live";
import { liveBus, type LiveCapture } from "../lib/live-bus";
import type { StageSlide } from "../lib/stage";
import type { LiveBackground } from "../lib/live-bus";
import { MEDIA_FITS, fitLabel, nextFit, resolveFit } from "../lib/media-fit";
import { COLOR_FILTER_PRESETS } from "../lib/color-filters";
import { useLuts, useUploadLut, useDeleteLut } from "../hooks/use-luts";

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
const V_POS = ["top", "center", "bottom"] as const;
const H_POS = ["left", "center", "right"] as const;

/** 3x3 anchor picker for where text sits inside the lower-third band. */
function TextPlacementGrid({
  vertical,
  horizontal,
  onChange,
}: {
  vertical: "top" | "center" | "bottom";
  horizontal: "left" | "center" | "right";
  onChange: (v: "top" | "center" | "bottom", h: "left" | "center" | "right") => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] text-[var(--v-text-faint)]">Text placement</span>
      <div className="grid w-[84px] grid-cols-3 gap-1 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] p-1">
        {V_POS.map((v) =>
          H_POS.map((h) => {
            const active = v === vertical && h === horizontal;
            return (
              <button
                key={`${v}-${h}`}
                onClick={() => onChange(v, h)}
                aria-label={`${v} ${h}`}
                className={`grid h-6 w-6 place-items-center rounded-sm transition-colors ${
                  active ? "bg-[var(--v-accent)]" : "bg-[var(--v-surface-2)] hover:bg-[var(--v-border)]"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${active ? "bg-black" : "bg-[var(--v-text-faint)]"}`}
                />
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}

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
    <label className="flex flex-col gap-1 text-[12px] text-[var(--v-text-faint)]">
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
  cue,
}: {
  onSlidesChange: (slides: StageSlide[]) => void;
  onPreview: (index: number) => void;
  onSendLive: (index: number) => void;
  previewId: string | null;
  liveId: string | null;
  /** Capture cued into preview but not yet live (lives in the parent - GO LIVE commits it). */
  pendingCapture: LiveCapture;
  /** null clears a cued-but-not-live capture, so preview can be emptied again. */
  onCueCapture: (capture: LiveCapture) => void;
  /** Externally chosen media item (e.g. the phone remote's upload) - switches tab and previews it. */
  cue?: { mediaId: string; nonce: number } | null;
}) {
  const media = useMedia();
  const upload = useUploadMedia();
  const del = useDeleteMedia();
  const update = useUpdateMedia();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("image");
  const [capturePickerOpen, setCapturePickerOpen] = useState(false);
  const live = useLiveState();
  const luts = useLuts();
  const uploadLut = useUploadLut();
  const deleteLut = useDeleteLut();
  const lutFileRef = useRef<HTMLInputElement>(null);

  // A cue names a media id, not an index - switch to its tab first, then
  // preview it once the item list has actually updated to reflect that tab
  // (a single effect keyed on the id would fire against the WRONG tab's list).
  const appliedCueNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!cue?.mediaId) return;
    const item = (media.data ?? []).find((m) => m.id === cue.mediaId);
    if (item) setTab(item.type === "video" ? "video" : "image");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cue?.nonce]);

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

  useEffect(() => {
    if (!cue?.mediaId || appliedCueNonceRef.current === cue.nonce) return;
    const idx = items.findIndex((m) => m.id === cue.mediaId);
    if (idx < 0) return; // items hasn't caught up to the tab switch yet
    onPreview(idx);
    appliedCueNonceRef.current = cue.nonce;
  }, [items, cue?.mediaId, cue?.nonce, onPreview]);

  const slides = useMemo<StageSlide[]>(
    () =>
      items.map((m, i) => {
        const background: LiveBackground = {
          type: m.type === "video" ? "video" : "image",
          url: m.url,
          // The image IS the slide here, so it must not be cropped by default.
          fit: resolveFit(m.fit, "slide"),
          loop: !!m.loop,
          muted: m.muted !== 0,
          colorFilter: m.colorFilter,
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
                upload.reset();
                for (const f of Array.from(e.target.files ?? [])) upload.mutate(f);
                e.target.value = "";
              }}
            />
          </>
        )}
      </div>

      <UploadError error={upload.error} />

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
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setCapturePickerOpen(true)}
                  className="rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-3 py-1.5 text-xs hover:bg-[var(--v-surface)]"
                >
                  Change source
                </button>
                {/* Cueing a capture used to be one-way: nothing dropped it
                    again short of sending it live, so a source picked by
                    mistake sat in Preview for the rest of the service. */}
                <button
                  onClick={() => onCueCapture(null)}
                  className="flex items-center gap-1.5 rounded-md border border-[var(--v-border)] px-3 py-1.5 text-xs text-[var(--v-text-faint)] hover:bg-[var(--v-surface)] hover:text-[var(--v-text)]"
                >
                  <X className="h-3.5 w-3.5" /> Remove from preview
                </button>
              </div>
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
              {/* Sound. A camera or capture card can use the room mic, since
                  the thing being filmed is usually speaking into a PA the
                  camera's own mic hears badly. A screen or window has no mic
                  of its own to offer - its "own audio" is the machine's
                  system sound - so the mic option is not shown for one. */}
              <div className="space-y-2 border-b border-[var(--v-border)] pb-3">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--v-text-faint)]">
                  Sound
                </p>
                <div className="flex gap-1.5">
                  {([
                    { id: "none", label: "Silent" },
                    { id: "capture", label: currentCapture.kind === "camera" ? "From device" : "System sound" },
                    ...(currentCapture.kind === "camera" ? [{ id: "mic" as const, label: "Microphone" }] : []),
                  ] as { id: "none" | "capture" | "mic"; label: string }[]).map((o) => (
                    <button
                      key={o.id}
                      onClick={() => updateCapture({ audioSource: o.id })}
                      className={`flex-1 rounded-md border px-2 py-1.5 text-[12px] transition-colors ${
                        (currentCapture.audioSource ?? "none") === o.id
                          ? "border-[var(--v-accent)] bg-[var(--v-accent-soft)] text-[var(--v-accent)]"
                          : "border-[var(--v-border)] hover:bg-[var(--v-surface-3)]"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-[var(--v-text-faint)]">
                  {currentCapture.kind === "camera"
                    ? "Heard on the projector output. Not every capture card carries audio - if picking “From device” stays silent, yours doesn’t, so use the microphone instead."
                    : "System sound is the whole machine’s output, not just this window - Windows offers no way to capture one window’s audio on its own."}
                </p>
              </div>

              {currentCapture.layout === "overlay" && (
                <div className="space-y-2 border-b border-[var(--v-border)] pb-3">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--v-text-faint)]">
                    Lyrics / Bible over video
                  </p>
                  <div className="flex gap-1.5">
                    {(["fullscreen", "lower_third"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => updateCapture({ overlayMode: m })}
                        className={`flex-1 rounded-md border px-2 py-1.5 text-[12px] transition-colors ${
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
                      <TextPlacementGrid
                        vertical={currentCapture.overlayTextVerticalPos ?? "bottom"}
                        horizontal={currentCapture.overlayTextAlign ?? "center"}
                        onChange={(v, h) => updateCapture({ overlayTextVerticalPos: v, overlayTextAlign: h })}
                      />

                      <div className="flex gap-1.5">
                        {([true, false] as const).map((enabled) => (
                          <button
                            key={String(enabled)}
                            onClick={() => updateCapture({ overlayBgEnabled: enabled })}
                            className={`flex-1 rounded-md border px-2 py-1.5 text-[12px] transition-colors ${
                              (currentCapture.overlayBgEnabled ?? true) === enabled
                                ? "border-[var(--v-accent)] bg-[var(--v-accent-soft)] text-[var(--v-accent)]"
                                : "border-[var(--v-border)] hover:bg-[var(--v-surface-3)]"
                            }`}
                          >
                            {enabled ? "With background" : "No background"}
                          </button>
                        ))}
                      </div>

                      {(currentCapture.overlayBgEnabled ?? true) ? (
                        <>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1.5 text-[12px] text-[var(--v-text-faint)]">
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
                                className="text-[12px] text-[var(--v-text-faint)] underline hover:text-[var(--v-text)]"
                              >
                                Clear image
                              </button>
                            )}
                          </div>
                          {bgImages.length > 0 && (
                            <div>
                              <p className="mb-1 text-[12px] text-[var(--v-text-faint)]">Or use an image background</p>
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
                                    <MediaImg src={m.url} alt="" className="h-full w-full object-cover" />
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-[11px] text-[var(--v-text-faint)]">
                          Words float directly over the video with a black shadow for contrast - no bar behind them.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--v-text-faint)]">
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
                <p className="text-[11px] text-[var(--v-text-faint)]">
                  Shows over the video on every layout. Clear the name to hide it.
                </p>
              </div>

              <div className="space-y-2 border-t border-[var(--v-border)] pt-3">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--v-text-faint)]">
                  Video filter
                </p>
                <label className="flex items-center justify-between gap-2 text-[12px] text-[var(--v-text-faint)]">
                  Look
                  <select
                    value={currentCapture.lutId ? `lut:${currentCapture.lutId}` : `preset:${currentCapture.colorFilter ?? "none"}`}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.startsWith("lut:")) updateCapture({ lutId: v.slice(4), colorFilter: null });
                      else {
                        const id = v.slice(7);
                        updateCapture({ colorFilter: id === "none" ? null : id, lutId: null });
                      }
                    }}
                    className="min-w-0 flex-1 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2 py-1.5 text-xs text-[var(--v-text)] outline-none focus:border-[var(--v-accent)]"
                  >
                    <optgroup label="Presets">
                      {COLOR_FILTER_PRESETS.map((p) => (
                        <option key={p.id} value={`preset:${p.id}`}>{p.label}</option>
                      ))}
                    </optgroup>
                    {luts.data && luts.data.length > 0 && (
                      <optgroup label="My LUTs">
                        {luts.data.map((l) => (
                          <option key={l.id} value={`lut:${l.id}`}>{l.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => lutFileRef.current?.click()}
                    disabled={uploadLut.isPending}
                    className="flex items-center gap-1.5 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2 py-1 text-[12px] hover:bg-[var(--v-surface)] disabled:opacity-50"
                  >
                    {uploadLut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                    Upload LUT (.cube)
                  </button>
                  {currentCapture.lutId && (
                    <button
                      onClick={() => {
                        const id = currentCapture.lutId!;
                        updateCapture({ lutId: null });
                        deleteLut.mutate(id);
                      }}
                      className="text-[12px] text-[var(--v-text-faint)] underline hover:text-[var(--v-text)]"
                    >
                      Remove this LUT
                    </button>
                  )}
                </div>
                <input
                  ref={lutFileRef}
                  type="file"
                  accept=".cube"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      uploadLut.mutate(f, {
                        onSuccess: (lut) => updateCapture({ lutId: lut.id, colorFilter: null }),
                      });
                    }
                    e.target.value = "";
                  }}
                />
                {uploadLut.isError && (
                  <p className="text-[11px] text-red-400">{(uploadLut.error as Error).message}</p>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-[var(--v-text-faint)]">Chroma key (green screen)</span>
                  <button
                    onClick={() =>
                      updateCapture({
                        chromaKey: {
                          enabled: !(currentCapture.chromaKey?.enabled ?? false),
                          color: currentCapture.chromaKey?.color ?? "#00b140",
                          similarity: currentCapture.chromaKey?.similarity ?? 0.35,
                          smoothness: currentCapture.chromaKey?.smoothness ?? 0.15,
                        },
                      })
                    }
                    className={`rounded-md border px-2 py-1 text-[12px] transition-colors ${
                      currentCapture.chromaKey?.enabled
                        ? "border-[var(--v-accent)] bg-[var(--v-accent-soft)] text-[var(--v-accent)]"
                        : "border-[var(--v-border)] text-[var(--v-text-faint)] hover:bg-[var(--v-surface-3)]"
                    }`}
                  >
                    {currentCapture.chromaKey?.enabled ? "On" : "Off"}
                  </button>
                </div>

                {currentCapture.chromaKey?.enabled && (
                  <>
                    <label className="flex items-center gap-1.5 text-[12px] text-[var(--v-text-faint)]">
                      Key color
                      <input
                        type="color"
                        value={currentCapture.chromaKey.color}
                        onChange={(e) => updateCapture({ chromaKey: { ...currentCapture.chromaKey!, color: e.target.value } })}
                        className="h-6 w-8 cursor-pointer rounded border border-[var(--v-border)] bg-transparent p-0"
                      />
                      <span className="text-[11px]">Match the actual backdrop, not just "green".</span>
                    </label>
                    <OverlaySlider
                      label="Tolerance"
                      min={5}
                      max={80}
                      value={Math.round(currentCapture.chromaKey.similarity * 100)}
                      onChange={(v) => updateCapture({ chromaKey: { ...currentCapture.chromaKey!, similarity: v / 100 } })}
                    />
                    <OverlaySlider
                      label="Edge softness"
                      min={0}
                      max={60}
                      value={Math.round(currentCapture.chromaKey.smoothness * 100)}
                      onChange={(v) => updateCapture({ chromaKey: { ...currentCapture.chromaKey!, smoothness: v / 100 } })}
                    />
                    <p className="text-[11px] text-[var(--v-text-faint)]">
                      Too little tolerance leaves a green fringe; too much eats into the subject. Raise edge
                      softness if the cutout looks jagged.
                    </p>
                  </>
                )}
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

          {items.length > 0 && <SessionMediaNote />}

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
                      <MediaVideo src={m.url} muted className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <MediaImg src={m.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                    )}
                    {isLive && (
                      <span className="absolute left-1.5 top-1.5 rounded bg-[var(--v-live)] px-1.5 py-0.5 text-[11px] font-bold uppercase text-white">
                        Live
                      </span>
                    )}
                    {isPreview && (
                      <span className="absolute left-1.5 top-1.5 rounded bg-[var(--v-accent)] px-1.5 py-0.5 text-[11px] font-bold uppercase text-black">
                        Preview
                      </span>
                    )}
                    {m.sessionOnly && !isLive && !isPreview && (
                      <span
                        title="Kept in this browser only - never uploaded, and not visible to an OBS source or another device."
                        className="absolute left-1.5 top-1.5 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-bold uppercase text-black"
                      >
                        This browser
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
                    {/*
                      How this one sits on the screen. Per item, because it is
                      a property of the picture and not of the service: a
                      flyer wants all of itself visible, the photo next to it
                      wants to fill the screen. Clicking advances through the
                      three, so the operator can watch Preview change rather
                      than having to know what "contain" means.
                    */}
                    {(() => {
                      const fit = resolveFit(m.fit, "slide");
                      const after = nextFit(fit);
                      return (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            update.mutate({ id: m.id, fit: after });
                          }}
                          title={`${MEDIA_FITS.find((f) => f.id === fit)?.hint ?? ""} - click for ${fitLabel(after)}`}
                          className="absolute bottom-1.5 left-1.5 hidden items-center gap-1 rounded bg-black/60 px-1.5 py-1 text-[11px] text-white hover:bg-black/80 group-hover:flex"
                        >
                          <Frame className="h-3.5 w-3.5 text-[var(--v-accent)]" /> {fitLabel(fit)}
                        </button>
                      );
                    })()}
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

/**
 * A line above the grid when any of it is only in this browser.
 *
 * Silence would be the wrong default here. These files behave differently from
 * every other item beside them - they survive a click but not a reload, and
 * they reach the projector window without reaching an OBS source - and finding
 * that out during a service is the one time it must not be a surprise.
 */
function SessionMediaNote() {
  const held = useSessionMedia().length;
  if (!held) return null;
  return (
    <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200/90">
      <b>{held} file{held === 1 ? " is" : "s are"} kept in this browser.</b>{" "}
      Nothing is uploaded - {held === 1 ? "it lives" : "they live"} in this browser's own storage, so{" "}
      {held === 1 ? "it survives" : "they survive"} a reload and will be here next Sunday. What that cannot do is
      reach anything that is not this browser: an OBS source and a phone are separate browsers, so{" "}
      {held === 1 ? "it will not show" : "they will not show"} there. Install the desktop app if you need media
      every device can see.
    </p>
  );
}
