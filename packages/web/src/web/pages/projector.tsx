import { useEffect, useState } from "react";
import { LiveOutput } from "../components/live-output";
import { useFullscreen } from "../hooks/use-fullscreen";
import { getDesktopAPI } from "../lib/desktop";
import { screenFromLocation, MAIN_SCREEN } from "../lib/screens";

/**
 * Pure lyric output on a surface of its own. Three homes: the second-monitor
 * Electron window, a browser tab on a projector laptop, and - since the live
 * channel stopped depending on same-process delivery - a tablet or phone
 * anywhere on the internet, used as an extra screen.
 *
 * The picture itself is LiveOutput, shared with the operator's own full-screen
 * mode. This page adds only what belongs to being a separate window.
 */
export default function ProjectorPage() {
  // Read once: a projector window does not change which screen it is, and
  // re-reading on every render would make the value a new object each time.
  const [screenId] = useState(screenFromLocation);
  const fullscreen = useFullscreen();

  useEffect(() => {
    document.title = screenId === MAIN_SCREEN ? "Vifug Projector" : `Vifug Projector - ${screenId}`;
    document.body.style.overflow = "hidden";
  }, []);

  /**
   * Esc closes the projection. In the desktop app this closes the projector
   * window via the main process (which also notifies the operator and stops
   * NDI); in a browser it closes the popup window.
   *
   * Fullscreen comes first: the browser already consumes Esc to leave it, so
   * treating that same press as "shut the output down" would close the window
   * the operator was only trying to un-maximise.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") {
        void fullscreen.toggle();
        return;
      }
      if (e.key !== "Escape") return;
      if (fullscreen.active) return;
      e.preventDefault();
      const desktop = getDesktopAPI();
      if (desktop) {
        // dismissed: the operator shut the output off here, at the projector.
        // Without that the operator window's auto-open reopens it at once and
        // Esc looks like it does nothing.
        desktop.closeProjector({ dismissed: true }).catch(() => window.close());
      } else {
        window.close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // The projector IS the output, so it's the one instance that should actually
  // be heard when a capture carries audio.
  /* Only the main screen is audible: two screens both playing a capture's
     audio in the same building is feedback, not stereo. */
  return <LiveOutput playAudio={screenId === MAIN_SCREEN} screenId={screenId} />;
}
