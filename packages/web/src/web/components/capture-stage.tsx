import { SlideRender } from "./slide-render";
import { CaptureView } from "./capture";
import type { LiveState } from "../lib/live-bus";

/**
 * Composites live video and the current slide onto one output.
 *
 * The three layouts answer different room setups:
 *  - "full"    video takes the screen (a playback PC, a camera feed on its own)
 *  - "overlay" lyrics or scripture sit over the video - the lower-third case,
 *              which relies on the theme's own displayMode/verticalPos rather
 *              than imposing a second, competing idea of where text goes
 *  - "pip"     video and text side by side so neither covers the other, for a
 *              portrait camera feed beside landscape scripture
 */
export function CaptureStage({ state }: { state: LiveState }) {
  const capture = state.capture;
  if (!capture) return <SlideRender state={state} />;

  const layout = capture.layout ?? "full";

  if (layout === "full") {
    return <CaptureView sourceId={capture.sourceId} />;
  }

  if (layout === "overlay") {
    return (
      <div style={{ position: "absolute", inset: 0 }}>
        <CaptureView sourceId={capture.sourceId} />
        {/* transparent: the video is the backdrop, so the slide must not paint
            its own background over it. */}
        <div style={{ position: "absolute", inset: 0 }}>
          <SlideRender state={state} transparent />
        </div>
      </div>
    );
  }

  // pip - split the frame. Video keeps its aspect (object-contain) so a
  // portrait camera feed isn't stretched to fill a landscape half.
  const videoWidth = Math.min(0.8, Math.max(0.2, capture.pipVideoWidth ?? 0.5));
  const videoFirst = (capture.pipVideoSide ?? "left") === "left";
  const videoPct = `${videoWidth * 100}%`;
  const textPct = `${(1 - videoWidth) * 100}%`;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: videoFirst ? "row" : "row-reverse",
      }}
    >
      <div style={{ width: videoPct, height: "100%", position: "relative", background: "#000" }}>
        <CaptureView sourceId={capture.sourceId} />
      </div>
      <div style={{ width: textPct, height: "100%", position: "relative" }}>
        <SlideRender state={state} />
      </div>
    </div>
  );
}
