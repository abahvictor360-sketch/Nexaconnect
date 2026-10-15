import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LiveState, LiveTheme } from "../lib/live-bus";
import { runStyle } from "../lib/rich-text";
import { registerLiveMediaVideo } from "../lib/audio-taps";
import { useAudioOutputMuted, useRoutedAudio } from "../hooks/use-audio-output";
import { colorFilterCss } from "../lib/color-filters";
import { useMediaUrl } from "../hooks/use-media-url";

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

/**
 * Per-word widths for a line, in em (width at 100px / 100).
 *
 * Word widths rather than a whole-line width, because a line's rendered
 * height depends on where it actually WRAPS, and wrapping happens at word
 * boundaries. Dividing a total width by the available width assumes words
 * can be split anywhere and so always under-counts lines.
 */
function wordWidthsEm(line: string, font: string): { words: number[]; space: number } {
  if (typeof document === "undefined") return { words: [], space: 0.25 };
  _measureCanvas ??= document.createElement("canvas");
  const ctx = _measureCanvas.getContext("2d");
  if (!ctx) {
    const parts = line.split(/\s+/).filter(Boolean);
    return { words: parts.map((w) => w.length * 0.56), space: 0.28 };
  }
  ctx.font = font;
  const parts = line.split(/\s+/).filter(Boolean);
  return {
    words: parts.map((w) => ctx.measureText(w).width / 100),
    space: ctx.measureText(" ").width / 100,
  };
}

/** Greedy word wrap - how many rendered lines this text needs at `maxEm` wide. */
function wrappedLineCount(m: { words: number[]; space: number }, maxEm: number): number {
  if (!m.words.length) return 1;
  if (maxEm <= 0) return m.words.length;
  let lines = 1;
  let used = 0;
  for (const w of m.words) {
    if (used === 0) {
      used = w;
      // A single word wider than the box overflows its line no matter what;
      // count the extra rows it will spill onto so height isn't understated.
      if (w > maxEm) {
        lines += Math.ceil(w / maxEm) - 1;
        used = 0;
      }
      continue;
    }
    if (used + m.space + w <= maxEm) used += m.space + w;
    else {
      lines += 1;
      used = w > maxEm ? 0 : w;
      if (w > maxEm) lines += Math.ceil(w / maxEm) - 1;
    }
  }
  return lines;
}

// Combined text effects: the outline glow and the optional drop shadow are both
// CSS text-shadows, layered into one comma-separated value.
/**
 * The safe margin actually used, as a percentage of each edge.
 *
 * One function because the two places that need it must agree: the auto-fit
 * pass sizes the type against the space inside the margin, and the layout
 * applies it as padding. They used to clamp at different floors - 2 and 4 -
 * so a margin below 4 had text measured against more room than it was given,
 * and it overflowed by exactly the difference.
 */
function clampMargin(safeMargin: number | null | undefined): number {
  return Math.max(2, safeMargin ?? 8);
}

/**
 * The four margins, in percent, as the operator set them.
 *
 * Per-edge values exist for the screen that is cropped on one side only - a
 * projector overshooting the top of a wall, a TV with overscan down one edge -
 * where a single number can only be raised on all four, wasting the three
 * edges that were fine. With none set, all four are the single margin, which
 * is what every theme carries.
 */
