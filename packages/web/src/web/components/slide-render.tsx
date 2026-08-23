import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LiveState, LiveTheme } from "../lib/live-bus";
import { runStyle } from "../lib/rich-text";
import { registerLiveMediaVideo } from "../lib/audio-taps";
import { colorFilterCss } from "../lib/color-filters";

/**
 * The ONE render engine. Produces the lyric slide from live state + theme.
 * Reused by the projector window and the operator preview (scaled down).
 */

// Measure the widest line in em units (width at 100px font / 100) using the
// real font, so fullscreen auto-fit can fill the width precisely instead of
// guessing an average glyph width.
let _measureCanvas: HTMLCanvasElement | null = null;
function longestLineEm(lines: string[], font: string): number {
  if (typeof document === "undefined" || lines.length === 0) return 0;
  _measureCanvas ??= document.createElement("canvas");
  const ctx = _measureCanvas.getContext("2d");
  if (!ctx) return Math.max(...lines.map((l) => l.length)) * 0.56;
  ctx.font = font;
  let max = 0;
  for (const l of lines) max = Math.max(max, ctx.measureText(l).width);
  return max / 100;
}

// Combined text effects: the outline glow and the optional drop shadow are both
// CSS text-shadows, layered into one comma-separated value.
function outlineStyle(t: LiveTheme): React.CSSProperties {
  const parts: string[] = [];
  if (t.textOutline && t.textOutline.width) {
    const w = t.textOutline.width;
    const c = t.textOutline.color;
    parts.push(`0 0 ${w}px ${c}`, `${w}px ${w}px ${w}px ${c}`, `-${w}px -${w}px ${w}px ${c}`);
  }
  if (t.textShadow) {
    const { x, y, blur, color } = t.textShadow;
    parts.push(`${x}px ${y}px ${blur}px ${color}`);
  }
  return parts.length ? { textShadow: parts.join(", ") } : {};
}

