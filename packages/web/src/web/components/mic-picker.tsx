import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";

export type MicDevice = { deviceId: string; label: string };

/**
 * Microphone chooser with a live level meter.
 *
 * The meter is the point of this panel. Auto-Follow's usual failure isn't a
 * bad transcript — it's the browser picking a system-default input (often a
 * webcam mic facing away from the room) and hearing nothing, which looks
 * identical to "the AI isn't working". Seeing the bar move before the service
 * turns that into a five-second check.
 */
export function MicPicker({
  deviceId,
  onChange,
}: {
  deviceId: string | null;
  onChange: (device: MicDevice | null) => void;
}) {
  const [devices, setDevices] = useState<MicDevice[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  // Device labels are blank until the user has granted mic permission at least
  // once, so a bare enumerate would show "Microphone 1, Microphone 2". Ask for
  // access first, then enumerate, then drop the probe stream immediately.
  const loadDevices = useCallback(async () => {
    setError(null);
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        all
          .filter((d) => d.kind === "audioinput")
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` })),
      );
    } catch {
      setError("Microphone access was blocked. Allow it, then try again.");
      setDevices([]);
    }
  }, []);

  const stopTest = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
    setTesting(false);
    setLevel(0);
  }, []);

  const startTest = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { ideal: deviceId } } : true,
      });
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      setTesting(true);

      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        // Peak deviation from silence (128) — responds to speech far more
        // legibly than an RMS average, which barely moves at speaking volume.
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 96));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      // Permission denial and a busy/missing device need different fixes, and
      // "it's in use by another app" sends people hunting for the wrong thing
      // when the real answer is a blocked permission prompt.
      const name = e instanceof DOMException ? e.name : "";
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone access was blocked. Allow it for this app, then try again."
          : name === "NotFoundError"
            ? "No microphone found. Check it’s plugged in and enabled in system settings."
            : "Could not open that microphone. It may be in use by another app.",
      );
      setTesting(false);
    }
  }, [deviceId]);

  // Never leave the mic hot — an abandoned stream keeps the OS recording
  // indicator lit and holds an exclusive handle some drivers won't share.
  useEffect(() => stopTest, [stopTest]);

  return (
    <div>
      <div className="flex items-center gap-2">
        <select
          value={deviceId ?? ""}
          onFocus={() => devices === null && loadDevices()}
          onChange={(e) => {
            const id = e.target.value;
            const dev = devices?.find((d) => d.deviceId === id);
            onChange(id ? { deviceId: id, label: dev?.label ?? "Microphone" } : null);
            if (testing) stopTest();
          }}
          className="min-w-0 flex-1 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2 py-1.5 text-xs outline-none focus:border-[var(--v-accent)]"
        >
          <option value="">System default microphone</option>
          {devices?.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => (testing ? stopTest() : startTest())}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--v-border)] px-2.5 py-1.5 text-[11px] hover:bg-[var(--v-surface)]"
        >
          {testing ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          {testing ? "Stop" : "Test"}
        </button>
        {devices === null && (
          <button
            onClick={loadDevices}
            className="shrink-0 rounded-md border border-[var(--v-border)] px-2 py-1.5 text-[11px] hover:bg-[var(--v-surface)]"
            title="Show microphone names (asks for permission)"
          >
            <Loader2 className="hidden h-3.5 w-3.5" />
            List mics
          </button>
        )}
      </div>

      {testing && (
        <div className="mt-2">
          <div className="h-2 overflow-hidden rounded-full bg-[var(--v-surface-3)]">
            <div
              className="h-full rounded-full transition-[width] duration-75"
              style={{
                width: `${Math.round(level * 100)}%`,
                background: level > 0.85 ? "#ef4444" : "var(--v-accent)",
              }}
            />
          </div>
          <p className="mt-1 text-[11px] text-[var(--v-text-faint)]">
            {level < 0.04
              ? "No sound yet — speak toward the mic."
              : level > 0.85
                ? "Very loud — the mic may clip."
                : "Hearing you."}
          </p>
        </div>
      )}

      {error && <p className="mt-1.5 text-[11px] text-amber-500">{error}</p>}
    </div>
  );
}
