import { useEffect, useRef, useState } from "react";
import { getOrCreateAnalyser, subscribeLiveMediaVideo } from "../lib/audio-taps";

/**
 * Live level for whatever video is currently registered as "on air" (see
 * lib/audio-taps.ts). Same peak-deviation approach as the microphone meter,
 * just fed by an AnalyserNode tapped off the video element instead of a mic
 * stream.
 */
export function useMediaLevel() {
  const [level, setLevel] = useState(0);
  const [active, setActive] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const unsub = subscribeLiveMediaVideo((el) => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setLevel(0);

      if (!el) {
        setActive(false);
        return;
      }
      const analyser = getOrCreateAnalyser(el);
      if (!analyser) {
        setActive(false);
        return;
      }
      setActive(true);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 96));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    });
    return () => {
      unsub();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { level, active };
}
