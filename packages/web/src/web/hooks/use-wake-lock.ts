import { useEffect } from "react";

/**
 * Hold the screen awake while a surface is showing live output.
 *
 * A tablet used as a second screen will dim and sleep partway through a
 * service on its own idle timer - it has no idea a page rendering the words
 * for a room full of people is any different from an article nobody is
 * touching. Nothing about the live view involves input, so the idle timer is
 * exactly wrong here.
 *
 * The lock is dropped by the browser whenever the tab is hidden and is NOT
 * restored on return, so it is re-acquired on visibilitychange; without that,
 * one glance at another app silently ends it for the rest of the service.
 *
 * Unsupported browsers (Safari before 16.4, most embedded webviews) simply get
 * nothing - there is no polyfill worth the tricks people use, and a silently
 * absent lock is better than a hidden looping video.
 */
type WakeLockSentinel = { release: () => Promise<void>; released: boolean };
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
};

export function useWakeLock(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
    if (!wakeLock) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        sentinel = await wakeLock.request("screen");
      } catch {
        // Refused (battery saver, no gesture yet). Retried on the next
        // visibility change rather than in a loop that would never win.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && (!sentinel || sentinel.released)) void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => {});
    };
  }, [enabled]);
}
