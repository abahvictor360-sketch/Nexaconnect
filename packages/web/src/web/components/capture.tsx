import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Monitor, AppWindow, X, Video } from "lucide-react";
import { getDesktopAPI, type CaptureSource } from "../lib/desktop";
import { colorFilterCss } from "../lib/color-filters";
import { applyLutToImageData, cacheLut, getCachedLut, parseCubeFile, type Lut3D } from "../lib/lut";
import { fetchCubeText } from "../hooks/use-luts";
import type { LiveCapture, CaptureLayout } from "../lib/live-bus";

/**
 * Live screen/window mirroring.
 *
 * Electron exposes desktop sources through getUserMedia's legacy `mandatory`
 * constraints rather than getDisplayMedia - that's the only form that accepts
 * a specific chromeMediaSourceId, which is how we show ONE chosen window
 * instead of prompting the operator to pick again on the projector.
 */
/** Prefix marking a video-input device rather than a desktop source. */
export const CAMERA_PREFIX = "camera:";

export type CaptureAudioSource = "none" | "capture" | "mic";

/**
 * Opens the chosen source's video, plus audio if asked for.
 *
 * "capture" means different things per source type and both are handled here:
 * a camera/capture card carries its own audio track on the same device, while
 * a screen or window needs Chromium's desktop loopback constraint. "mic" is
 * fetched as a separate getUserMedia call and its track grafted onto the same
 * stream, since the room mic is a different device from whatever is being
 * captured.
 */
async function openSourceStream(
  sourceId: string,
  audioSource: CaptureAudioSource = "none",
  micDeviceId?: string | null,
): Promise<MediaStream> {
  const wantsCaptureAudio = audioSource === "capture";
  let stream: MediaStream;

  // Cameras and HDMI capture cards are ordinary video inputs, addressed by
  // deviceId - the desktop-source constraints below don't apply to them.
  if (sourceId.startsWith(CAMERA_PREFIX)) {
    const deviceId = sourceId.slice(CAMERA_PREFIX.length);
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: wantsCaptureAudio ? { deviceId: { ideal: deviceId } } : false,
        video: { deviceId: { ideal: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch {
      // Plenty of capture cards expose no audio input at all. Losing the
      // picture because the sound was unavailable is the wrong trade, so fall
      // back to video-only rather than surfacing a failure.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { deviceId: { ideal: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    }
  } else {
    const video = {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 30,
      },
    } as unknown as MediaTrackConstraints;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Desktop loopback is system-wide, not per-window - Chromium offers no
        // way to capture one window's audio alone.
        audio: wantsCaptureAudio
          ? ({ mandatory: { chromeMediaSource: "desktop" } } as unknown as MediaTrackConstraints)
          : false,
        video,
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
    }
  }

  if (audioSource === "mic") {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: micDeviceId ? { deviceId: { ideal: micDeviceId } } : true,
      });
      mic.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch {
      /* no mic available - keep the video rather than failing the capture */
    }
  }

  return stream;
}

/** "#rrggbb" -> [r,g,b]. Falls back to broadcast green on anything unparseable. */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0, 177, 64];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

type ChromaKeyOpts = NonNullable<NonNullable<LiveCapture>["chromaKey"]>;

/**
 * Renders `video`'s frames onto a canvas, applying a real 3D LUT color
 * transform and/or chroma-key transparency in one pass over the same pixel
 * data - run every frame. A GPU shader (WebGL) would do this more cheaply,
 * but a 2D canvas needs no shader compilation, no context-loss handling, and
 * works identically across every platform the app already targets - well
 * worth the extra CPU for a feature used on one capture feed at a time, not
 * a whole video wall.
 */
