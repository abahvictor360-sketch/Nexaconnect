/**
 * Live output bus - one channel, render once output many.
 * Operator writes the live output state; the projector window subscribes.
 * Uses BroadcastChannel (works across Electron windows & browser tabs) plus a
 * localStorage snapshot so a late-opening projector immediately syncs.
 */

import type { TextRun } from "./rich-text";

export type LiveBackground = {
  type: "image" | "video" | "color";
  url: string; // presigned/external url, or hex color when type === "color"
  fit: "cover" | "contain" | "fill";
  loop: boolean;
  /** Video only: true = plays silently. Default true if omitted. */
  muted?: boolean;
  /** LUT-style look preset id (see lib/color-filters.ts), or a raw CSS filter string. */
  colorFilter?: string | null;
} | null;

export type LiveTheme = {
  bgColor: string;
  textColor: string;
  textAlign: "left" | "center" | "right";
  fontWeight: number;
  fontSize: number | null; // null = auto-fit
  /**
   * Deliberate trim on the final type size, multiplied in after auto-fit.
   * 1 (or absent) leaves it alone; 0.9 is 10% smaller than the size that would
   * fill the box. Separate from fontSize because it applies to the auto-fit
   * result too, which is the case that has no number to edit.
   */
  fontScale?: number;
  fontFamily: string | null; // CSS font stack; null = default lyric font
  safeMargin: number; // %
  overlayScrim: number; // 0-100
  displayMode: "fullscreen" | "lower_third" | "lower_third_bg";
  verticalPos: "top" | "center" | "bottom";
  transition: string;
  transitionMs: number;
  textOutline: { color: string; width: number } | null;
  /** Drop shadow behind the text for readability over busy backgrounds. */
  textShadow?: { color: string; blur: number; x: number; y: number } | null;
  background: LiveBackground;
  /** Show the caption (scripture reference / section label) on the output. */
  showCaption?: boolean;
  /** Caption color; null = accent default. */
  captionColor?: string | null;
  /** Color of the secondary/translation line; null = textColor at reduced opacity. */
  translationColor?: string | null;
  /**
   * Playback volume (0-100) for an unmuted background video, applied on every
   * output (projector, stream, operator preview) - the Stream / OBS panel's
   * "reduce volume" control. undefined/omitted = 100 (full volume, i.e. the
   * file's own level). Muted videos ignore this; there is nothing to turn down.
   */
  mediaVolume?: number;
};

/**
 * How live video and the slide share the output.
 *  - "full"    video only, slide hidden
 *  - "overlay" slide composited over full-bleed video (lower thirds live here)
 *  - "pip"     video and slide side by side, neither covering the other
 */
export type CaptureLayout = "full" | "overlay" | "pip";

/**
 * Live video mirrored to the output - a screen, a window, or a camera/capture
 * card. Only the source id travels on the bus: a MediaStream can't cross
 * windows, so the projector opens its own capture of the same source.
 */
