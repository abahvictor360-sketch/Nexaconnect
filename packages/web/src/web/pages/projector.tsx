import { useCallback, useEffect, useRef, useState } from "react";
import { AnnouncementTicker } from "../components/announcement-ticker";
import { CaptureStage } from "../components/capture-stage";
import { useLiveState } from "../hooks/use-live";
import { useSettings } from "../hooks/use-settings";
import { useFullscreen } from "../hooks/use-fullscreen";
import { useWakeLock } from "../hooks/use-wake-lock";
import { getDesktopAPI } from "../lib/desktop";

/**
 * Pure lyric output. Three homes, not one: the second-monitor Electron window,
 * a browser tab on a projector laptop, and - since the live channel stopped
 * depending on same-process delivery - a tablet or phone anywhere on the
 * internet, used as an extra screen.
 *
 * That last case is what the controls below are for. A laptop has F11 and a
 * mouse to hide; a tablet has neither, and would otherwise show the words
 * inside browser chrome, on a screen that dims and sleeps mid-service.
 */
export default function ProjectorPage() {
  const state = useLiveState();
  // Polls (rather than a new push channel) so the announcement bar picks up
  // operator edits within a few seconds without extra plumbing.
  const settings = useSettings({ refetchInterval: 4000 }).data;
  const announcement = settings?.announcement;

  const fullscreen = useFullscreen();
  // The whole point of this surface is to be looked at, not touched.
  useWakeLock(true);

  // Controls are absent until asked for: a bar over the lyrics is exactly what
  // a projected output must never have. A tap (or any pointer movement on a
  // laptop) brings them back for a few seconds.
  const [controlsVisible, setControlsVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 4000);
  }, []);

  useEffect(() => {
    document.title = "Vifug Projector";
    document.body.style.overflow = "hidden";
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  // Hiding the cursor is right on a projector and wrong on a touch screen,
  // where there is no cursor to hide and the rule would only suppress the
  // pointer of anyone who plugs in a mouse to fix something.
  useEffect(() => {
    const touch = window.matchMedia("(hover: none)").matches;
    document.body.style.cursor = touch || controlsVisible ? "" : "none";
    return () => {
      document.body.style.cursor = "";
    };
  }, [controlsVisible]);

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

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "#000" }}
      onPointerDown={revealControls}
      onMouseMove={revealControls}
    >
      {/* The projector IS the output, so it's the one instance that should
          actually be heard when a capture carries audio. */}
      <CaptureStage state={state} playAudio micDeviceId={settings?.audio?.inputDeviceId ?? null} />
      {announcement?.enabled && (
        <AnnouncementTicker
          text={announcement.text}
          speed={announcement.speed}
          bgColor={announcement.bgColor}
          textColor={announcement.textColor}
        />
      )}

      <div
        aria-hidden={!controlsVisible}
        style={{
          position: "absolute",
          // Below the top edge rather than over it: on a tablet in fullscreen
          // the very top is where the swipe-to-exit gesture lives.
          top: "max(1rem, env(safe-area-inset-top))",
          right: "max(1rem, env(safe-area-inset-right))",
          display: "flex",
          gap: "0.5rem",
          opacity: controlsVisible ? 1 : 0,
          pointerEvents: controlsVisible ? "auto" : "none",
          // visibility, not just opacity: a transparent button is still in the
          // tab order and still focusable, so a keyboard user would otherwise
          // land on a control nobody can see. Delayed on the way out so the
          // fade still plays; instant on the way in.
          visibility: controlsVisible ? "visible" : "hidden",
          transition: controlsVisible
            ? "opacity 200ms ease"
            : "opacity 200ms ease, visibility 0s linear 200ms",
        }}
      >
        {fullscreen.supported ? (
          <button
            type="button"
            onClick={() => void fullscreen.toggle()}
            style={BUTTON}
            aria-label={fullscreen.active ? "Exit full screen" : "Enter full screen"}
          >
            {fullscreen.active ? "Exit full screen" : "Full screen"}
          </button>
        ) : (
          // iPhone Safari, and iPad before the API landed. Add to Home Screen
          // is the only route to a chrome-free output there, so say so instead
          // of offering a button that cannot work.
          <span style={{ ...BUTTON, cursor: "default" }}>
            Share → Add to Home Screen for full screen
          </span>
        )}
      </div>
    </div>
  );
}

const BUTTON: React.CSSProperties = {
  // Deliberately understated. It sits over live output and is visible for four
  // seconds at a time; it should read as an overlay, not as app furniture.
  background: "rgba(0,0,0,0.65)",
  color: "#fff",
  border: "1px solid rgba(255,255,255,0.25)",
  borderRadius: "0.6rem",
  // 44px tall: the minimum reliable touch target, and this gets tapped in a
  // dark room by someone who is also doing something else.
  minHeight: "44px",
  padding: "0 1rem",
  fontSize: "0.875rem",
  fontWeight: 600,
  cursor: "pointer",
  backdropFilter: "blur(6px)",
};
