import { useEffect, useState } from "react";
import { SlideRender } from "../components/slide-render";
import { AnnouncementTicker } from "../components/announcement-ticker";
import { TimerOverlay } from "../components/timer-overlay";
import { useSettings } from "../hooks/use-settings";
import { usePublishAudioOutput } from "../hooks/use-audio-output";
import { IDLE_STATE, DEFAULT_THEME, type LiveState } from "../lib/live-bus";
import { subscribeSnapshot } from "../lib/realtime";

/**
 * Browser-source / streaming output.
 *
 * Runs in a separate process (OBS, vMix, a streaming PC, or an NDI bridge like
 * OBS + the DistroAV/NDI plugin), so it CANNOT use BroadcastChannel. Instead it
 * subscribes to the server's Server-Sent-Events feed at /api/live/stream and
 * renders with a transparent backdrop so it composites cleanly over video.
 *
 * Add as an OBS "Browser" source pointing at:  <app-url>/#/stream
 */
/** "1920x1080" -> [1920, 1080]; anything unparseable falls back to 1080p. */
function parseCanvas(canvas: string | undefined): [number, number] {
  const m = /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/i.exec((canvas ?? "").trim());
  if (!m) return [1920, 1080];
  return [Number(m[1]), Number(m[2])];
}

export default function StreamPage() {
  const [state, setState] = useState<LiveState>(IDLE_STATE);
  const settings = useSettings({ refetchInterval: 4000 }).data;
  const announcement = settings?.announcement;
  usePublishAudioOutput(settings?.audio?.outputDeviceId, settings?.audio?.outputMuted);
  const [cw, ch] = parseCanvas(settings?.stream?.canvas);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  /**
   * "fill" (the default) uses the browser source's own size as the canvas, so
   * the overlay always fills exactly the source OBS created - whatever size
   * that is. Everything is laid out in vw/vh/%, so the composition stays
   * proportionally identical; only an explicit pixel font size would differ.
   *
   * "canvas" is the old behaviour: lay out at a fixed size and letterbox it to
   * fit. That keeps a px-perfect composition across differently-sized
   * sources, but it also means a source whose aspect ratio doesn't match the
   * canvas gets transparent bars - and since OBS creates browser sources at
   * 800x600 by default, the usual first experience was a 16:9 overlay sitting
   * letterboxed inside a 4:3 source, looking far too small.
   */
  const fitMode = settings?.stream?.fitMode ?? "fill";

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const scale = Math.min(viewport.w / cw, viewport.h / ch);

  useEffect(() => {
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";

    return subscribeSnapshot("live", (frame) => {
      const raw = frame as Partial<LiveState>;
      setState({
        ...IDLE_STATE,
        ...raw,
        theme: { ...DEFAULT_THEME, ...(raw.theme ?? {}) },
      } as LiveState);
    });
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "transparent",
        overflow: "hidden",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        style={
          fitMode === "canvas"
            ? {
                width: cw,
                height: ch,
                position: "relative",
                transform: `scale(${scale})`,
                transformOrigin: "center",
                flex: "none",
              }
            : { width: "100%", height: "100%", position: "relative" }
        }
      >
        {/* A browser source is an output of its own - OBS captures whatever
            it plays, so a video cued with sound has to actually make it. */}
        <SlideRender state={state} transparent playAudio />
        <TimerOverlay timer={settings?.timer} screen="stream" />
        {announcement?.enabled && (
          <AnnouncementTicker
            text={announcement.text}
            speed={announcement.speed}
            bgColor={announcement.bgColor}
            textColor={announcement.textColor}
          />
        )}
      </div>
    </div>
  );
}
