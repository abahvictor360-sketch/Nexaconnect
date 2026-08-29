import { useRef, useState } from "react";
import { Upload, Loader2, Trash2, Film, Link2, Volume2, VolumeX, Repeat, Repeat1, Palette } from "lucide-react";
import {
  useMedia, useAddMediaUrl, useDeleteMedia, useUploadMedia, useUpdateMedia, type MediaItem,
} from "../hooks/use-media";
import { COLOR_FILTER_PRESETS, colorFilterCss } from "../lib/color-filters";
import { UploadError } from "./upload-error";

/**
 * Shared background/media picker grid - a library of images, videos and solid
 * colors that can be selected as a background. Used for the global Lyrics/
 * Bible backgrounds in Settings AND for per-slide backgrounds in the
 * Presentation editor, so upload/add-by-URL/delete/sound-toggle behave
 * identically everywhere a background is chosen.
 */
export function MediaPicker({
  activeId,
  onSelect,
  defaultFit = "cover",
  defaultMuted = true,
}: {
  activeId: string | null;
  onSelect: (id: string | null) => void;
  /** Applied to newly added images/videos (existing items are unaffected). */
  defaultFit?: "cover" | "contain" | "fill";
  /** Applied to newly added videos - true = silent by default. */
  defaultMuted?: boolean;
}) {
  const media = useMedia();
  const upload = useUploadMedia();
  const addUrl = useAddMediaUrl();
  const del = useDeleteMedia();
  const update = useUpdateMedia();
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [color, setColor] = useState("#0a0a0c");
  // Backgrounds only - audio lives in the Media Library, it can't be a backdrop.
  const items: MediaItem[] = (media.data ?? []).filter((m) => m.type !== "audio");

  return (
    <div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
        <button
          onClick={() => onSelect(null)}
          className={`relative aspect-video overflow-hidden rounded-md border-2 bg-[var(--v-surface-3)] text-[11px] text-[var(--v-text-faint)] transition-colors ${
            !activeId ? "border-[var(--v-accent)]" : "border-[var(--v-border)] hover:border-[var(--v-text-faint)]"
          }`}
        >
          <span className="grid h-full w-full place-items-center">None</span>
        </button>
        {items.map((m) => (
          <button
            key={m.id}
            onClick={() => onSelect(m.id)}
            className={`group relative aspect-video overflow-hidden rounded-md border-2 bg-black transition-colors ${
              activeId === m.id ? "border-[var(--v-accent)]" : "border-[var(--v-border)] hover:border-[var(--v-text-faint)]"
            }`}
          >
            {m.type === "color" ? (
              <span className="block h-full w-full" style={{ background: m.url }} />
            ) : m.type === "video" ? (
              <>
                <video
                  src={m.url}
                  muted
                  className="h-full w-full object-cover"
                  style={{ filter: colorFilterCss(m.colorFilter) }}
                />
                <Film className="absolute right-1 top-1 h-3 w-3 text-white/80" />
              </>
            ) : (
              <img
                src={m.url}
                alt=""
                className="h-full w-full object-cover"
                style={{ filter: colorFilterCss(m.colorFilter) }}
              />
            )}
            <span
              onClick={(e) => {
                e.stopPropagation();
                del.mutate(m.id);
                if (activeId === m.id) onSelect(null);
              }}
              className="absolute left-1 top-1 hidden rounded bg-black/60 p-0.5 text-white group-hover:block"
            >
              <Trash2 className="h-3 w-3" />
            </span>
            {m.type === "video" && (() => {
              // 0 = explicitly unmuted; anything else (1 / null / undefined) = muted.
              const isMuted = m.muted !== 0;
              // 0 = explicitly not looping; anything else (1 / null / undefined) = loops.
              const isLooping = m.loop !== 0;
              return (
                <span className="absolute bottom-1 left-1 hidden gap-0.5 group-hover:flex">
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      update.mutate({ id: m.id, muted: !isMuted });
                    }}
                    title={isMuted ? "Muted - click to play with sound" : "Playing with sound - click to mute"}
                    className="rounded bg-black/60 p-0.5 text-white"
                  >
                    {isMuted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3 text-[var(--v-accent)]" />}
                  </span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      update.mutate({ id: m.id, loop: !isLooping });
                    }}
                    title={isLooping ? "Loops - click to play once" : "Plays once - click to loop"}
                    className="rounded bg-black/60 p-0.5 text-white"
                  >
                    {isLooping ? <Repeat className="h-3 w-3 text-[var(--v-accent)]" /> : <Repeat1 className="h-3 w-3" />}
                  </span>
                </span>
              );
            })()}
            {(m.type === "video" || m.type === "image") && (() => {
              const current = m.colorFilter ?? "none";
              const idx = COLOR_FILTER_PRESETS.findIndex((p) => p.id === current);
              const preset = COLOR_FILTER_PRESETS[idx >= 0 ? idx : 0];
              const next = COLOR_FILTER_PRESETS[(Math.max(idx, 0) + 1) % COLOR_FILTER_PRESETS.length];
              return (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    update.mutate({ id: m.id, colorFilter: next.id === "none" ? null : next.id });
                  }}
                  title={`Look: ${preset.label} - click for ${next.label}`}
                  className="absolute bottom-1 right-1 hidden items-center gap-1 rounded bg-black/60 px-1 py-0.5 text-[11px] text-white group-hover:flex"
                >
                  <Palette className={`h-3 w-3 ${preset.id !== "none" ? "text-[var(--v-accent)]" : ""}`} /> {preset.label}
                </span>
              );
            })()}
          </button>
        ))}
        <button
          onClick={() => fileRef.current?.click()}
          className="grid aspect-video place-items-center rounded-md border-2 border-dashed border-[var(--v-border)] text-[var(--v-text-faint)] transition-colors hover:border-[var(--v-accent)] hover:text-[var(--v-accent)]"
          title="Upload image or video"
        >
          {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        </button>
      </div>
      {media.isLoading && <p className="mt-2 text-[12px] text-[var(--v-text-faint)]">Loading media…</p>}
      <p className="mt-1.5 text-[11px] text-[var(--v-text-faint)]">
        Hover a video thumbnail to mute/unmute it - most backgrounds should stay silent under lyrics.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          upload.reset();
          if (f) upload.mutate(f);
          e.target.value = "";
        }}
      />

      <UploadError error={upload.error} />

      <div className="mt-3 flex gap-1.5">
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--v-text-faint)]" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Add image / video by URL"
            className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] py-1.5 pl-7 pr-2 text-xs outline-none focus:border-[var(--v-accent)]"
          />
        </div>
        <button
          disabled={!url.trim() || addUrl.isPending}
          onClick={() => {
            const u = url.trim();
            const type = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u) ? "video" : "image";
            addUrl.mutate({ type, uri: u, fit: defaultFit, muted: defaultMuted }, { onSuccess: () => setUrl("") });
          }}
          className="rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2.5 text-xs hover:bg-[var(--v-surface)] disabled:opacity-40"
        >
          Add
        </button>
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-8 w-9 cursor-pointer rounded border border-[var(--v-border)] bg-transparent"
          />
          <button
            onClick={() => addUrl.mutate({ type: "color", uri: color })}
            className="rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2.5 py-1.5 text-xs hover:bg-[var(--v-surface)]"
          >
            Add color
          </button>
        </div>
      </div>
    </div>
  );
}
