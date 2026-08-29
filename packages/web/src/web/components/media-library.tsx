import { useEffect, useRef, useState } from "react";
import { Upload, Loader2, Trash2, Film, Music, Image as ImageIcon, X, MonitorPlay, Square } from "lucide-react";
import { useMedia, useDeleteMedia, useUploadMedia, type MediaItem, type MediaKind } from "../hooks/use-media";
import { UploadError } from "./upload-error";
import { CapturePicker } from "./capture";
import { liveBus, type LiveCapture } from "../lib/live-bus";
import { useLiveState } from "../hooks/use-live";

const TABS: { key: MediaKind; label: string; accept: string }[] = [
  { key: "image", label: "Images", accept: "image/*" },
  { key: "video", label: "Videos", accept: "video/*" },
  { key: "audio", label: "Audio", accept: "audio/*" },
];

/**
 * The Media Library - everything the church has added (images, videos, audio)
 * plus live screen/window capture, in one place. Files added here are copied
 * into Documents/Vifug/Media by the server, so they survive reinstalls
 * and can be managed in Explorer/Finder too.
 */
export function MediaLibrary({
  onClose,
  onCueCapture,
}: {
  onClose: () => void;
  /** Cue a capture into preview. Omitted in contexts with no stage to cue to. */
  onCueCapture?: (capture: NonNullable<LiveCapture>) => void;
}) {
  const [tab, setTab] = useState<MediaKind>("image");
  const [capturePickerOpen, setCapturePickerOpen] = useState(false);
  const media = useMedia();
  const upload = useUploadMedia();
  const del = useDeleteMedia();
  const fileRef = useRef<HTMLInputElement>(null);
  const live = useLiveState();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const active = TABS.find((t) => t.key === tab)!;
  const items: MediaItem[] = (media.data ?? []).filter((m) => m.type === tab);

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-6">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-2)]">
        <header className="flex items-center justify-between border-b border-[var(--v-border)] px-4 py-3">
          <h2 className="text-sm font-semibold">Media Library</h2>
          <div className="flex items-center gap-2">
            {live.capture ? (
              <button
                onClick={() => liveBus().setCapture(null)}
                className="flex items-center gap-1.5 rounded-md border border-[var(--v-accent)] px-2.5 py-1.5 text-xs text-[var(--v-accent)]"
                title={`Capturing ${live.capture.name}`}
              >
                <Square className="h-3.5 w-3.5" /> Stop capture
              </button>
            ) : (
              <button
                onClick={() => setCapturePickerOpen(true)}
                className="flex items-center gap-1.5 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2.5 py-1.5 text-xs hover:bg-[var(--v-surface)]"
              >
                <MonitorPlay className="h-3.5 w-3.5" /> Capture screen / window
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close media library"
              className="rounded p-1 text-[var(--v-text-faint)] hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <nav className="flex gap-1 border-b border-[var(--v-border)] px-4 py-2">
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
            className="ml-auto flex items-center gap-1.5 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2.5 py-1.5 text-xs hover:bg-[var(--v-surface)]"
          >
            {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Add {active.label.toLowerCase()}
          </button>
        </nav>

        <UploadError error={upload.error} />

        <div className="flex-1 overflow-y-auto p-4">
          {media.isLoading && <p className="text-xs text-[var(--v-text-faint)]">Loading media…</p>}
          {!media.isLoading && !items.length && (
            <p className="py-10 text-center text-xs text-[var(--v-text-faint)]">
              No {active.label.toLowerCase()} yet - use “Add {active.label.toLowerCase()}” above.
            </p>
          )}

          {tab === "audio" ? (
            <ul className="space-y-1.5">
              {items.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-3 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-3 py-2"
                >
                  <Music className="h-4 w-4 shrink-0 text-[var(--v-accent)]" />
                  <span className="min-w-0 flex-1 truncate text-xs" title={nameOf(m)}>
                    {nameOf(m)}
                  </span>
                  <audio src={m.url} controls preload="none" className="h-8 max-w-[260px]" />
                  <button
                    onClick={() => del.mutate(m.id)}
                    aria-label={`Delete ${nameOf(m)}`}
                    className="rounded p-1 text-[var(--v-text-faint)] hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {items.map((m) => (
                <div
                  key={m.id}
                  className="group relative aspect-video overflow-hidden rounded-md border border-[var(--v-border)] bg-black"
                >
                  {m.type === "video" ? (
                    <>
                      <video src={m.url} muted className="h-full w-full object-cover" />
                      <Film className="absolute right-1 top-1 h-3 w-3 text-white/80" />
                    </>
                  ) : (
                    <img src={m.url} alt="" className="h-full w-full object-cover" />
                  )}
                  <button
                    onClick={() => del.mutate(m.id)}
                    aria-label={`Delete ${nameOf(m)}`}
                    className="absolute left-1 top-1 hidden rounded bg-black/60 p-1 text-white hover:text-red-400 group-hover:block"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[11px] text-white/90">
                    {nameOf(m)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-[var(--v-border)] px-4 py-2 text-[11px] text-[var(--v-text-faint)]">
          <ImageIcon className="h-3 w-3" />
          Files are copied into Documents › Vifug › Media. Use the Media menu to open that folder.
        </footer>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={active.accept}
        multiple
        className="hidden"
        onChange={(e) => {
          upload.reset();
          for (const f of Array.from(e.target.files ?? [])) upload.mutate(f);
          e.target.value = "";
        }}
      />

      {capturePickerOpen && (
        <CapturePicker
          onClose={() => setCapturePickerOpen(false)}
          onPick={(s, layout) => {
            // Cue rather than broadcast: the operator confirms framing in the
            // preview column, then GO LIVE puts it on the screen.
            onCueCapture?.({ sourceId: s.id, name: s.name, kind: s.kind, layout });
            setCapturePickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Stored uploads are prefixed "<timestamp>-<rand>-" - show the original name. */
function nameOf(m: MediaItem): string {
  const raw = m.uri.startsWith("local:") ? m.uri.slice(6) : m.uri.split("/").pop() ?? m.uri;
  return decodeURIComponent(raw).replace(/^\d+-[a-f0-9]{8}-/i, "");
}
