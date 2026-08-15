import { useEffect, useState } from "react";
import { SlideRender } from "../components/slide-render";
import { AnnouncementTicker } from "../components/announcement-ticker";
import { useSettings } from "../hooks/use-settings";
import { IDLE_STATE, DEFAULT_THEME, type LiveState } from "../lib/live-bus";

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
  const [cw, ch] = parseCanvas(settings?.stream?.canvas);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });

  // The overlay is laid out at a fixed canvas size and scaled to whatever the
  // browser source happens to be. Without this, a lower third sits at a
  // different height and text renders at a different size depending on the
  // source's dimensions - so a scene built at 1080p breaks when the source is
  // resized. Scaling a fixed canvas keeps the composition identical.
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const scale = Math.min(viewport.w / cw, viewport.h / ch);

  useEffect(() => {
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";

    let es: EventSource | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      es = new EventSource("/api/live/stream");
      es.addEventListener("live", (e) => {
        try {
          const raw = JSON.parse((e as MessageEvent).data) as Partial<LiveState>;
          setState({
            ...IDLE_STATE,
            ...raw,
            theme: { ...DEFAULT_THEME, ...(raw.theme ?? {}) },
          } as LiveState);
        } catch {
          /* ignore malformed frame */
        }
      });
      es.onerror = () => {
        es?.close();
        if (!stopped) setTimeout(connect, 1500); // auto-reconnect
      };
    };
    connect();

    return () => {
      stopped = true;
      es?.close();
    };
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
        style={{
          width: cw,
          height: ch,
          position: "relative",
          transform: `scale(${scale})`,
          transformOrigin: "center",
          flex: "none",
        }}
      >
        <SlideRender state={state} transparent />
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
