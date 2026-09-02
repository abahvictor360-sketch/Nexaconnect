import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveTheme } from "../lib/live-bus";
import { publishLive, stageToState, type StageSlide } from "../lib/stage";

export type StageController = ReturnType<typeof useStage>;

/**
 * Owns preview + live pointers over a flat list of StageSlides.
 *
 * Preview vs Live (ProPresenter-style):
 *  - previewIndex: what the operator is looking at / cueing next.
 *  - liveIndex: what is actually on the projector/stream RIGHT NOW.
 *  - sendLive(): pushes the previewed slide to live.
 *
 * Manual override always wins - auto-follow and every button call goLive()
 * directly. Theme is resolved by the caller (lyrics vs bible overrides).
 */
/**
 * Where the currently-live slide has ended up in a rebuilt slide list, or -1
 * if it simply isn't there any more.
 *
 * Exact id match covers everything except one case worth keeping: a Bible
 * slide's id carries the version ("kjv-JHN-3-16"), so switching translation
 * while a verse is live re-keys it. Matching on the reference after the
 * version prefix lets the output follow to the SAME verse in the new
 * translation, which is the point of switching mid-service. Nothing else
 * falls back - see the caller.
 */
function locateLiveSlide(slides: StageSlide[], liveId: string): number {
  const exact = slides.findIndex((s) => s.slideId === liveId);
  if (exact >= 0) return exact;

  const ref = liveId.slice(liveId.indexOf("-") + 1); // "JHN-3-16"
  if (!ref || ref === liveId) return -1;
  return slides.findIndex(
    (s) => s.kind === "bible" && !!s.slideId && s.slideId.slice(s.slideId.indexOf("-") + 1) === ref,
  );
}

export function useStage(opts: { slides: StageSlide[]; theme: LiveTheme }) {
  const { slides, theme } = opts;
  const [previewIndex, setPreviewIndex] = useState(-1);
  const [liveIndex, setLiveIndex] = useState(-1);
  const [status, setStatus] = useState<"idle" | "live" | "blank" | "clear">("idle");

  const liveRef = useRef(liveIndex);
  liveRef.current = liveIndex;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const slidesRef = useRef(slides);
  slidesRef.current = slides;
  // Identity of the live slide, so content edits / tab switches re-locate it by
  // id rather than by a positional index that may now point at other content.
  const liveIdRef = useRef<string | null>(null);

  const publishAt = useCallback((index: number, st: "live" | "blank" | "clear" | "idle") => {
    const list = slidesRef.current;
    const slide = index >= 0 && index < list.length ? list[index] : null;
    publishLive(stageToState(slide, st, themeRef.current));
  }, []);

  const goLive = useCallback((index: number) => {
    if (index < 0 || index >= slidesRef.current.length) return;
    liveIdRef.current = slidesRef.current[index].slideId;
    setLiveIndex(index);
    setPreviewIndex(index);
    setStatus("live");
    publishAt(index, "live");
  }, [publishAt]);

  /** Preview a slide without sending it live. */
  const preview = useCallback((index: number) => {
    if (index < 0 || index >= slidesRef.current.length) return;
    setPreviewIndex(index);
  }, []);

  /** Send the currently previewed slide to live. */
  const sendLive = useCallback(() => {
    const i = previewIndex >= 0 ? previewIndex : 0;
    goLive(i);
  }, [previewIndex, goLive]);

  const next = useCallback(() => {
    const i = liveRef.current;
    goLive(i < 0 ? 0 : Math.min(i + 1, slidesRef.current.length - 1));
  }, [goLive]);

  const prev = useCallback(() => {
    const i = liveRef.current;
    goLive(i < 0 ? 0 : Math.max(i - 1, 0));
  }, [goLive]);

  const previewNext = useCallback(() => {
    setPreviewIndex((p) => Math.min((p < 0 ? -1 : p) + 1, slidesRef.current.length - 1));
  }, []);
  const previewPrev = useCallback(() => {
    setPreviewIndex((p) => Math.max((p < 0 ? 0 : p) - 1, 0));
  }, []);

  const blank = useCallback(() => {
    setStatus("blank");
    publishAt(liveRef.current, "blank");
  }, [publishAt]);

  const clear = useCallback(() => {
    liveIdRef.current = null;
    setStatus("clear");
    setLiveIndex(-1);
    publishAt(-1, "clear");
  }, [publishAt]);

  /**
   * Re-publish the live slide when its own content or the theme changes, so
   * editing lyrics or changing a background updates the screen without the
   * operator re-sending. The live slide is re-located BY ID.
   *
   * If that id is no longer in the list, the live slide is simply not part of
   * what is loaded any more - a different song was selected, or the operator
   * moved to another tab. There is deliberately nothing to publish then: the
   * output keeps showing what it was already showing until someone actually
   * sends something. Falling back to "whatever now sits at the old index"
   * (which this used to do) meant switching tab or picking another song
   * broadcast a slide nobody chose - clicking a song, image or deck put it
   * straight on the screen with no GO LIVE, which is precisely the mistake
   * the preview/live split exists to prevent.
   */
  useEffect(() => {
    if (status === "live" && liveIdRef.current) {
      const idx = locateLiveSlide(slides, liveIdRef.current);
      if (idx < 0) return;
      // Switching Bible version re-keys the slide, so keep the id in step or
      // the next change would no longer find it.
      liveIdRef.current = slides[idx].slideId;
      if (idx !== liveRef.current) setLiveIndex(idx);
      publishAt(idx, "live");
    } else if (status === "blank") {
      publishAt(liveRef.current, "blank");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides, theme]);

  const previewSlide = useMemo(
    () => (previewIndex >= 0 && previewIndex < slides.length ? slides[previewIndex] : null),
    [previewIndex, slides],
  );

  /**
   * Send what is cued in Preview to a screen other than the main one.
   *
   * Deliberately separate from goLive: the operator's transport, the Live
   * column and the slide index all describe the MAIN output, and a second
   * screen showing a flyer should not move when they press Next. So this
   * publishes to that screen's channel and changes nothing else - the main
   * output, the stage display and the operator's own state are untouched.
   */
  const sendToScreen = useCallback((screenId: string, index?: number) => {
    const list = slidesRef.current;
    const i = index ?? previewIndex;
    const slide = i >= 0 && i < list.length ? list[i] : null;
    if (!slide) return false;
    publishLive(stageToState(slide, "live", themeRef.current), screenId);
    return true;
  }, [previewIndex]);

  /** Blank or clear one screen without touching the others. */
  const setScreenStatus = useCallback((screenId: string, st: "blank" | "clear") => {
    publishLive(stageToState(null, st, themeRef.current), screenId);
  }, []);

  return {
    slides, previewIndex, liveIndex, status, previewSlide,
    preview, sendLive, goLive, next, prev, previewNext, previewPrev, blank, clear,
    sendToScreen, setScreenStatus,
  };
}
