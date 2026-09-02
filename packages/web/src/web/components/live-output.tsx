import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnnouncementTicker } from "./announcement-ticker";
import { TimerOverlay } from "./timer-overlay";
import { CaptureStage } from "./capture-stage";
import { useLiveState } from "../hooks/use-live";
import { useSettings } from "../hooks/use-settings";
import { useFullscreen } from "../hooks/use-fullscreen";
import { useWakeLock } from "../hooks/use-wake-lock";
import { canvasScale, parseOutputCanvas } from "../lib/output-canvas";

/**
 * The live output itself: words, background, announcement bar, nothing else.
 *
 * Shared by the /#/projector surface and the operator's own "Full screen on
 * this device", which are the same picture reached two ways - one on a screen
 * of its own, one over the operator UI on whatever they are holding. Keeping
 * it in one component is the point: a projector that renders the announcement
 * bar and a full-screen output that forgets to is the kind of difference
 * nobody notices until it is in front of a room.
 */
export function LiveOutput({
  playAudio = false,
  onExit,
  exitLabel = "Exit",
}: {
  /** Only one surface should be audible; the caller decides which. */
  playAudio?: boolean;
  /** Shown as a second control when the output can be dismissed. */
  onExit?: () => void;
  exitLabel?: string;
}) {
  const state = useLiveState();
  // Polls (rather than a new push channel) so the announcement bar picks up
  // operator edits within a few seconds without extra plumbing.
  const settings = useSettings({ refetchInterval: 4000 }).data;
  const announcement = settings?.announcement;

  /*
   * Fixed-canvas layout (Settings > General > Projector output).
   *
   * This lived on the projector page, which meant the operator's own "full
   * screen on this device" laid out against the viewport while the projector
   * laid out against a 1920x1080 canvas - the same service looking different
   * on the two surfaces that are supposed to be the same picture. It belongs
   * here for the same reason the announcement bar does.
   *
   * Memoised on the setting's text: a fresh object each render would tear down
   * and rebuild the observer below on every settings poll.
   */
  const canvas = useMemo(() => parseOutputCanvas(settings?.output?.resolution), [settings?.output?.resolution]);
  const frameRef = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));

  useEffect(() => {
    const el = frameRef.current;
    if (!el || !canvas) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const width = r.width || window.innerWidth;
      const height = r.height || window.innerHeight;
      setScreen((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    // Both, because neither alone is dependable: a window resize is not always
    // what changed the box, and a ResizeObserver callback is delivered during
    // the rendering steps, so a window that is not compositing - hidden,
    // occluded, still off-screen before being moved to the projector - can go
    // without one for as long as it stays that way.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [canvas]);

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

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
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

  /*
   * Everything the congregation sees. Kept as one node so that, with a fixed
   * canvas set, it can be scaled as a single picture - the words, the timer, a
   * nameplate over a camera feed and the announcement bar move together and
   * keep their proportions, instead of each sizing itself against the screen.
   */
  const picture = (
    <>
      <CaptureStage state={state} scale={!!canvas} playAudio={playAudio} micDeviceId={settings?.audio?.inputDeviceId ?? null} />
      <TimerOverlay timer={settings?.timer} screen="live" />
      {announcement?.enabled && (
        <AnnouncementTicker
          text={announcement.text}
          speed={announcement.speed}
          bgColor={announcement.bgColor}
          textColor={announcement.textColor}
        />
      )}
    </>
  );

  return (
    <div
      ref={frameRef}
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        zIndex: 60,
        overflow: "hidden",
        ...(canvas ? { display: "grid", placeItems: "center" } : null),
      }}
      onPointerDown={revealControls}
      onMouseMove={revealControls}
    >
      {canvas ? (
        <div
          style={{
            position: "relative",
            width: canvas.width,
            height: canvas.height,
            overflow: "hidden",
            transform: `scale(${canvasScale(canvas, screen)})`,
            transformOrigin: "center",
          }}
        >
          {picture}
        </div>
      ) : (
        picture
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
        {onExit && (
          <button type="button" onClick={onExit} style={BUTTON} aria-label={exitLabel}>
            {exitLabel}
          </button>
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