export type LiveCapture = {
  sourceId: string;
  name: string;
  /** "camera" covers webcams AND HDMI capture cards, which appear as video inputs. */
  kind: "screen" | "window" | "camera";
  layout: CaptureLayout;
  /** pip only: which side the video sits on. */
  pipVideoSide?: "left" | "right";
  /** pip only: fraction of the width given to the video (0.2–0.8). */
  pipVideoWidth?: number;
  /**
   * overlay only: whether the slide fills the whole frame or sits in a
   * sized band at the bottom - the classic broadcast lower third.
   * undefined = "fullscreen" (today's default behaviour).
   */
  overlayMode?: "fullscreen" | "lower_third";
  /** overlay + lower_third: band height, % of frame height (10-100). */
  overlayHeightPct?: number;
  /** overlay + lower_third: band width, % of frame width (20-100). */
  overlayWidthPct?: number;
  /**
   * overlay + lower_third: whether the band has a backdrop at all. undefined =
   * true (a solid colour/image bar, today's default). false = no bar - the
   * words float directly over the video, backed by a heavy black shadow/
   * outline instead so they stay legible without covering the shot.
   */
  overlayBgEnabled?: boolean;
  /** overlay + lower_third: band backdrop color, used when no image is set. */
  overlayBgColor?: string;
  /** overlay + lower_third: band backdrop image (a media library url) instead of a flat color. */
  overlayBgImage?: string | null;
  /** overlay + lower_third: where the text sits within the band. undefined = bottom/center. */
  overlayTextVerticalPos?: "top" | "center" | "bottom";
  overlayTextAlign?: "left" | "center" | "right";
  /** Preacher/speaker nameplate shown over the capture, any layout. null/absent = hidden. */
  nameplate?: { name: string; title?: string } | null;
  /**
   * Where this capture's sound comes from.
   *  - "none"    silent (the default, and the only sane one for a screen or
   *              window nobody meant to broadcast the audio of)
   *  - "capture" the source's own audio - a screen/window's system sound, or
   *              a capture card's embedded audio
   *  - "mic"     the room microphone instead, for a camera pointed at someone
   *              speaking into a PA the camera itself can't hear properly
   * undefined = "none".
   */
  audioSource?: "none" | "capture" | "mic";
  /** LUT-style look preset id (see lib/color-filters.ts), or a raw CSS filter string. */
  colorFilter?: string | null;
  /**
   * A real uploaded 3D LUT (.cube), by id - see lib/lut.ts. Takes over from
   * `colorFilter` when set: a genuine color-grading table rather than a CSS
   * approximation, applied by the same canvas pass as chroma key.
   */
  lutId?: string | null;
  /**
   * Chroma key (green-screen) removal on the capture feed. Pixels within
   * `similarity` of `color` become transparent, so whatever the layout puts
   * behind the capture (a slide background, the lower-third band's own
   * backdrop) shows through instead of the studio backdrop.
   */
  chromaKey?: {
    enabled: boolean;
    /** Key color to remove, as a hex string (e.g. "#00b140" - broadcast green). */
    color: string;
    /** 0-1: how close a pixel must be to `color` to be keyed out. */
    similarity: number;
    /** 0-1: width of the soft edge between kept and removed, to avoid a hard cutout line. */
    smoothness: number;
  } | null;
} | null;

export type LiveState = {
  status: "idle" | "live" | "blank" | "clear";
  /** When set, the output shows this live capture instead of the slide. */
  capture?: LiveCapture;
  sourceLines: string[];
  /**
   * Per-line formatted runs for sourceLines, when the slide carries any
   * colouring or emphasis. Optional and strictly parallel to sourceLines,
   * which stays the plain text: the auto-fit measurement works off the plain
   * strings, and any consumer that predates this - an older projector window,
   * a browser source mid-service - keeps rendering correctly without it.
   */
  sourceRuns?: TextRun[][];
  translationLines: string[];
  sectionLabel: string;
  songTitle: string;
  slideId: string | null;
  slideIndex: number;
  slideCount: number;
  theme: LiveTheme;
  rev: number; // monotonic revision
};

export const DEFAULT_THEME: LiveTheme = {
  bgColor: "#0a0a0c",
  textColor: "#ffffff",
  textAlign: "center",
  fontWeight: 600,
  fontSize: null,
  fontFamily: null,
  safeMargin: 8,
  overlayScrim: 0,
  displayMode: "fullscreen",
  verticalPos: "center",
  transition: "fade",
  transitionMs: 300,
  textOutline: { color: "rgba(0,0,0,0.6)", width: 2 },
  textShadow: null,
  background: null,
  showCaption: false,
  captionColor: null,
  translationColor: null,
  mediaVolume: 100,
};

/**
 * A row of the `themes` table -> the shape the renderer draws.
 *
 * Lives here rather than in the operator page because the theme editor needs
 * the same mapping to preview a theme it has not applied yet: preview and live
 * output must agree, and two copies of this would drift.
 *
 * `background` is not resolved from the row - the caller layers that on, since
 * it can come from the theme, the song, or the operator's own pick.
 */
