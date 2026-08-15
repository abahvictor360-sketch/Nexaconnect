import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { liveBus, DEFAULT_THEME, type LiveTheme } from "../lib/live-bus";
import { buildRenderList, type Slide, type SectionInput, type PaginatorMode } from "../lib/paginator";
import type { FullSongResponse } from "./use-songs";

export type LiveController = ReturnType<typeof useLiveController>;

/**
 * Owns the flat render list for the current song's arrangement and the live
 * pointer. Publishes slide/blank/clear state to the projector via liveBus.
 * Manual override always wins - every action is a direct call.
 */
export function useLiveController(opts: {
  song: FullSongResponse | null;
  orderedSectionIds: string[]; // arrangement order (repeats allowed)
  linesPerSlide: number;
  mode: PaginatorMode;
  dualLanguage: boolean;
  theme: LiveTheme;
  /** sectionId -> secondary-language lyrics, for dual-language display. */
  translations?: Map<string, string>;
}) {
  const { song, orderedSectionIds, linesPerSlide, mode, dualLanguage, theme, translations } = opts;
  const [liveIndex, setLiveIndex] = useState<number>(-1); // -1 = nothing live
  const [status, setStatus] = useState<"idle" | "live" | "blank" | "clear">("idle");
  const liveIndexRef = useRef(liveIndex);
  liveIndexRef.current = liveIndex;

  const sectionMap = useMemo(() => {
    const m = new Map<string, FullSongResponse["sections"][number]>();
    song?.sections.forEach((s) => m.set(s.id, s));
    return m;
  }, [song]);

  const slides: Slide[] = useMemo(() => {
    if (!song) return [];
    const ordered: SectionInput[] = orderedSectionIds
      .map((id) => sectionMap.get(id))
      .filter(Boolean)
      .map((s) => ({
        id: s!.id,
        label: s!.label,
        type: s!.type,
        lyrics: s!.lyrics,
        manualBreaks: s!.manualBreaks ? (JSON.parse(s!.manualBreaks) as number[]) : null,
        translationLyrics: translations?.get(s!.id) ?? null,
      }));
    return buildRenderList(ordered, { linesPerSlide, mode, dualLanguage });
  }, [song, orderedSectionIds, sectionMap, linesPerSlide, mode, dualLanguage, translations]);

  const publish = useCallback(
    (index: number, st: "live" | "blank" | "clear" | "idle") => {
      const bus = liveBus();
      const slide = index >= 0 && index < slides.length ? slides[index] : null;
      const full = bus.publish({
        status: st,
        sourceLines: st === "live" && slide ? slide.sourceLines : [],
        translationLines: st === "live" && slide ? slide.translationLines : [],
        sectionLabel: slide?.sectionLabel ?? "",
        songTitle: song?.song.title ?? "",
        slideId: slide?.id ?? null,
        slideIndex: index,
        slideCount: slides.length,
        theme,
      });
      // Mirror to the server so out-of-process clients (OBS browser-source,
      // stream page, NDI bridge) stay in sync - they can't see BroadcastChannel.
      try {
        fetch("/api/live/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(full),
          keepalive: true,
        }).catch(() => {});
      } catch {
        /* ignore */
      }
    },
    [slides, song, theme],
  );

  const goLive = useCallback(
    (index: number) => {
      if (index < 0 || index >= slides.length) return;
      setLiveIndex(index);
      setStatus("live");
      publish(index, "live");
    },
    [slides.length, publish],
  );

  const next = useCallback(() => {
    const i = liveIndexRef.current;
    const target = i < 0 ? 0 : Math.min(i + 1, slides.length - 1);
    goLive(target);
  }, [slides.length, goLive]);

  const prev = useCallback(() => {
    const i = liveIndexRef.current;
    const target = i < 0 ? 0 : Math.max(i - 1, 0);
    goLive(target);
  }, [goLive]);

  const blank = useCallback(() => {
    setStatus("blank");
    publish(liveIndexRef.current, "blank");
  }, [publish]);

  const clear = useCallback(() => {
    setStatus("clear");
    setLiveIndex(-1);
    publish(-1, "clear");
  }, [publish]);

  // Re-publish current slide when live-affecting options change (lines/theme/dual).
  useEffect(() => {
    if (status === "live" && liveIndexRef.current >= 0) {
      // slide content may have shifted; clamp index.
      const clamped = Math.min(liveIndexRef.current, Math.max(0, slides.length - 1));
      if (clamped !== liveIndexRef.current) setLiveIndex(clamped);
      publish(clamped, "live");
    } else if (status === "blank") {
      publish(liveIndexRef.current, "blank");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides, theme]);

  return { slides, liveIndex, status, goLive, next, prev, blank, clear };
}