function marginEdges(t: LiveTheme): { top: number; right: number; bottom: number; left: number } {
  const all = clampMargin(t.safeMargin);
  const e = t.safeMarginEdges;
  if (!e) return { top: all, right: all, bottom: all, left: all };
  return {
    top: clampMargin(e.top),
    right: clampMargin(e.right),
    bottom: clampMargin(e.bottom),
    left: clampMargin(e.left),
  };
}

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
  playAudio = false,
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
  /**
   * Let this instance's background video actually be heard.
   *
   * The same slide is rendered several times over at once - the operator's
   * preview and live thumbnails, a full-screen output, the projector window -
   * and each one holds its own <video>. Unmuting all of them plays the clip
   * three times a few frames apart, which in a room is an echo, so exactly one
   * surface is given the sound and the caller decides which (see
   * pages/index.tsx and components/live-output.tsx).
   */
  playAudio?: boolean;
}) {
  const t = state.theme;
  const isLowerThird = t.displayMode !== "fullscreen";
  const media = state.status === "blank" ? null : t.background;
  // A background held in this browser arrives as a marker rather than a URL;
  // this resolves it against the bytes, wherever this surface got them.
  const mediaUrl = useMediaUrl(media?.type === "color" ? null : media?.url);
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

  /**
   * The output box in real pixels, so the font size below can be solved
   * against it rather than guessed. Declared before the sizing code that
   * reads it, and only ever updated when the surface itself resizes - never
   * in response to the font size - so it cannot feed back on itself.
   *
   * This is the box INCLUDING the margins, because the margins are now one of
   * the things being solved for: the sizing code works out how much of them a
   * crowded slide has to give back, so it cannot start from a measurement
   * that already has them subtracted.
   */
  const boxRef = useRef<HTMLDivElement>(null);
  const [outerPx, setOuterPx] = useState<{ w: number; h: number } | null>(null);

  // Auto-fit font sizing based on line count/length when fontSize is null.
  const lineCount = state.sourceLines.length + (state.translationLines.length ? state.translationLines.length : 0);
  const longest = Math.max(1, ...state.sourceLines.map((l) => l.length), ...state.translationLines.map((l) => l.length));

  /*
   * Leading, closing up as the slide fills.
   *
   * 1.22 is comfortable for the two or three lines a slide usually carries.
   * On a long passage the gaps between lines add up to a whole line of
   * height, and height is exactly what a crowded slide is short of, so the
   * leading tightens to 1.08 - still clear of the descenders, and worth
   * roughly a 10% larger font on a ten-line slide.
   */
  const blockLines = Math.max(1, state.sourceLines.length + state.translationLines.length);
  const lineHeight = blockLines <= 4 ? 1.22 : Math.max(1.08, 1.22 - (blockLines - 4) * 0.025);
  const trLineHeight = Math.min(1.2, lineHeight);

  /*
   * The margins are a maximum, not a reservation.
   *
   * A safe margin exists so nothing lands in the strip a projector or TV
   * crops off, and on a slide with room to spare the breathing space looks
   * better too. But holding all of it on a slide packed with text buys tidy
   * edges at the price of words too small to read from the back of the room,
   * which is the wrong way round - so a crowded slide gives margin back.
   *
   * Half of each edge, not all of it: an operator who raised the margin to
   * 12% did that for a screen that really does crop, and dropping them to the
   * bare 2% floor would put the text in the strip they were avoiding. Half
   * keeps their setting meaning something and still returns a third of the
   * space on a theme left at the default 8%.
   */
  const fullEdges = marginEdges(t);
  const tightEdges = {
    top: Math.max(2, fullEdges.top / 2),
    right: Math.max(2, fullEdges.right / 2),
    bottom: Math.max(2, fullEdges.bottom / 2),
    left: Math.max(2, fullEdges.left / 2),
  };

  /*
   * The room inside a set of margins, in pixels.
   *
   * The vertical pair is measured against the box's HEIGHT. CSS percentage
   * padding resolves against width on all four sides, top and bottom
   * included, so on a 16:9 screen an 8% margin was reserving 14% of the
   * height above the text and 14% below - 28% of the screen, nearly a third,
   * spent on two strips nobody asked for. Pixels here, and pixels on the
   * padding further down, make 8% mean 8% of the edge it sits on.
   */
  type Edges = { top: number; right: number; bottom: number; left: number };
  const roomInside = (e: Edges) =>
    outerPx
      ? {
          w: outerPx.w * (1 - (e.left + e.right) / 100),
          h: outerPx.h * (1 - (e.top + e.bottom) / 100),
        }
      : null;

  const fontSpec = `${t.fontWeight || 600} 100px ${t.fontFamily || '"Archivo", system-ui, sans-serif'}`;
  // The scripture reference / section caption adds roughly half a line.
  const captionLines = t.showCaption && state.sectionLabel ? 0.7 : 0;
  const srcM = state.sourceLines.map((l) => wordWidthsEm(l, fontSpec));
  const trM = state.translationLines.map((l) => wordWidthsEm(l, fontSpec));
  /** Height the text block would render at, for a font size and a box width. */
  const heightAt = (f: number, boxW: number) => {
    const maxEm = boxW / f;
    let h = 0;
    if (captionLines) h += f * 0.55 * 1.2 + f * 0.45;       // caption + its margin
    for (const m of srcM) h += wrappedLineCount(m, maxEm) * lineHeight * f;
    if (trM.length) {
      h += f * 0.5;                                         // marginTop on the block
      const trMax = maxEm / 0.7;                             // translation renders at 0.7em
      for (const m of trM) h += wrappedLineCount(m, trMax) * trLineHeight * 0.7 * f;
    }
    return h;
  };

  /*
   * Height is monotonic in font size, so the largest size that fits a box can
   * be found exactly by bisection: simulate the real greedy word wrap at a
   * candidate size, add up the rendered rows, and compare against the box. No
   * layout feedback is involved, so unlike growing-to-fill it cannot
   * oscillate on the discrete jumps where a line re-wraps.
   *
   * The 2% back off absorbs the small disagreements between canvas metrics
   * and real DOM layout (letter-spacing, kerning) without a visible loss.
   */
  const largestThatFits = (box: { w: number; h: number }) => {
    let lo = 4;
    let hi = Math.max(8, box.h);        // a single short line can be box-height tall
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (heightAt(mid, box.w) <= box.h) lo = mid;
      else hi = mid;
    }
    return lo * 0.98;
  };

  // Use container-query units (cqw/cqh) when rendered as a scaled preview so
  // the font sizes relative to the small box, not the whole viewport. The full
  // projector uses viewport units (vw/vh).
  let fontSize: string;
  // Which margins this slide ends up drawn with - reassigned below when the
  // text is too crowded to afford all of them.
  let margins: Edges = fullEdges;
  const fullRoom = roomInside(fullEdges);
  const measured = fullRoom && fullRoom.w > 20 && fullRoom.h > 20 ? fullRoom : null;

  if (t.fontSize) {
    fontSize = scale ? `${t.fontSize * 0.28}cqw` : `${t.fontSize}px`;
    /*
     * A size the operator typed is a decision, so the margin yields to it
     * before the fit guard starts shrinking it back down. Without this the
     * guard would quietly undo their choice while two strips of empty screen
     * sat either side of the words.
     */
    if (!isLowerThird && measured && !scale && heightAt(t.fontSize, measured.w) > measured.h) {
      margins = tightEdges;
    }
  } else if (!isLowerThird) {
    if (measured) {
      const atFull = largestThatFits(measured);
      /*
       * Readability floor, below which the margins are worth less than the
       * words: type under an eighth of the screen's height - about seven
       * lines deep - is where a slide starts being hard to read from the back
       * of a room. Above it the slide has room to spare and keeps its
       * margins; below it, it takes the bigger of the two sizes.
       *
       * Binary rather than a smooth trade so the decision depends only on the
       * measurements, never on the previous frame - there is no state here to
       * oscillate between.
       */
      if (atFull < measured.h / 8) {
        const tightRoom = roomInside(tightEdges)!;
        const atTight = largestThatFits(tightRoom);
        if (atTight > atFull) margins = tightEdges;
        fontSize = `${Math.max(atFull, atTight).toFixed(2)}px`;
      } else {
        fontSize = `${atFull.toFixed(2)}px`;
      }
    } else {
      // First render, before the box has been measured: keep the old estimate
      // so there is never a frame with no text.
      // Width is what wrapping is solved against, so the horizontal pair is
      // what the type has to fit between - a taller top margin does not
      // narrow a line.
      const usable = 100 - fullEdges.left - fullEdges.right;
      // Total text width in em; translation renders at 0.7em, so scale it down.
      const emTotal = Math.max(
        1.5, // floor so a 1-2 char slide doesn't explode
        state.sourceLines.reduce((s, l) => s + longestLineEm([l], fontSpec), 0) +
          state.translationLines.reduce((s, l) => s + longestLineEm([l], fontSpec) * 0.7, 0),
      );
      let best = { fillW: 0, fillH: 0, score: 0 };
      for (let n = blockLines; n <= blockLines + 8; n++) {
        const fillW = (usable * 0.92 * n) / emTotal;
        const fillH = usable / (1.3 * (n + captionLines));
        const score = Math.min(fillW * 1.78, fillH);
        if (score > best.score) best = { fillW, fillH, score };
      }
      fontSize = scale
        ? `clamp(0.6rem, min(${best.fillW.toFixed(2)}cqw, ${best.fillH.toFixed(2)}cqh), 90cqh)`
        : `clamp(1.4rem, min(${best.fillW.toFixed(2)}vw, ${best.fillH.toFixed(2)}vh), 55vh)`;
    }
  } else {
    // Lower thirds keep the conservative broadcast sizing, and all of their
    // margin: a band is sized by the operator in the first place, and the
    // safe area around a broadcast graphic is not theirs to spend.
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
  /*
   * Justified text has to span the box or there is nothing to justify
   * against: shrink-wrapped to its content, every line would already be
   * flush at both ends and the setting would do nothing. The other three
   * place the block itself, which is what makes a short line sit where the
   * operator asked rather than in a full-width box that only looks centered.
   */
  const alignItems =
    align === "justify" ? "stretch" : align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";

  // --- Fit guard ---
  // A user-set font size can be arbitrarily large; the text wraps within the
  // side margins but would run off the top/bottom. After layout, measure the
  // text block against the space inside the margins and scale the font down
  // just enough to fit. Auto-fit sizes are computed to fit, but the guard
  // covers them too (odd aspect ratios, long captions).
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
  // Whether this copy of the slide is the one making the noise. A video the
  // operator has silenced stays silent everywhere, and so does everything
  // while the master output mute is on.
  const outputMuted = useAudioOutputMuted();
  const audible = playAudio && !outputMuted && media?.type === "video" && media.muted === false;
  // Play it out of the operator's chosen speakers rather than whatever the OS
  // calls "default" - re-applied on every source change, since the route is
  // attached to the element and a fresh src can drop it.
  useRoutedAudio(videoRef, mediaUrl, audible);
  /*
   * Autoplay with sound is refused until the page has been interacted with,
   * and a refused play() leaves the video PAUSED - a black rectangle where the
   * background should be. A projector window nobody has clicked in is exactly
   * that case, so: try it with sound, and if the browser says no, fall back to
   * a muted play (the picture is what matters most) and take the sound back at
   * the first click, key or tap in that window.
   */
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !mediaUrl || media?.type !== "video") return;
    if (!audible) {
      setAutoplayBlocked(false);
      return;
    }
    let cancelled = false;
    el.muted = false;
    void el.play().catch((err: unknown) => {
      if (cancelled || !videoRef.current) return;
      // Only an autoplay refusal is worth muting for. A file that will not
      // load or decode fails the same way, and silencing the video would be
      // treating a broken source as a policy problem - it stays unmuted so
      // that fixing the file is all it takes.
      const blocked = err instanceof DOMException && err.name === "NotAllowedError";
      if (!blocked) return;
      videoRef.current.muted = true;
      setAutoplayBlocked(true);
      void videoRef.current.play().catch(() => {
        // Nothing left to try - the operator sees a paused frame, not a crash.
      });
    });
    return () => {
      cancelled = true;
    };
  }, [audible, mediaUrl, media?.type]);
  useEffect(() => {
    if (!autoplayBlocked) return;
    const unblock = () => {
      const el = videoRef.current;
      if (el) {
        el.muted = false;
        void el.play().catch(() => undefined);
      }
      setAutoplayBlocked(false);
    };
    const opts = { once: true } as const;
    window.addEventListener("pointerdown", unblock, opts);
    window.addEventListener("keydown", unblock, opts);
    return () => {
      window.removeEventListener("pointerdown", unblock);
      window.removeEventListener("keydown", unblock);
    };
  }, [autoplayBlocked]);
  // The Audio Mixer's Media channel meter taps whichever video is registered
  // here - only ever this render's video when it's the real on-air Live
  // column AND actually has sound to tap (a muted background contributes
  // nothing to listen to).
  useEffect(() => {
    if (!isLiveOutput) return;
    // Only when this copy is the audible one: a muted element feeds silence
    // into the analyser, so a meter tapped off it would read flat and look
    // like a dead channel rather than sound coming out of another window.
    registerLiveMediaVideo(audible ? videoRef.current : null);
    return () => registerLiveMediaVideo(null);
  }, [isLiveOutput, audible]);
  const [shrink, setShrink] = useState(1);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const read = () => {
      // clientWidth/Height are the padding box, so they do not move when the
      // padding below changes - which is what keeps this from feeding back on
      // itself once the margins became something the sizing code decides.
      const w = box.clientWidth;
      const h = box.clientHeight;
      setOuterPx((p) =>
        p && Math.abs(p.w - w) < 1 && Math.abs(p.h - h) < 1 ? p : { w, h },
      );
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);
  const contentKey = [
    state.slideId, state.sourceLines.join("\n"), state.translationLines.join("\n"),
    state.sectionLabel, t.fontSize, t.fontFamily, t.fontWeight, t.safeMargin,
    JSON.stringify(t.safeMarginEdges ?? null),
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
  /*
   * Everything that resizes the type meets here, at the one point that
   * produces the size actually drawn.
   *
   * `shrink` is the fit guard clawing back an overflow; `fontScale` is a
   * deliberate trim carried by the theme (see LiveTheme.fontScale). Folding
   * them into a single multiplier keeps the auto-fit above free to compute the
   * size that fills the box, which is what the measurement is good at, without
   * having to know about either.
   */
  const sizeFactor = (t.fontScale ?? 1) * (shrink < 1 ? shrink : 1);
  const fittedSize =
    Math.abs(sizeFactor - 1) < 0.0005 ? fontSize : `calc(${fontSize} * ${sizeFactor.toFixed(4)})`;

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
        /*
         * Pixels, worked out from the measured box, so a margin means the
         * same fraction of the edge it sits on: percentage padding resolves
         * against width on all four sides, which turned an 8% margin into
         * 14% of the height at the top and another 14% at the bottom.
         *
         * Percentages still cover the first frame, before the box has been
         * measured - wrong by the old amount for one frame, rather than no
         * margin at all.
         */
        padding: outerPx
          ? `${((outerPx.h * margins.top) / 100).toFixed(1)}px ${((outerPx.w * margins.right) / 100).toFixed(1)}px ${((outerPx.h * margins.bottom) / 100).toFixed(1)}px ${((outerPx.w * margins.left) / 100).toFixed(1)}px`
          : `${margins.top}% ${margins.right}% ${margins.bottom}% ${margins.left}%`,
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
      {media && media.type === "image" && mediaUrl && (
        <img
          src={mediaUrl}
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
      {media && media.type === "video" && mediaUrl && (
        <video
          ref={videoRef}
          src={mediaUrl}
          autoPlay
          muted={!audible || autoplayBlocked}
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
              lineHeight,
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
                lineHeight: trLineHeight,
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
