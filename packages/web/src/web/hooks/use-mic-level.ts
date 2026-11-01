import { useEffect, useRef, useState } from "react";
import {
  isMicLevelFresh, micHasPublisher, peakLevel, publishMicLevel, subscribeMicLevel,
} from "../lib/audio-taps";

/** Live microphone level, from whoever currently has the mic open. */
export function useMicLevel() {
  const [level, setLevel] = useState(0);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const unsub = subscribeMicLevel((next) => {
      if (next === null) {
        setActive(false);
        setLevel(0);
        return;
      }
      setActive(true);
      setLevel(next);
    });
    // Nothing announces "I stopped" when a window is closed rather than
    // cleaned up, so staleness is checked here as well.
    const watchdog = setInterval(() => {
      if (!isMicLevelFresh()) {
        setActive(false);
        setLevel(0);
      }
    }, 500);
    return () => {
      unsub();
      clearInterval(watchdog);
    };
  }, []);

  return { level, active };
}

/**
 * Hold the microphone open and report what it hears.
 *
 * Deliberately conditional. An abandoned stream keeps the operating system's
 * recording light on and takes an exclusive handle that some drivers will
 * not share, so the mic is opened only while the meter is being looked at
 * and let go the moment it is not - scrolled out of the rail, window hidden,
 * channel muted, panel unmounted.
 *
 * It also stands aside when something else is already listening and
 * reporting, which is the normal case during a service: Auto-Follow has the
 * mic and publishes its own levels, and opening the device a second time
 * would light a second indicator for a number already on its way.
 */
export function useMicMonitor(opts: {
  enabled: boolean;
  deviceId?: string | null;
  noiseSuppression?: boolean;
}) {
  const { enabled, deviceId, noiseSuppression } = opts;
  const mine = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = async () => {
      // Somebody else is already on it - take their numbers, not the device.
      if (micHasPublisher()) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { ...(deviceId ? { deviceId: { ideal: deviceId } } : {}), noiseSuppression: noiseSuppression ?? true },
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        // Not connected to the destination: monitoring the room mic through
        // the room speakers is feedback, not a feature.
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        mine.current = true;
        timer = setInterval(() => publishMicLevel(peakLevel(analyser, buf)), 80);
      } catch {
        // Blocked, missing or busy. The Test button in the picker explains
        // which; a meter that stays still is the right amount of noise here.
      }
    };
    void start();

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => {});
      if (mine.current) {
        mine.current = false;
        publishMicLevel(null);
      }
    };
  }, [enabled, deviceId, noiseSuppression]);
}
