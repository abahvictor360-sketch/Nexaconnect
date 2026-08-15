import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Monitor, AppWindow, X, Video } from "lucide-react";
import { getDesktopAPI, type CaptureSource } from "../lib/desktop";

/**
 * Live screen/window mirroring.
 *
 * Electron exposes desktop sources through getUserMedia's legacy `mandatory`
 * constraints rather than getDisplayMedia — that's the only form that accepts
 * a specific chromeMediaSourceId, which is how we show ONE chosen window
 * instead of prompting the operator to pick again on the projector.
 */
/** Prefix marking a video-input device rather than a desktop source. */
export const CAMERA_PREFIX = "camera:";

async function openSourceStream(sourceId: string): Promise<MediaStream> {
  // Cameras and HDMI capture cards are ordinary video inputs, addressed by
  // deviceId — the desktop-source constraints below don't apply to them.
  if (sourceId.startsWith(CAMERA_PREFIX)) {
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: { ideal: sourceId.slice(CAMERA_PREFIX.length) },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
  }
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 30,
      },
    } as unknown as MediaTrackConstraints,
  });
}

/** Renders a live capture full-bleed. Used on the projector and in previews. */
export function CaptureView({ sourceId, muted = true }: { sourceId: string; muted?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    openSourceStream(sourceId)
      .then((s) => {
        // The effect can be torn down mid-request; stop the orphan stream so
        // the OS capture indicator doesn't stay on after switching sources.
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Capture failed");
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [sourceId]);

  if (error) {
    return (
      <div className="grid h-full w-full place-items-center bg-black p-6 text-center text-sm text-white/70">
        Capture unavailable — {error}
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      className="h-full w-full bg-black object-contain"
    />
  );
}

/** Modal source picker — lists screens and windows with live thumbnails. */
const LAYOUTS: { id: CaptureLayout; label: string; hint: string }[] = [
  { id: "full", label: "Full screen", hint: "Video only" },
  { id: "overlay", label: "Lyrics over video", hint: "Lower third / text on top" },
  { id: "pip", label: "Side by side", hint: "Video beside the words" },
];

export function CapturePicker({
  onPick,
  onClose,
}: {
  onPick: (source: CaptureSource, layout: CaptureLayout) => void;
  onClose: () => void;
}) {
  const [layout, setLayout] = useState<CaptureLayout>("full");
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const desktop = getDesktopAPI();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Cameras and capture cards come from the browser's device list, not from
  // Electron's desktop sources, so they're fetched separately and merged.
  const loadCameras = useCallback(async (): Promise<CaptureSource[]> => {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true });
      probe.getTracks().forEach((t) => t.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === "videoinput")
        .map((d, i) => ({
          id: `${CAMERA_PREFIX}${d.deviceId}`,
          name: d.label || `Camera ${i + 1}`,
          kind: "camera" as const,
          thumbnail: "",
        }));
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const cameras = await loadCameras();
      if (cancelled) return;
      if (!desktop?.listCaptureSources) {
        // In a browser there are no desktop sources, but a capture card still
        // works — so show cameras rather than refusing outright.
        setSources(cameras);
        if (!cameras.length) setError("No capture card or camera found, and screen capture needs the desktop app.");
        return;
      }
      try {
        const desktopSources = await desktop.listCaptureSources();
        if (!cancelled) setSources([...cameras, ...desktopSources]);
      } catch {
        if (!cancelled) setError("Could not list screens and windows.");
      }
    };

    void load();
    // Windows open and close while the picker is up; refresh so the operator
    // isn't choosing from a stale list mid-service.
    const timer = setInterval(() => void load(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [desktop, loadCameras]);

  const cameras = sources?.filter((s) => s.kind === "camera") ?? [];
  const screens = sources?.filter((s) => s.kind === "screen") ?? [];
  const windows = sources?.filter((s) => s.kind === "window") ?? [];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-2)] p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Capture a screen or window</h2>
          <button
            onClick={onClose}
            aria-label="Close capture picker"
            className="rounded p-1 text-[var(--v-text-faint)] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              onClick={() => setLayout(l.id)}
              className={`rounded-md border px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                layout === l.id
                  ? "border-[var(--v-accent)] bg-[var(--v-accent-soft)] text-[var(--v-accent)]"
                  : "border-[var(--v-border)] hover:bg-[var(--v-surface-3)]"
              }`}
            >
              <span className="block font-medium">{l.label}</span>
              <span className="block text-[var(--v-text-faint)]">{l.hint}</span>
            </button>
          ))}
        </div>

        {error && <p className="py-6 text-center text-xs text-[var(--v-text-faint)]">{error}</p>}
        {!error && !sources && (
          <p className="flex items-center justify-center gap-2 py-10 text-xs text-[var(--v-text-faint)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Finding screens and windows…
          </p>
        )}

        {[
          { label: "Cameras & capture cards", icon: Video, items: cameras },
          { label: "Screens", icon: Monitor, items: screens },
          { label: "Windows", icon: AppWindow, items: windows },
        ].map(({ label, icon: Icon, items }) =>
          items.length ? (
            <section key={label} className="mb-4">
              <h3 className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[var(--v-text-faint)]">
                <Icon className="h-3 w-3" /> {label}
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {items.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onPick(s, layout)}
                    className="group overflow-hidden rounded-md border-2 border-[var(--v-border)] bg-black text-left transition-colors hover:border-[var(--v-accent)]"
                  >
                    {s.thumbnail ? (
                      <img src={s.thumbnail} alt="" className="aspect-video w-full object-contain" />
                    ) : (
                      // Video inputs have no still to show without opening the
                      // device, which would fight the operator's own preview.
                      <span className="grid aspect-video w-full place-items-center text-[var(--v-text-faint)]">
                        <Video className="h-6 w-6" />
                      </span>
                    )}
                    <span className="block truncate px-2 py-1.5 text-[11px] text-[var(--v-text)]" title={s.name}>
                      {s.name}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null,
        )}
      </div>
    </div>
  );
}