export function themeToLive(t: Record<string, unknown> | undefined): LiveTheme {
  if (!t) return DEFAULT_THEME;
  return {
    bgColor: (t.bgColor as string) ?? DEFAULT_THEME.bgColor,
    textColor: (t.textColor as string) ?? DEFAULT_THEME.textColor,
    textAlign: (t.textAlign as LiveTheme["textAlign"]) ?? "center",
    fontWeight: (t.fontWeight as number) ?? 600,
    fontSize: (t.fontSize as number) ?? null,
    fontFamily: (t.fontFamily as string) ?? null,
    safeMargin: (t.safeMargin as number) ?? 8,
    overlayScrim: (t.overlayScrim as number) ?? 0,
    displayMode: (t.displayMode as LiveTheme["displayMode"]) ?? "fullscreen",
    verticalPos: (t.verticalPos as LiveTheme["verticalPos"]) ?? "center",
    transition: (t.transition as string) ?? "fade",
    transitionMs: (t.transitionMs as number) ?? 300,
    textOutline: (t.textOutline
      ? typeof t.textOutline === "string"
        ? JSON.parse(t.textOutline as string)
        : t.textOutline
      : DEFAULT_THEME.textOutline) as LiveTheme["textOutline"],
    textShadow: (t.textShadow
      ? typeof t.textShadow === "string"
        ? JSON.parse(t.textShadow as string)
        : t.textShadow
      : DEFAULT_THEME.textShadow) as LiveTheme["textShadow"],
    background: DEFAULT_THEME.background,
  };
}

export const IDLE_STATE: LiveState = {
  status: "idle",
  capture: null,
  sourceLines: [],
  translationLines: [],
  sectionLabel: "",
  songTitle: "",
  slideId: null,
  slideIndex: 0,
  slideCount: 0,
  theme: DEFAULT_THEME,
  rev: 0,
};

const CHANNEL = "vifug-live";
const SNAPSHOT_KEY = "vifug:live-state";

type Listener = (s: LiveState) => void;

class LiveBus {
  private chan: BroadcastChannel | null = null;
  private listeners = new Set<Listener>();
  private rev = 0;

  constructor() {
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      this.chan = new BroadcastChannel(CHANNEL);
      this.chan.onmessage = (e) => {
        const s = e.data as LiveState;
        this.rev = Math.max(this.rev, s.rev);
        this.listeners.forEach((l) => l(s));
      };
    }
    // Cross-window fallback via storage events (also helps browser tabs).
    if (typeof window !== "undefined") {
      window.addEventListener("storage", (e) => {
        if (e.key === SNAPSHOT_KEY && e.newValue) {
          try {
            const s = JSON.parse(e.newValue) as LiveState;
            this.rev = Math.max(this.rev, s.rev);
            this.listeners.forEach((l) => l(s));
          } catch { /* ignore */ }
        }
      });
    }
  }

  /**
   * Publish a new live state.
   *
   * A live capture is orthogonal to the slide: setCapture() deliberately
   * leaves the cued words alone, and the reverse has to hold too or sending a
   * slide live would knock the camera off the screen. stageToState() builds
   * slide state and says nothing about capture, so an absent `capture` KEY
   * means "unchanged" and inherits the current one. Passing it explicitly -
   * including `capture: null`, which setCapture(null) does to stop a capture -
   * still wins.
   */
  publish(state: Omit<LiveState, "rev">) {
    this.rev += 1;
    const capture = "capture" in state ? state.capture : this.snapshot().capture;
    const full: LiveState = { ...state, capture, rev: this.rev };
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(full));
    } catch { /* ignore */ }
    this.chan?.postMessage(full);
    // Notify listeners in THIS window too - BroadcastChannel and storage events
    // never fire in the originating window, so the operator's own live preview
    // would otherwise never update.
    this.listeners.forEach((l) => l(full));
    return full;
  }

  /**
   * Turn a live capture on/off without disturbing what's cued. The slide state
   * is left intact so ending the capture returns to exactly what was showing.
   */
  setCapture(capture: LiveCapture) {
    const { rev: _rev, ...rest } = this.snapshot();
    return this.publish({ ...rest, capture });
  }

  snapshot(): LiveState {
    try {
      const raw = localStorage.getItem(SNAPSHOT_KEY);
      if (raw) return JSON.parse(raw) as LiveState;
    } catch { /* ignore */ }
    return IDLE_STATE;
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

let _bus: LiveBus | null = null;
export function liveBus(): LiveBus {
  if (!_bus) _bus = new LiveBus();
  return _bus;
}
