import { useCallback, useEffect, useState } from "react";

/**
 * Fullscreen for the live output, on whatever the browser actually supports.
 *
 * A projector on a laptop has F11. A tablet has nothing - no keyboard, and the
 * Fullscreen API cannot be entered without a user gesture - so the output needs
 * a control the operator can tap, and something honest to say on the platforms
 * that refuse. iPhone Safari has never implemented the API for anything but
 * <video>, and iPad Safari only gained it recently, so `supported` is reported
 * rather than assumed: the caller shows "Add to Home Screen" instead of a
 * button that would do nothing.
 */

type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type FsDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
};

function fullscreenElement(): Element | null {
  const d = document as FsDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

export function useFullscreen() {
  const [active, setActive] = useState(() => fullscreenElement() !== null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const d = document as FsDocument;
    const el = document.documentElement as FsElement;
    setSupported(!!(d.fullscreenEnabled || d.webkitFullscreenEnabled || el.webkitRequestFullscreen));

    // Both events: the browser also fires these when the user leaves fullscreen
    // by swiping or pressing Esc, and a button still reading "Exit" after that
    // is worse than no button.
    const sync = () => setActive(fullscreenElement() !== null);
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  const enter = useCallback(async () => {
    const el = document.documentElement as FsElement;
    try {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    } catch {
      // Refused (no gesture, or an iframe without allowfullscreen). The page is
      // already fixed/inset, so the output still fills what viewport there is.
    }
  }, []);

  const exit = useCallback(async () => {
    const d = document as FsDocument;
    try {
      if (fullscreenElement() === null) return;
      if (d.exitFullscreen) await d.exitFullscreen();
      else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
    } catch {
      /* already out */
    }
  }, []);

  const toggle = useCallback(() => (fullscreenElement() ? exit() : enter()), [enter, exit]);

  return { active, supported, enter, exit, toggle };
}
