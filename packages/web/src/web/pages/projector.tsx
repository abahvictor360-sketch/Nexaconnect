import { useEffect, useMemo, useRef, useState } from "react";
import { AnnouncementTicker } from "../components/announcement-ticker";
import { CaptureStage } from "../components/capture-stage";
import { useLiveState } from "../hooks/use-live";
import { useSettings } from "../hooks/use-settings";
import { getDesktopAPI } from "../lib/desktop";
import { canvasScale, parseOutputCanvas } from "../lib/output-canvas";

/** Pure lyric output. Loaded in the second-monitor Electron window (or a browser tab). */
export default function ProjectorPage() {
  const state = useLiveState();
  // Polls (rather than a new push channel) so the announcement bar picks up
  // operator edits within a few seconds without extra plumbing.
  const settings = useSettings({ refetchInterval: 4000 }).data;
  const announcement = settings?.announcement;
  // Memoised on the setting's text: a fresh object each render would tear down
  // and rebuild the ResizeObserver below on every settings poll.
  const resolution = settings?.output?.resolution;
  const canvas = useMemo(() => parseOutputCanvas(resolution), [resolution]);

  /*
   * The space the output has, so the canvas can be scaled to it.
   *
   * Measured with a ResizeObserver on the element itself rather than from
   * window resize events. The projector window is created hidden, then moved
   * onto the target display and fullscreened, so its size at first paint is
   * not the size it ends up - and the observer reports the box actually being
   * scaled whatever caused it to change, including cases that never fire a
   * window resize at all.
   */
  const frameRef = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
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

  useEffect(() => {
    document.title = "Vifug Projector";
    document.body.style.cursor = "none";
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.cursor = "";
    };
  }, []);

  // Esc closes the projection. In the desktop app this closes the projector
  // window via the main process (which also notifies the operator and stops
  // NDI); in a browser it closes the popup window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
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
  }, []);

  /* The projector IS the output, so it's the one instance that should actually
     be heard when a capture carries audio. */
  const output = (
    <>
      <CaptureStage
        state={state}
        scale={!!canvas}
        playAudio
        micDeviceId={settings?.audio?.inputDeviceId ?? null}
      />
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

  if (!canvas) {
    return <div style={{ position: "fixed", inset: 0, background: "#000" }}>{output}</div>;
  }

  /*
   * Laid out at the canvas size, then scaled as one picture to the screen.
   *
   * The scale is on a wrapper of exactly canvas size rather than on the output
   * itself so everything inside - text, margins, the announcement bar, a
   * nameplate over a camera feed - moves together and keeps its proportions.
   * CaptureStage gets `scale` so its children size against this box via
   * container queries instead of the viewport, which is what makes the layout
   * the canvas's rather than the screen's.
   */
  return (
    <div
      ref={frameRef}
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        overflow: "hidden",
        display: "grid",
        placeItems: "center",
      }}
    >
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
        {output}
      </div>
    </div>
  );
}
