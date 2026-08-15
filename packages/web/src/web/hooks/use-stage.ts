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

  // Re-publish live slide when content or theme changes (e.g. bg / lines /
  // version / tab switch). Re-locate the live slide by its id so a changed
  // slide list keeps the SAME verse/lyric on the projector.
  useEffect(() => {
    if (status === "live" && liveIdRef.current) {
      let idx = slides.findIndex((s) => s.slideId === liveIdRef.current);
      if (idx < 0) idx = Math.min(Math.max(liveRef.current, 0), slides.length - 1);
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

  return {
    slides, previewIndex, liveIndex, status, previewSlide,
    preview, sendLive, goLive, next, prev, previewNext, previewPrev, blank, clear,
  };
}
