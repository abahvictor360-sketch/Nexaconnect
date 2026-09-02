import { useEffect, useState } from "react";

/**
 * How far this device's clock is from the server's, in ms.
 *
 * The service timer is anchored to an absolute instant. A stage laptop whose
 * clock is two minutes fast would otherwise count down two minutes early - and
 * a wrong timer is worse than no timer, because nobody doubts it until the
 * service has already run over.
 *
 * Measured once on mount and re-checked occasionally. Half the round trip is
 * subtracted so the reading is not skewed by the request itself. If the call
 * fails the offset stays 0, which is exactly the old behaviour: trust the
 * local clock.
 */
export function useServerSkew(): number {
  const [skew, setSkew] = useState(0);

  useEffect(() => {
    let alive = true;

    const measure = async () => {
      const sentAt = Date.now();
      try {
        const r = await fetch("/api/time", { cache: "no-store" });
        if (!r.ok) return;
        const { now } = (await r.json()) as { now: number };
        const rtt = Date.now() - sentAt;
        if (alive) setSkew(now + rtt / 2 - Date.now());
      } catch {
        // Offline or blocked - the local clock is the best available answer.
      }
    };

    void measure();
    const t = setInterval(measure, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return skew;
}

/** Server-corrected `Date.now()`, re-rendering once a second. */
export function useServerNow(active: boolean): number {
  const skew = useServerSkew();
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return tick + skew;
}
