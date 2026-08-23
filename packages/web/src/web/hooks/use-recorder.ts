import { useCallback, useEffect, useRef, useState } from "react";
import { getDesktopAPI } from "../lib/desktop";

/**
 * Records the live output to a video file.
 *
 * What gets recorded is the PROJECTOR WINDOW, not the operator's screen or
 * the preview thumbnail: it is the one surface that shows exactly what the
 * congregation sees, at its real resolution, with no operator UI in frame.
 * If no projector is open, the main process stands up an offscreen 1080p
 * copy of the output for the duration of the recording, so recording only
 * needs something to be live - not a second screen.
 *
 * Frames are written straight to disk through the embedded server when the
 * recording stops. Keeping the whole thing in memory until then is fine for
 * a service-length recording and avoids a streaming-upload path that could
 * fail halfway and leave an unplayable file.
 */

export type RecorderStatus = "idle" | "recording" | "saving" | "error";

/** Title given to the projector BrowserWindow in the desktop app's main process. */
const PROJECTOR_WINDOW_TITLE = "Vifug Projector";

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export function useRecorder() {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [savedTo, setSavedTo] = useState<{ name: string; folder: string } | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  /** Whether this recording created its own offscreen surface to capture. */
  const temporarySurfaceRef = useRef(false);

  const cleanup = useCallback(() => {
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
    // Only tear down a surface this recording created - never the operator's
    // own projector, which must survive the recording ending.
    if (temporarySurfaceRef.current) {
      void getDesktopAPI()?.recorderRelease?.();
      temporarySurfaceRef.current = false;
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setSavedTo(null);
    const desktop = getDesktopAPI();
    if (!desktop?.listCaptureSources) {
      setStatus("error");
      setError("Recording needs the desktop app.");
      return;
    }
    try {
      // Ask for a surface rather than requiring one: if no projector is open,
      // the main process stands up an offscreen 1080p copy of the output for
      // the duration of the recording.
      const surface = desktop.recorderSurface
        ? await desktop.recorderSurface()
        : { title: PROJECTOR_WINDOW_TITLE, temporary: false };
      temporarySurfaceRef.current = surface.temporary;

      const sources = await desktop.listCaptureSources();
      const target = sources.find((s) => s.kind === "window" && s.name === surface.title);
      if (!target) {
        setStatus("error");
        setError("Could not find the live output to record.");
        if (surface.temporary) void desktop.recorderRelease?.();
        temporarySurfaceRef.current = false;
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: target.id,
            maxWidth: 1920,
            maxHeight: 1080,
            maxFrameRate: 30,
          },
        } as unknown as MediaTrackConstraints,
      });
      streamRef.current = stream;

      // VP9 where it exists, VP8 as the fallback - both are always available
      // in Electron's Chromium, so an unsupported-type failure can't strand a
      // recording that has already started.
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const rec = new MediaRecorder(stream, { mimeType });
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        cleanup();
        setStatus("saving");
        try {
          const blob = new Blob(chunksRef.current, { type: "video/webm" });
          chunksRef.current = [];
          const fd = new FormData();
          fd.append("file", blob, "recording.webm");
          fd.append("name", `Vifug_${stamp()}.webm`);
          const res = await fetch("/api/recordings/save", { method: "POST", body: fd });
          const data = (await res.json()) as { name?: string; folder?: string; error?: string };
          if (!res.ok) throw new Error(data.error || "could not save the recording");
          setSavedTo({ name: data.name ?? "recording.webm", folder: data.folder ?? "" });
          setStatus("idle");
        } catch (e) {
          setStatus("error");
          setError(e instanceof Error ? e.message : "Could not save the recording.");
        }
      };
      // A timeslice means chunks arrive as it goes, so a crash mid-service
      // still leaves most of the recording recoverable rather than nothing.
      rec.start(2000);
      setSeconds(0);
      setStatus("recording");
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (e) {
      cleanup();
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not start recording.");
    }
  }, [cleanup]);

  const stop = useCallback(() => {
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    else {
      cleanup();
      setStatus("idle");
    }
  }, [cleanup]);

  const toggle = useCallback(() => {
    if (status === "recording") stop();
    else if (status !== "saving") void start();
  }, [status, start, stop]);

  // Never leave a recording running (or the OS capture indicator lit) if the
  // operator screen goes away mid-recording.
  useEffect(() => cleanup, [cleanup]);

  return { status, error, seconds, savedTo, start, stop, toggle, dismissSaved: () => setSavedTo(null) };
}
