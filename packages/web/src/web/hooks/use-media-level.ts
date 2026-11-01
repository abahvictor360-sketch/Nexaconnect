import { useEffect, useState } from "react";
import { isFresh, subscribeMediaLevel } from "../lib/audio-taps";

/**
 * Live level for whatever video is currently on air.
 *
 * The measuring happens on the surface that actually has the sound - the
 * projector window, usually, not this one - and arrives here as a number
 * (see lib/audio-taps.ts). A level that stops arriving goes quiet on its
 * own, so closing the projector mid-clip puts the meter down rather than
 * freezing it at whatever it last read.
 */
export function useMediaLevel() {
  const [level, setLevel] = useState(0);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const unsub = subscribeMediaLevel((next) => {
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
      if (!isFresh()) {
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