function VideoFxCanvas({
  video,
  chromaKey,
  lutId,
}: {
  video: HTMLVideoElement;
  chromaKey?: ChromaKeyOpts | null;
  lutId?: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [lut, setLut] = useState<Lut3D | null>(null);

  // Fetch + parse the LUT once per id, then keep it in the module-level
  // cache in lib/lut.ts - re-parsing a 33^3 table on every mount would be
  // real, avoidable work for a file that never changes underneath its id.
  useEffect(() => {
    if (!lutId) {
      setLut(null);
      return;
    }
    const cached = getCachedLut(lutId);
    if (cached) {
      setLut(cached);
      return;
    }
    let cancelled = false;
    fetchCubeText(lutId)
      .then((text) => {
        const parsed = parseCubeFile(text);
        if (parsed) cacheLut(lutId, parsed);
        if (!cancelled) setLut(parsed);
      })
      .catch(() => {
        if (!cancelled) setLut(null);
      });
    return () => {
      cancelled = true;
    };
  }, [lutId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const keying = !!chromaKey?.enabled;
    const [kr, kg, kb] = keying ? hexToRgb(chromaKey!.color) : [0, 0, 0];
    // Max possible distance between two RGB colors, so similarity/smoothness
    // (0-1 sliders) scale to the same range regardless of the key color.
    const MAX_DIST = Math.sqrt(255 * 255 * 3);
    const cut = keying ? chromaKey!.similarity * MAX_DIST : 0;
    const soft = keying ? Math.max(1, chromaKey!.smoothness * MAX_DIST) : 1;
    let raf = 0;

    const draw = () => {
      if (video.readyState >= 2 && video.videoWidth) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (lut || keying) {
          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
          if (lut) applyLutToImageData(frame, lut);
          if (keying) {
            const d = frame.data;
            for (let i = 0; i < d.length; i += 4) {
              const dr = d[i] - kr, dg = d[i + 1] - kg, db = d[i + 2] - kb;
              const dist = Math.sqrt(dr * dr + dg * dg + db * db);
              if (dist < cut) d[i + 3] = 0;
              else if (dist < cut + soft) d[i + 3] = Math.round((255 * (dist - cut)) / soft);
            }
          }
          ctx.putImageData(frame, 0, 0);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [video, chromaKey, lut]);

  return <canvas ref={canvasRef} className="h-full w-full bg-black object-contain" />;
}

/** Renders a live capture full-bleed. Used on the projector and in previews. */
export function CaptureView({
  sourceId,
  muted = true,
  colorFilter,
  lutId,
  chromaKey,
  audioSource = "none",
  micDeviceId,
}: {
  sourceId: string;
  muted?: boolean;
  colorFilter?: string | null;
  /** A real uploaded 3D LUT, by id - takes over from `colorFilter` when set. */
  lutId?: string | null;
  chromaKey?: ChromaKeyOpts | null;
  /** Where this capture's sound comes from - see LiveCapture.audioSource. */
  audioSource?: CaptureAudioSource;
  /** Which mic, when audioSource is "mic". null = system default. */
  micDeviceId?: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Re-rendered once the video element exists so the chroma-key canvas (which
  // needs the actual DOM node, not just a ref) can mount against it.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    // Clear any failure left by the source we were showing before. Without
    // this the message from a dead source outlives it: an operator who picks a
    // camera another program already holds, then switches to one that works,
    // keeps staring at "Capture unavailable" on the projector until the app is
    // restarted, because nothing ever puts this back to null.
    setError(null);

    openSourceStream(sourceId, audioSource, micDeviceId)
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
  }, [sourceId, audioSource, micDeviceId]);

  if (error) {
    return (
      <div className="grid h-full w-full place-items-center bg-black p-6 text-center text-sm text-white/70">
        Capture unavailable - {error}
      </div>
    );
  }

  // A real LUT needs the canvas pass to apply it, exactly like chroma key -
  // and takes over from the CSS preset when it's the thing actually active,
  // rather than stacking a rough CSS approximation on top of a real one.
  const usesCanvas = !!chromaKey?.enabled || !!lutId;
  const cssFilter = lutId ? "" : colorFilterCss(colorFilter);

  return (
    <div className="relative h-full w-full">
      <video
        ref={(el) => {
          videoRef.current = el;
          if (el && el !== videoEl) setVideoEl(el);
        }}
        autoPlay
        playsInline
        muted={muted}
        className={`h-full w-full bg-black object-contain ${usesCanvas ? "invisible absolute inset-0" : ""}`}
        style={usesCanvas ? undefined : { filter: cssFilter }}
      />
      {usesCanvas && videoEl && (
        <div className="absolute inset-0" style={{ filter: cssFilter }}>
          <VideoFxCanvas video={videoEl} chromaKey={chromaKey} lutId={lutId} />
        </div>
      )}
    </div>
  );
}

/** Modal source picker - lists screens and windows with live thumbnails. */
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
        // works - so show cameras rather than refusing outright.
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
              className={`rounded-md border px-2.5 py-1.5 text-left text-[12px] transition-colors ${
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
              <h3 className="mb-2 flex items-center gap-1.5 text-[12px] uppercase tracking-wide text-[var(--v-text-faint)]">
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
                    <span className="block truncate px-2 py-1.5 text-[12px] text-[var(--v-text)]" title={s.name}>
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