export function SlideRender({
  state,
  scale = false,
  transparent = false,
  textPosition,
  isLiveOutput = false,
}: {
  state: LiveState;
  scale?: boolean;
  /** Stream / browser-source mode: no solid backdrop, media still shows. */
  transparent?: boolean;
  /**
   * Where the text sits in its box, overriding the theme's own
   * verticalPos/textAlign - for a render that lives in its OWN sized box (the
   * capture lower-third band) rather than the theme's fullscreen/lower-third
   * convention, so placement is a property of that box, not of the theme.
   */
  textPosition?: { vertical: "top" | "center" | "bottom"; horizontal: "left" | "center" | "right" };
  /** This instance is the actual on-air Live column, not a preview - its
   * background video (if any) is registered for the Audio Mixer's Media
   * channel meter (see lib/audio-taps.ts). */
  isLiveOutput?: boolean;
}) {
  const t = state.theme;
  const isLowerThird = t.displayMode !== "fullscreen";
  const media = state.status === "blank" ? null : t.background;
  const showMediaColor = media?.type === "color";
  const bg =
    state.status === "blank"
      ? "#000000"
      : transparent || isLowerThird
        ? "transparent"
        : showMediaColor
          ? media!.url
          : media && (media.type === "image" || media.type === "video")
            ? "transparent"
            : t.bgColor;

  const showText = state.status === "live" && state.sourceLines.length > 0;

  // Auto-fit font sizing based on line count/length when fontSize is null.
  const lineCount = state.sourceLines.length + (state.translationLines.length ? state.translationLines.length : 0);
  const longest = Math.max(1, ...state.sourceLines.map((l) => l.length), ...state.translationLines.map((l) => l.length));
  // Use container-query units (cqw/cqh) when rendered as a scaled preview so
  // the font sizes relative to the small box, not the whole viewport. The full
  // projector uses viewport units (vw/vh).
  let fontSize: string;
  if (t.fontSize) {
    fontSize = scale ? `${t.fontSize * 0.28}cqw` : `${t.fontSize}px`;
  } else if (!isLowerThird) {
    // Fullscreen: FILL the display. A long verse must WRAP, not shrink to fit
    // on one line - so plan the wrap: for each candidate rendered-line count,
    // compute the font that fits both width (text wrapped across n lines) and
    // height (n lines stacked), and keep whichever count fills the most
    // screen. Assumes ~16:9 to compare vw vs vh candidates.
    const margin = Math.max(2, t.safeMargin ?? 8);
    const usable = 100 - margin * 2;
    const fontSpec = `${t.fontWeight || 600} 100px ${t.fontFamily || '"Archivo", system-ui, sans-serif'}`;
    // Total text width in em; translation renders at 0.7em, so scale it down.
    const emTotal = Math.max(
      1.5, // floor so a 1-2 char slide doesn't explode
      state.sourceLines.reduce((s, l) => s + longestLineEm([l], fontSpec), 0) +
        state.translationLines.reduce((s, l) => s + longestLineEm([l], fontSpec) * 0.7, 0),
    );
    const blockCount = Math.max(1, state.sourceLines.length + state.translationLines.length);
    // The scripture reference / section caption adds roughly half a line.
    const captionLines = t.showCaption && state.sectionLabel ? 0.7 : 0;
    let best = { fillW: 0, fillH: 0, score: 0 };
    for (let n = blockCount; n <= blockCount + 8; n++) {
      const fillW = (usable * 0.92 * n) / emTotal;         // width if wrapped over n lines
      const fillH = usable / (1.3 * (n + captionLines));   // height of the n-line stack
      const score = Math.min(fillW * 1.78, fillH);         // compare in vh (16:9)
      if (score > best.score) best = { fillW, fillH, score };
    }
    fontSize = scale
      ? `clamp(0.6rem, min(${best.fillW.toFixed(2)}cqw, ${best.fillH.toFixed(2)}cqh), 90cqh)`
      : `clamp(1.4rem, min(${best.fillW.toFixed(2)}vw, ${best.fillH.toFixed(2)}vh), 55vh)`;
  } else {
    // Lower thirds keep the conservative broadcast sizing.
    const autoVw = Math.max(2.4, Math.min(7.5, 46 / Math.max(longest, 10)));
    const autoByLines = Math.max(2.4, 8 - lineCount * 0.5);
    const unit = scale ? "cqw" : "vw";
    fontSize = `clamp(${scale ? "0.6rem" : "1.4rem"}, ${Math.min(autoVw, autoByLines)}${unit}, ${scale ? "9cqw" : "6rem"})`;
  }

  // Fullscreen centers vertically; lower thirds sit where verticalPos says
  // (bottom is the classic broadcast position). An explicit textPosition
  // (the capture lower-third band) always wins over both.
  const justify = textPosition
    ? textPosition.vertical === "top"
      ? "flex-start"
      : textPosition.vertical === "bottom"
        ? "flex-end"
        : "center"
    : !isLowerThird
      ? "center"
      : t.verticalPos === "top"
        ? "flex-start"
        : t.verticalPos === "center"
          ? "center"
          : "flex-end";

  const align = textPosition?.horizontal ?? t.textAlign;
  const alignItems = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";

  // Guaranteed safe margin on all four edges. Text wraps inside it (width),
  // and the shrink pass below keeps it inside vertically too.
  const safeMargin = Math.max(4, t.safeMargin ?? 8);

  // --- Fit guard ---
  // A user-set font size can be arbitrarily large; the text wraps within the
  // side margins but would run off the top/bottom. After layout, measure the
  // text block against the space inside the margins and scale the font down
  // just enough to fit. Auto-fit sizes are computed to fit, but the guard
  // covers them too (odd aspect ratios, long captions).
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  // Volume is a DOM property, not an HTML attribute React can pass as a prop
  // to <video> - it has to be set imperatively. Doing it via an effect rather
  // than remounting the element also means the Stream / OBS panel's slider
  // adjusts a video already playing without restarting it or losing its
  // position, since the same DOM node (same src) is reused across renders.
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaVolume = t.mediaVolume ?? 100;
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = Math.min(1, Math.max(0, mediaVolume / 100));
  }, [mediaVolume]);
  // The Audio Mixer's Media channel meter taps whichever video is registered
  // here - only ever this render's video when it's the real on-air Live
  // column AND actually has sound to tap (a muted background contributes
  // nothing to listen to).
  useEffect(() => {
    if (!isLiveOutput) return;
    const isUnmutedVideo = media?.type === "video" && !!media.url && media.muted === false;
    registerLiveMediaVideo(isUnmutedVideo ? videoRef.current : null);
    return () => registerLiveMediaVideo(null);
  }, [isLiveOutput, media?.type, media?.url, media?.muted]);
  const [shrink, setShrink] = useState(1);
  const contentKey = [
    state.slideId, state.sourceLines.join("\n"), state.translationLines.join("\n"),
    state.sectionLabel, t.fontSize, t.fontFamily, t.fontWeight, t.safeMargin,
    t.displayMode, t.showCaption,
  ].join("|");
  useLayoutEffect(() => {
    setShrink(1); // content or type changed - re-measure from full size
  }, [contentKey]);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const txt = textRef.current;
    if (!box || !txt || !showText) return;
    const fit = () => {
      const cs = getComputedStyle(box);
      const availH = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const availW = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (availH <= 0) return;
      const needH = txt.scrollHeight;
      /*
       * Shrink only, and never by more than 15% per pass.
       *
       * The full availH/needH ratio assumes height scales linearly with font
       * size, and it does not: a smaller font also re-wraps onto fewer lines,
       * so height collapses faster than the ratio predicts and one "exact"
       * step overshoots. Capping the step converges in a few passes and lands
       * just inside the box.
       *
       * This deliberately does not grow to fill leftover space. Wrapping is
       * discrete - a verse might sit on two lines at one size and need three
       * at the next step up - so for a lot of content there is simply no size
       * that fills the box, and a grow pass oscillates between too-small and
       * overflowing forever. Under-fill is handled by the prediction above,
       * not here.
       */
      /*
       * Both axes, not just height.
       *
       * This only ever measured height, so anything too WIDE to wrap - a long
       * unbroken word, a URL, a reference and translation on one line - ran
       * past the safe margin and off the edge of the screen instead of being
       * scaled to fit inside it. Taking the tighter of the two ratios keeps
       * the text inside the margin on all four sides.
       */
      const needW = txt.scrollWidth;
      const overH = needH > availH + 1;
      const overW = availW > 0 && needW > availW + 1;
      if (overH || overW) {
        const ratio = Math.min(overH ? availH / needH : 1, overW ? availW / needW : 1);
        const step = Math.max(ratio, 0.85);
        setShrink((s) => Math.max(0.05, s * step * 0.99));
      }
    };
    fit();
    // Re-fit from scratch when the output surface changes size (window moved
    // to another display, preview pane resized, …).
    const ro = new ResizeObserver(() => setShrink(1));
    ro.observe(box);
    return () => ro.disconnect();
  }, [shrink, contentKey, showText]);
  const fittedSize = shrink < 1 ? `calc(${fontSize} * ${shrink.toFixed(4)})` : fontSize;

  /*
   * "John 3:16 (KJV)" - which translation is on screen, next to the
   * reference.
   *
   * Composed here rather than baked into the slide's caption on purpose: the
   * caption is also what gets written to live history and handed back to the
   * reference parser when a passage is recalled, and a trailing "(KJV)" would
   * have to be stripped again at every one of those points. songTitle carries
   * the version label for a scripture slide, so the two are joined only at
   * the moment of drawing. It is skipped when the label is already inside the
   * reference, which search hits can be.
   */
  const captionText =
    state.songTitle && !state.sectionLabel.includes(state.songTitle)
      ? `${state.sectionLabel} (${state.songTitle})`
      : state.sectionLabel;

  return (
    <div
      ref={boxRef}
      className="slide-fade"
      style={{
        position: scale ? "relative" : "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        background: bg,
        display: "flex",
        flexDirection: "column",
        justifyContent: justify,
        alignItems,
        padding: `${safeMargin}%`,
        color: t.textColor,
        fontFamily: t.fontFamily || "var(--font-lyric)",
        fontWeight: t.fontWeight,
        textAlign: align,
        // @ts-expect-error css var
        "--tr-ms": `${t.transitionMs}ms`,
        overflow: "hidden",
        boxSizing: "border-box",
        ...(scale ? { containerType: "size" } : {}),
      }}
    >
      {/* background media (image/video) - sits behind lyrics + scrim */}
      {media && media.type === "image" && media.url && (
        <img
          src={media.url}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: media.fit === "fill" ? "fill" : media.fit === "contain" ? "contain" : "cover",
            filter: colorFilterCss(media.colorFilter),
            pointerEvents: "none",
          }}
        />
      )}
      {media && media.type === "video" && media.url && (
        <video
          ref={videoRef}
          src={media.url}
          autoPlay
          muted={media.muted !== false}
          playsInline
          loop={media.loop}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: media.fit === "fill" ? "fill" : media.fit === "contain" ? "contain" : "cover",
            filter: colorFilterCss(media.colorFilter),
            pointerEvents: "none",
          }}
        />
      )}

      {/* scrim */}
      {t.overlayScrim > 0 && state.status !== "blank" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `rgba(0,0,0,${t.overlayScrim / 100})`,
            pointerEvents: "none",
          }}
        />
      )}

      {showText && (
        <div
          ref={textRef}
          style={{
            position: "relative",
            width: "100%",
            maxWidth: "100%",
            // lower_third_bg draws a backdrop bar behind the text band
            ...(t.displayMode === "lower_third_bg"
              ? { background: t.bgColor, padding: "0.5em 0.8em", borderRadius: "0.15em" }
              : {}),
          }}
        >
          {/* Scripture reference ABOVE the verse \u2014 the classic projection layout */}
          {t.showCaption && state.sectionLabel && (
            <div
              style={{
                marginBottom: "0.45em",
                fontSize: `calc(${fittedSize} * 0.55)`,
                fontWeight: 700,
                letterSpacing: "0.02em",
                color: t.captionColor || "#f4c025",
                ...outlineStyle(t),
              }}
            >
              {captionText}
            </div>
          )}
          <div
            style={{
              fontSize: fittedSize,
              lineHeight: 1.22,
              ...outlineStyle(t),
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {state.sourceLines.map((line, i) => {
              // Formatted runs when the slide has any, plain text otherwise.
              // Runs are matched to lines by index, and a line without them
              // still renders - a mismatch degrades to plain rather than
              // dropping words off the screen mid-service.
              const runs = state.sourceRuns?.[i];
              if (!runs || runs.length === 0) return <div key={i}>{line || "\u00A0"}</div>;
              return (
                <div key={i}>
                  {runs.map((run, j) => (
                    <span key={j} style={runStyle(run)}>
                      {run.text}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
          {state.translationLines.length > 0 && (
            <div
              style={{
                marginTop: "0.5em",
                fontSize: `calc(${fittedSize} * 0.7)`,
                color: t.translationColor || undefined,
                opacity: t.translationColor ? 1 : 0.78,
                lineHeight: 1.2,
                ...outlineStyle(t),
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {state.translationLines.map((line, i) => (
                <div key={i}>{line || "\u00A0"}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
