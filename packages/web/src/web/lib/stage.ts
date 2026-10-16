/**
 * Stage layer - the single publish path for BOTH song lyrics and Bible verses.
 *
 * A StageSlide is a source-agnostic unit of content. The operator PREVIEWS a
 * StageSlide, then SENDS it to live. Live output (projector, /stream) only ever
 * sees LiveState, so lyrics and scripture render through the exact same engine.
 */
import { liveBus, type LiveBackground, type LiveState, type LiveTheme } from "./live-bus";
import { MAIN_SCREEN, stateEndpoint } from "./screens";
import type { TextAlign, TextRun } from "./rich-text";

export type StageKind = "lyric" | "bible" | "presentation" | "media";

export type StageSlide = {
  kind: StageKind;
  sourceLines: string[];
  translationLines: string[];
  /** Section label (lyrics) or scripture reference (bible), shown as caption. */
  caption: string;
  /** Song title (lyrics) or version label (bible). */
  title: string;
  slideId: string | null;
  slideIndex: number;
  slideCount: number;
  /**
   * Per-slide background (presentation slides only). undefined = inherit the
   * theme's own background; null = explicitly no background (theme color).
   */
  background?: LiveBackground;
  /**
   * Per-slide design (presentation slides only) - the imported deck's own
   * colors. undefined/null = inherit the app theme's colors.
   */
  bgColor?: string | null;
  textColor?: string | null;
  /**
   * Words within this slide that carry their own colour or emphasis, one entry
   * per line of sourceLines. undefined = the slide is plain text.
   */
  sourceRuns?: TextRun[][];
  /** Per-slide alignment override. undefined/null = inherit the theme's. */
  textAlign?: TextAlign | null;
};

export function stageToState(
  slide: StageSlide | null,
  status: LiveState["status"],
  theme: LiveTheme,
): Omit<LiveState, "rev"> {
  const live = status === "live" && slide;
  // Layer the slide's own design (imported deck colors + per-slide media) over
  // the app theme. Each field is independent: a deck that only sets a
  // background color still inherits the theme's font, size and alignment.
  let effectiveTheme = theme;
  if (live) {
    if (slide.background !== undefined) effectiveTheme = { ...effectiveTheme, background: slide.background };
    if (slide.bgColor) effectiveTheme = { ...effectiveTheme, bgColor: slide.bgColor };
    if (slide.textColor) effectiveTheme = { ...effectiveTheme, textColor: slide.textColor };
    if (slide.textAlign) effectiveTheme = { ...effectiveTheme, textAlign: slide.textAlign };
  }
  return {
    status,
    sourceLines: live ? slide.sourceLines : [],
    ...(live && slide.sourceRuns ? { sourceRuns: slide.sourceRuns } : {}),
    translationLines: live ? slide.translationLines : [],
    sectionLabel: slide?.caption ?? "",
    songTitle: slide?.title ?? "",
    slideId: slide?.slideId ?? null,
    slideIndex: slide?.slideIndex ?? 0,
    slideCount: slide?.slideCount ?? 0,
    theme: effectiveTheme,
  };
}

/**
 * Publish to every live surface: BroadcastChannel + localStorage (projector,
 * operator preview) AND mirror to the server so out-of-process clients (OBS
 * browser-source /stream, NDI bridge) stay in sync.
 */
export function publishLive(state: Omit<LiveState, "rev">, screenId: string = MAIN_SCREEN): LiveState {
  const full = liveBus(screenId).publish(state);
  try {
    /*
     * No `keepalive`. It survives the page closing, which nothing here needs
     * - the previous publish is already on the server - and it buys that at
     * the price of a 64KB cap on everything in flight at once, shared across
     * the origin. A slide carrying formatting runs and a theme is a few KB,
     * so a handful of changes still in the air over a slow room Wi-Fi can
     * cross it, and the fetch then throws and is swallowed here: the slide
     * reaches the operator's own windows and never reaches the screens.
     */
    fetch(stateEndpoint(screenId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(full),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
  return full;
}
