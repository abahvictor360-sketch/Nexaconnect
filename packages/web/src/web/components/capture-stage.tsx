import { SlideRender } from "./slide-render";
import { CaptureView } from "./capture";
import type { LiveState, LiveCapture } from "../lib/live-bus";

/** Preacher/speaker nameplate, composited over any capture layout. */
function Nameplate({ nameplate, scale }: { nameplate: NonNullable<LiveCapture>["nameplate"]; scale?: boolean }) {
  if (!nameplate?.name) return null;
  const unit = scale ? "cqw" : "vw";
  return (
    <div
      style={{
        position: "absolute",
        left: "4%",
        bottom: "6%",
        maxWidth: "60%",
        background: "rgba(10,10,14,0.82)",
        borderLeft: "0.3em solid var(--v-accent, #f4c025)",
        padding: "0.55em 1em",
        borderRadius: "0.15em",
        color: "#ffffff",
        fontFamily: 'var(--font-lyric), "Archivo", system-ui, sans-serif',
        boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
      }}
    >
      <div style={{ fontSize: `clamp(0.75rem, 1.6${unit}, 2rem)`, fontWeight: 700, lineHeight: 1.15 }}>
        {nameplate.name}
      </div>
      {nameplate.title && (
        <div style={{ fontSize: `clamp(0.6rem, 1.05${unit}, 1.3rem)`, opacity: 0.8, marginTop: "0.2em" }}>
          {nameplate.title}
        </div>
      )}
    </div>
  );
}

/**
 * Composites live video and the current slide onto one output.
 *
 * The three layouts answer different room setups:
 *  - "full"    video takes the screen (a playback PC, a camera feed on its own)
 *  - "overlay" lyrics or scripture sit over the video. Either fills the whole
 *              frame ("fullscreen") or sits in a sized band at the bottom -
 *              the classic broadcast lower third, whose width/height and
 *              backdrop (color or image) the operator controls.
 *  - "pip"     video and text side by side so neither covers the other, for a
 *              portrait camera feed beside landscape scripture
 *
 * A preacher/speaker nameplate can be composited on top regardless of layout.
 */
export function CaptureStage({
  state,
  scale,
  isLiveOutput,
  playAudio = false,
  micDeviceId,
}: {
  state: LiveState;
  scale?: boolean;
  /** This is the actual on-air instance (the Live column), not a preview -
   * so its background video is the one the Audio Mixer's Media channel taps
   * for a level meter (see lib/audio-taps.ts). */
  isLiveOutput?: boolean;
  /**
   * Let this instance's capture audio actually be heard. Only the real output
   * (the projector) sets it: the operator's own preview and live thumbnails
   * render the same capture, and unmuting all of them would play the room's
   * sound two or three times over, out of phase.
   */
  playAudio?: boolean;
  /** Which mic to use when the capture's audioSource is "mic". */
  micDeviceId?: string | null;
}) {
  const capture = state.capture;
  if (!capture) return <SlideRender state={state} scale={scale} isLiveOutput={isLiveOutput} />;

  const layout = capture.layout ?? "full";
  const nameplate = <Nameplate nameplate={capture.nameplate} scale={scale} />;
  const audioSource = capture.audioSource ?? "none";
  const av = {
    colorFilter: capture.colorFilter,
    lutId: capture.lutId,
    chromaKey: capture.chromaKey,
    audioSource,
    micDeviceId,
    muted: !playAudio || audioSource === "none",
  };

  if (layout === "full") {
    return (
      <div style={{ position: "absolute", inset: 0 }}>
        <CaptureView sourceId={capture.sourceId} {...av} />
        {nameplate}
      </div>
    );
  }

  if (layout === "overlay") {
    const overlayMode = capture.overlayMode ?? "fullscreen";
    return (
      <div style={{ position: "absolute", inset: 0 }}>
        <CaptureView sourceId={capture.sourceId} {...av} />
        {overlayMode === "lower_third" ? (
          <LowerThirdBand capture={capture}>
            {/*
             * The band is its own sized box, not the viewport - so the slide
             * inside it always renders in container-relative (cqw/cqh) mode,
             * regardless of whether the OUTER stage itself is scaled (a
             * shrunk operator preview) or full-size (the real projector).
             */}
            <SlideRender
              state={{
                ...state,
                theme: {
                  ...state.theme,
                  displayMode: "fullscreen",
                  // No backdrop bar behind the words - so they need a heavy
                  // black shadow/outline of their own to read over live video,
                  // regardless of whatever outline the operator has set for
                  // ordinary slides.
                  ...(capture.overlayBgEnabled === false
                    ? {
                        textShadow: { color: "rgba(0,0,0,0.85)", blur: 14, x: 0, y: 3 },
                        textOutline: { color: "rgba(0,0,0,0.8)", width: 3 },
                      }
                    : {}),
                },
              }}
              transparent
              scale
              isLiveOutput={isLiveOutput}
              textPosition={{
                vertical: capture.overlayTextVerticalPos ?? "bottom",
                horizontal: capture.overlayTextAlign ?? "center",
              }}
            />
          </LowerThirdBand>
        ) : (
          // transparent: the video is the backdrop, so the slide must not paint
          // its own background over it.
          <div style={{ position: "absolute", inset: 0 }}>
            <SlideRender state={state} transparent scale={scale} isLiveOutput={isLiveOutput} />
          </div>
        )}
        {nameplate}
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
        <CaptureView sourceId={capture.sourceId} {...av} />
      </div>
      <div style={{ width: textPct, height: "100%", position: "relative" }}>
        <SlideRender state={state} scale={scale} isLiveOutput={isLiveOutput} />
      </div>
      {nameplate}
    </div>
  );
}

/**
 * The sized band a lower third renders inside, instead of the full frame.
 * `containerType: size` (mirroring SlideRender's own `scale` convention) lets
 * the slide's auto-fit font math measure against THIS box rather than the
 * viewport, so text fills a short band the same way it fills a tall one.
 */
function LowerThirdBand({
  capture,
  children,
}: {
  capture: NonNullable<LiveCapture>;
  children: React.ReactNode;
}) {
  const heightPct = Math.min(100, Math.max(10, capture.overlayHeightPct ?? 32));
  const widthPct = Math.min(100, Math.max(20, capture.overlayWidthPct ?? 100));
  const bgImage = capture.overlayBgImage;
  const bgEnabled = capture.overlayBgEnabled ?? true;

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 0,
        transform: "translateX(-50%)",
        width: `${widthPct}%`,
        height: `${heightPct}%`,
        overflow: "hidden",
        background: !bgEnabled
          ? "transparent"
          : bgImage
            ? `center / cover no-repeat url(${bgImage})`
            : (capture.overlayBgColor ?? "#0a0a0c"),
        containerType: "size",
      }}
    >
      {children}
    </div>
  );
}
