import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Search, Plus, Upload, Music4, Pencil, Trash2, Monitor, MonitorX,
  ChevronLeft, ChevronRight, Square, Ban, Settings2, Repeat, X, Clapperboard,
  Image as ImageIcon, Radio, Languages, Ear, Copy, Check, Film, Palette, Link2, Loader2, Rocket,
  BookOpen, SendHorizontal, Eye, MonitorSmartphone, Smartphone, NotebookPen,
  ListChecks, ArrowUp, ArrowDown, CalendarDays, PlayCircle, GripVertical, History,
  Mic, HelpCircle, Mail, Download, MonitorPlay,
} from "lucide-react";
import { api } from "../lib/api";
import { VButton, SectionChip, Spinner } from "../components/bits";
import { PresentationsPanel } from "../components/presentation-panel";
import { SlideRender } from "../components/slide-render";
import { SongEditor } from "../components/song-editor";
import { ImportModal } from "../components/import-modal";
import { BiblePanel } from "../components/bible-panel";
import { useSongList, useFullSong, useThemes, type SongListItem } from "../hooks/use-songs";
import { useSettings, useUpdateSettings, type AppSettings, type ThemeOverride } from "../hooks/use-settings";
import { SettingsPage, type SectionId as SettingsSectionId } from "../components/settings-page";
import { MediaLibrary } from "../components/media-library";
import { WelcomeDialog } from "../components/welcome-dialog";
import { SermonPanel } from "../components/sermon-panel";
import { matchAction, resolveShortcuts } from "../lib/shortcuts";
import { CapturePicker } from "../components/capture";
import { CaptureStage } from "../components/capture-stage";
import { useLiveController } from "../hooks/use-live-controller";
import { useStage, type StageController } from "../hooks/use-stage";
import { useLiveState } from "../hooks/use-live";
import { useDesktop } from "../hooks/use-desktop";
import { useNetworkOrigin } from "../hooks/use-network-origin";
import { useUpdateCheck } from "../hooks/use-update-check";
import { UpdateDialog } from "../components/update-dialog";
import { useMedia, useAddMediaUrl, useDeleteMedia, useUploadMedia, type MediaItem } from "../hooks/use-media";
import { useTranslations, useSaveTranslation, LANGS, langLabel } from "../hooks/use-translations";
import { useAutoFollow } from "../hooks/use-autofollow";
import {
  usePlaylists, usePlaylist, useCreatePlaylist, useRenamePlaylist,
  useDeletePlaylist, useSavePlaylistItems,
  type DraftItem, type PlaylistItemType,
} from "../hooks/use-playlists";
import { useBibleManifest, parseReference, searchVersion, type SearchHit } from "../hooks/use-bible";
import { DEFAULT_THEME, liveBus, type LiveTheme, type LiveBackground, type LiveState, type LiveCapture } from "../lib/live-bus";
import { stageToState, type StageSlide } from "../lib/stage";
import { publishStageDisplay } from "../lib/stage-display";
import { loadHistory, recordHistory, clearHistory, type LiveHistoryEntry } from "../lib/history";
import type { Slide } from "../lib/paginator";
import type { DisplayInfo } from "../lib/desktop";

/** Operator top-level content mode - the tabs shown in the top bar. */
type OperatorMode = "lyrics" | "bible" | "presentation" | "sermon" | "plans" | "history";

function themeToLive(t: Record<string, unknown> | undefined): LiveTheme {
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

/**
 * Layer operator overrides (from Settings) over a base theme.
 * undefined = inherit; fontSize null = explicit auto-fit.
 */
function mergeOverride(base: LiveTheme, o: ThemeOverride | null | undefined): LiveTheme {
  if (!o) return base;
  return {
    ...base,
    bgColor: o.bgColor ?? base.bgColor,
    textColor: o.textColor ?? base.textColor,
    textAlign: o.textAlign ?? base.textAlign,
    fontWeight: o.fontWeight ?? base.fontWeight,
    fontSize: o.fontSize === undefined ? base.fontSize : o.fontSize,
    fontFamily: o.fontFamily ?? base.fontFamily,
    displayMode: o.displayMode ?? base.displayMode,
    verticalPos: o.verticalPos ?? base.verticalPos,
    captionColor: o.referenceColor ?? base.captionColor ?? null,
    translationColor: o.translationColor ?? base.translationColor ?? null,
    textShadow: o.textShadow === undefined ? base.textShadow : o.textShadow,
  };
}

/**
 * Shared projector open/close/status + live display list. Used by both the
 * Projector panel and the preview/live right-click menu so there's a single
 * IPC subscription instead of each caller managing its own.
 */
function useProjector(
  desktop: ReturnType<typeof useDesktop>,
  outputDisplayId: number | null | undefined,
  autoProjector: boolean,
) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [justDetected, setJustDetected] = useState(false);
  const knownCountRef = useRef<number | null>(null);
  // Set when the operator closes the output themselves. Auto-open must not
  // fight them: having the projector reappear a moment after you deliberately
  // shut it off, mid-service, is worse than never opening it at all. Cleared
  // when the screens change, since plugging a projector back in is a fresh
  // instruction.
  const dismissedRef = useRef(false);

  useEffect(() => {
    if (!desktop) return;
    desktop.listDisplays().then((d) => {
      setDisplays(d);
      knownCountRef.current = d.length;
    }).catch(() => {});
    desktop.projectorStatus().then((s) => setOpen(s.open)).catch(() => {});
    const offState = desktop.onProjectorState((s) => setOpen(s.open));
    // A monitor plugged/unplugged mid-service updates the picker live - no
    // app restart needed. Flash a brief hint when the count grows.
    const offDisplays = desktop.onDisplaysChanged((next) => {
      if (knownCountRef.current !== null && next.length !== knownCountRef.current) {
        // Any change to what is plugged in resets the operator's "I closed
        // this on purpose" state, so a projector connected later still opens.
        dismissedRef.current = false;
        if (next.length > knownCountRef.current) {
          setJustDetected(true);
          setTimeout(() => setJustDetected(false), 4000);
        }
      }
      knownCountRef.current = next.length;
      setDisplays(next);
    });
    return () => {
      offState();
      offDisplays();
    };
  }, [desktop]);

  /**
   * Open the output. Pass a display id to send it to a specific screen,
   * overriding the one configured in Settings - that is what "send it to this
   * screen" in the projector settings does.
   */
  const openProjector = useCallback(
    async (displayId?: number) => {
      if (!desktop) {
        window.open("/#/projector", "vifug-projector", "width=960,height=540");
        setOpen(true);
        return;
      }
      dismissedRef.current = false;
      await desktop.openProjector({
        displayId: displayId ?? outputDisplayId ?? undefined,
        fullscreen: true,
      });
      setOpen(true);
    },
    [desktop, outputDisplayId],
  );

  const closeProjector = useCallback(async () => {
    dismissedRef.current = true;
    if (desktop) await desktop.closeProjector();
    setOpen(false);
  }, [desktop]);

  /**
   * The screen the output belongs on: the one chosen in Settings if it is
   * still plugged in, otherwise the first display that is not the operator's
   * own. Returns null when this machine has only one screen - putting the
   * output fullscreen over the operator's controls would be sabotage.
   */
  const targetDisplay = useMemo(() => {
    const chosen = outputDisplayId != null ? displays.find((d) => d.id === outputDisplayId) : undefined;
    return chosen ?? displays.find((d) => !d.isPrimary) ?? null;
  }, [displays, outputDisplayId]);

  // Put the output on a second screen as soon as one is there. A projector
  // plugged into a church laptop is always meant for projecting, so making
  // someone find a button first is a step that never had a reason to exist.
  useEffect(() => {
    if (!desktop || !autoProjector) return;
    if (open || dismissedRef.current || !targetDisplay) return;
    let cancelled = false;
    (async () => {
      try {
        await desktop.openProjector({ displayId: targetDisplay.id, fullscreen: true });
        if (!cancelled) setOpen(true);
      } catch {
        // A display can disappear between being listed and being opened on.
        // The next displays:changed will try again.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [desktop, autoProjector, open, targetDisplay]);

  // One keypress that both opens and closes the output - an operator hitting
  // the projector shortcut mid-service means "get it off/on screen now".
  const toggle = useCallback(async () => {
    if (open) await closeProjector();
    else await openProjector();
  }, [open, openProjector, closeProjector]);

  return { displays, open, justDetected, targetDisplay, openProjector, closeProjector, toggle };
}

export default function OperatorPage() {
  const qc = useQueryClient();
  const desktop = useDesktop();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState<false | "new" | "edit">(false);
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("lyrics");
  const [mediaOpen, setMediaOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [translateOpen, setTranslateOpen] = useState(false);
  const [screenMenu, setScreenMenu] = useState<{ x: number; y: number } | null>(null);

  const songs = useSongList(search);
  const full = useFullSong(selectedId);
  const themes = useThemes();
  const settingsQ = useSettings();
  const updateSettings = useUpdateSettings();
  const settings = settingsQ.data;
  const projector = useProjector(
    desktop,
    settings?.output.displayId,
    settings?.output.autoProjector ?? true,
  );
  // The OBS/vMix browser-source address. Same-origin: OBS is usually on this
  // machine, and Settings lists the LAN addresses for a separate stream PC.
  const streamUrl = typeof window !== "undefined" ? `${window.location.origin}/#/stream` : "/#/stream";
  const update = useUpdateCheck(desktop);
  // The menu listener is registered once against `desktop`, so it reads the
  // current handler through a ref rather than capturing a stale closure -
  // the same pattern the remote's command listener uses below.
  const checkUpdatesRef = useRef(update.checkNow);
  checkUpdatesRef.current = update.checkNow;
  const shortcutMap = useMemo(() => resolveShortcuts(settings?.shortcuts), [settings?.shortcuts]);

  // File/View/Help menu actions (desktop app only) - main.ts owns the menu
  // bar itself, the renderer owns what each action actually does.
  useEffect(() => {
    if (!desktop?.onMenuAction) return;
    return desktop.onMenuAction((action) => {
      if (action === "new-song") setEditorOpen("new");
      else if (action === "import") setImportOpen(true);
      else if (action === "settings" || action === "about") {
        setSettingsSection(action === "about" ? "about" : "lyrics");
        setSettingsOpen(true);
      }
      else if (action === "media" || action === "media-add") setMediaOpen(true);
      else if (action === "capture") setCaptureOpen(true);
      else if (action === "check-updates") checkUpdatesRef.current();
    });
  }, [desktop]);

  // Phase 2 data
  const media = useMedia();
  const translationsQ = useTranslations(selectedId);

  // Arrangement order (section ids, repeats allowed) - starts from default arrangement.
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => {
    if (full.data) {
      const def = full.data.arrangements.find((a) => a.arrangement.isDefault) ?? full.data.arrangements[0];
      const ids = def ? def.items.map((i) => i.sectionId) : full.data.sections.map((s) => s.id);
      setOrder(ids);
    }
  }, [full.data]);

  // Resolve the active background media into a LiveBackground for the theme.
  const activeBackground = useMemo<LiveBackground>(() => {
    const id = settings?.activeBackgroundId;
    if (!id) return null;
    const m = media.data?.find((x) => x.id === id);
    if (!m) return null;
    const fit = m.fit === "contain" || m.fit === "fill" ? m.fit : "cover";
    return { type: m.type, url: m.url, fit, loop: !!m.loop, muted: m.muted !== 0 };
  }, [settings?.activeBackgroundId, media.data]);

  const activeTheme = useMemo(() => {
    const t = themes.data?.find((x) => x.id === settings?.activeThemeId) ?? themes.data?.[0];
    const base = mergeOverride(themeToLive(t as Record<string, unknown> | undefined), settings?.lyricTheme);
    return { ...base, background: activeBackground };
  }, [themes.data, settings?.activeThemeId, settings?.lyricTheme, activeBackground]);

  // Per-song look: a song can carry its own theme/background/text color,
  // layered over the app theme the same way Bible/Presentation overrides
  // are - unset fields on the song still inherit app-wide settings. Only
  // affects the Lyrics tab; Bible and Presentations keep using activeTheme.
  const songTheme = useMemo<LiveTheme>(() => {
    const song = full.data?.song;
    if (!song || (!song.themeId && !song.backgroundId && !song.textColor)) return activeTheme;
    let base = activeTheme;
    if (song.themeId) {
      const t = themes.data?.find((x) => x.id === song.themeId);
      if (t) base = mergeOverride(themeToLive(t as Record<string, unknown>), settings?.lyricTheme);
    }
    let background = base.background;
    if (song.backgroundId) {
      const m = media.data?.find((x) => x.id === song.backgroundId);
      if (m) {
        const fit = m.fit === "contain" || m.fit === "fill" ? m.fit : "cover";
        background = { type: m.type, url: m.url, fit, loop: !!m.loop, muted: m.muted !== 0 };
      }
    }
    return { ...base, background, textColor: song.textColor || base.textColor };
  }, [full.data?.song, activeTheme, themes.data, settings?.lyricTheme, media.data]);

  const linesPerSlide = settings?.linesPerSlide ?? 2;
  const dualLanguage = settings?.dualLanguage ?? false;
  const secondaryLang = settings?.secondaryLang ?? null;

  // sectionId -> secondary-language lyrics for the current song.
  const translationMap = useMemo(() => {
    const m = new Map<string, string>();
    if (secondaryLang && translationsQ.data) {
      for (const tr of translationsQ.data) {
        if (tr.lang === secondaryLang && tr.lyrics.trim()) m.set(tr.sectionId, tr.lyrics);
      }
    }
    return m;
  }, [secondaryLang, translationsQ.data]);

  // Operator mode: drive the live output from song lyrics OR the Bible.
  // "plans" is a service-plan builder that cues songs/scripture into lyrics/bible.
  const [mode, setMode] = useState<OperatorMode>("lyrics");
  // Bible cue: set when a plan item cues a scripture into the Bible panel.
  const [bibleCue, setBibleCue] = useState<{ versionId?: string; ref: string; nonce: number } | null>(null);

  // Lyric slides come from the paginator (via the controller). We use it purely
  // as a slide *source* now; all live control flows through the shared stage.
  const ctrl = useLiveController({
    song: full.data ?? null,
    orderedSectionIds: order,
    linesPerSlide,
    mode: "fixed",
    dualLanguage: dualLanguage && !!secondaryLang,
    theme: songTheme,
    translations: translationMap,
  });

  const songTitle = full.data?.song.title ?? "";
  const lyricStageSlides = useMemo<StageSlide[]>(
    () =>
      ctrl.slides.map((s, i) => ({
        kind: "lyric",
        sourceLines: s.sourceLines,
        translationLines: s.translationLines,
        caption: s.sectionLabel,
        title: songTitle,
        slideId: s.id,
        slideIndex: i,
        slideCount: ctrl.slides.length,
        sourceRuns: s.sourceRuns,
        textAlign: s.textAlign,
      })),
    [ctrl.slides, songTitle],
  );

  // Bible slides are lifted up from the BiblePanel (current chapter or search).
  const [bibleSlides, setBibleSlides] = useState<StageSlide[]>([]);

  // Scripture-only background: undefined = share the lyric background,
  // null = explicitly plain, media id = that background.
  const bibleBackground = useMemo<LiveBackground>(() => {
    const id = settings?.bibleBackgroundId;
    if (!id) return null;
    const m = media.data?.find((x) => x.id === id);
    if (!m) return null;
    const fit = m.fit === "contain" || m.fit === "fill" ? m.fit : "cover";
    return { type: m.type, url: m.url, fit, loop: !!m.loop, muted: m.muted !== 0 };
  }, [settings?.bibleBackgroundId, media.data]);

  // Bible theme = active lyric theme with per-display Bible overrides merged in.
  // Bible slides always show the scripture reference caption on the output.
  const bibleTheme = useMemo<LiveTheme>(
    () => ({
      ...mergeOverride(activeTheme, settings?.bibleTheme),
      ...(settings?.bibleBackgroundId !== undefined ? { background: bibleBackground } : {}),
      showCaption: true,
    }),
    [activeTheme, settings?.bibleTheme, settings?.bibleBackgroundId, bibleBackground],
  );

  // Presentation slides are lifted up from PresentationsPanel; each slide
  // carries its OWN background (image/video/color), so the theme here only
  // supplies text look - stage.ts layers the per-slide background on top.
  const [presentationSlides, setPresentationSlides] = useState<StageSlide[]>([]);
  const [sermonSlides, setSermonSlides] = useState<StageSlide[]>([]);
  /** Camera/screen chosen but not yet sent out; shown in the preview column. */
  const [pendingCapture, setPendingCapture] = useState<LiveCapture>(null);
  const presentationTheme = useMemo<LiveTheme>(
    () => mergeOverride(activeTheme, settings?.presentationTheme),
    [activeTheme, settings?.presentationTheme],
  );

  // Sermon slides ride the presentation theme: both are prose on a plain
  // backdrop rather than song lines, so they should look the same on screen.
  const stageSlides =
    mode === "bible" ? bibleSlides
    : mode === "presentation" ? presentationSlides
    : mode === "sermon" ? sermonSlides
    : lyricStageSlides;
  // Sermons force the caption on: the section label IS the structure of the
  // message ("Topic", "Point 2"), and a congregation reading a bare line has
  // no idea where in the sermon it sits. Lyrics leave it optional because
  // "Verse 1" tells the room nothing it needs.
  const sermonTheme = useMemo<LiveTheme>(
    () => ({ ...presentationTheme, showCaption: true }),
    [presentationTheme],
  );
  const stageTheme =
    mode === "bible" ? bibleTheme
    : mode === "sermon" ? sermonTheme
    : mode === "presentation" ? presentationTheme
    : songTheme;
  const stage = useStage({ slides: stageSlides, theme: stageTheme });

  const liveState = useLiveState();

  // Service notes shown on the stage/confidence display.
  const [stageNotes, setStageNotes] = useState("");

  // --- Stage display: mirror current + next slide + notes to /#/stage ---
  useEffect(() => {
    const current =
      stage.status === "live" && stage.liveIndex >= 0 ? stage.slides[stage.liveIndex] ?? null : null;
    const next =
      stage.liveIndex >= 0 && stage.liveIndex + 1 < stage.slides.length
        ? stage.slides[stage.liveIndex + 1]
        : null;
    publishStageDisplay({
      status: stage.status,
      current,
      next,
      notes: stageNotes,
      mode,
    });
  }, [stage.status, stage.liveIndex, stage.slides, stageNotes, mode]);

  // --- Remote control: execute commands from /#/remote over SSE ---
  const stageRef = useRef<StageController>(stage);
  stageRef.current = stage;

  // Next/Prev behavior: live-immediately (default) or cue-then-Enter.
  const advanceGoesLive = settings?.advanceGoesLive ?? true;
  const advanceGoesLiveRef = useRef(advanceGoesLive);
  advanceGoesLiveRef.current = advanceGoesLive;
  const advanceNext = () => (advanceGoesLiveRef.current ? stageRef.current.next() : stageRef.current.previewNext());
  const advancePrev = () => (advanceGoesLiveRef.current ? stageRef.current.prev() : stageRef.current.previewPrev());
  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      es = new EventSource("/api/remote/stream");
      es.addEventListener("command", (e) => {
        try {
          const cmd = JSON.parse((e as MessageEvent).data) as { action: string; index?: number };
          const s = stageRef.current;
          switch (cmd.action) {
            case "next": if (advanceGoesLiveRef.current) s.next(); else s.previewNext(); break;
            case "prev": if (advanceGoesLiveRef.current) s.prev(); else s.previewPrev(); break;
            case "sendLive": sendLiveRef.current(); break;
            case "goLive": if (typeof cmd.index === "number") s.goLive(cmd.index); break;
            case "blank": s.blank(); break;
            case "clear": s.clear(); break;
          }
        } catch {
          /* ignore */
        }
      });
      es.onerror = () => {
        es?.close();
        if (!stopped) setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      stopped = true;
      es?.close();
    };
  }, []);

  // The preview monitor renders the CUED slide (not yet live) with its theme.
  // A chosen camera/screen is cued here too rather than going straight out:
  // pointing a capture card at the congregation before checking the framing is
  // exactly the mistake the preview column exists to prevent.
  const previewState = useMemo<LiveState>(
    () => ({
      ...stageToState(stage.previewSlide, stage.previewSlide ? "live" : "idle", stageTheme),
      capture: pendingCapture,
      rev: 0,
    }),
    [stage.previewSlide, stageTheme, pendingCapture],
  );

  /**
   * Sending live also commits whatever capture is cued, so one action moves
   * both the words and the video. Clearing `pendingCapture` afterwards keeps
   * the preview column showing what is cued NEXT, not what just went out.
   */
  const sendLive = useCallback(() => {
    if (pendingCapture) {
      liveBus().setCapture(pendingCapture);
      setPendingCapture(null);
    }
    stage.sendLive();
  }, [pendingCapture, stage]);

  // The remote's command listener is registered once, so it reads the current
  // handler through a ref rather than capturing a stale closure.
  const sendLiveRef = useRef(sendLive);
  sendLiveRef.current = sendLive;

  // AI auto-follow - advances the LIVE slide by listening to the room. Manual
  // override always wins: it calls the same stage.goLive the operator uses.
  const autoFollow = useAutoFollow({
    slides: stage.slides,
    currentIndex: stage.liveIndex,
    onAdvanceTo: (i) => stage.goLive(i),
    threshold: settings?.autoFollowThreshold ?? 0.34,
    lookahead: settings?.autoFollowLookahead ?? 3,
    inputDeviceId: settings?.audio?.inputDeviceId ?? null,
  });
  const autoFollowOn = settings?.autoFollow ?? false;
  useEffect(() => {
    if (autoFollowOn && stage.status === "live") autoFollow.start();
    else autoFollow.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFollowOn, stage.status]);

  // --- Keyboard control (ProPresenter-style: preview then send) ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (editorOpen || importOpen || settingsOpen || translateOpen || screenMenu) return;
      if (mediaOpen || captureOpen) return;
      const action = matchAction(e, shortcutMap);
      if (!action) return;
      e.preventDefault();
      if (action === "next") advanceNext();
      else if (action === "prev") advancePrev();
      else if (action === "goLive") sendLive();
      else if (action === "blank") stage.blank();
      else if (action === "clear") stage.clear();
      else if (action === "projector") projector.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, editorOpen, importOpen, settingsOpen, translateOpen, screenMenu, mediaOpen, captureOpen, shortcutMap, projector]);

  // Close the preview/live right-click menu on outside click or Escape.
  useEffect(() => {
    if (!screenMenu) return;
    const close = () => setScreenMenu(null);
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };

    // The pointer listeners are attached on the next tick, not immediately.
    // This effect runs as a result of the very right-click that opened the
    // menu, and that event is still on its way up to window - registering
    // synchronously means the opening click also closes it, so the menu never
    // appears at all. Escape has no such problem and is bound straight away.
    const armed = setTimeout(() => {
      window.addEventListener("click", close);
      window.addEventListener("contextmenu", close);
    }, 0);
    window.addEventListener("keydown", onEsc);

    return () => {
      clearTimeout(armed);
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onEsc);
    };
  }, [screenMenu]);

  const patchSettings = (patch: Partial<AppSettings>) => {
    if (!settings) return;
    updateSettings.mutate({ ...settings, ...patch });
  };

  // --- Service plan cueing: load an item into the correct tab, ready to send ---
  const cueSong = useCallback((songId: string) => {
    setSelectedId(songId);
    setMode("lyrics");
  }, []);
  const cueScripture = useCallback((ref: string, versionId?: string) => {
    setMode("bible");
    setBibleCue({ ref, versionId, nonce: Date.now() });
  }, []);

  // --- Live history: every song / passage that reaches the live output ---
  const [history, setHistory] = useState<LiveHistoryEntry[]>(() => loadHistory());
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  useEffect(() => {
    if (stage.status !== "live" || stage.liveIndex < 0) return;
    const s = stage.slides[stage.liveIndex];
    if (!s) return;
    if (s.kind === "lyric") {
      const songId = selectedIdRef.current;
      if (!songId || !s.title) return;
      setHistory((h) => recordHistory(h, { kind: "lyric", title: s.title, caption: "", songId }));
    } else {
      // slideId is `${versionId}-${bookCode}-${chapter}-${verse}`
      const versionId = s.slideId?.split("-")[0];
      if (!s.caption) return;
      setHistory((h) =>
        recordHistory(h, { kind: "bible", title: s.title, caption: s.caption, ref: s.caption, versionId }),
      );
    }
  }, [stage.status, stage.liveIndex, stage.slides]);

  const recallHistory = useCallback(
    (e: LiveHistoryEntry) => {
      if (e.kind === "lyric" && e.songId) cueSong(e.songId);
      else if (e.kind === "bible" && e.ref) cueScripture(e.ref, e.versionId);
    },
    [cueSong, cueScripture],
  );

  const deleteSong = async (id: string) => {
    await api.songs[":id"].$delete({ param: { id } });
    if (selectedId === id) setSelectedId(null);
    qc.invalidateQueries({ queryKey: ["songs"] });
  };

  const saveArrangement = useCallback(
    async (ids: string[]) => {
      if (!selectedId) return;
      await api.songs[":id"].arrangement.$put({ param: { id: selectedId }, json: { sectionIds: ids } });
    },
    [selectedId],
  );

  // section repeat / remove from arrangement
  const repeatSection = (idx: number) => {
    setOrder((prev) => {
      const next = [...prev];
      next.splice(idx + 1, 0, prev[idx]);
      saveArrangement(next);
      return next;
    });
  };
  const removeFromArrangement = (idx: number) => {
    setOrder((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      saveArrangement(next);
      return next;
    });
  };
  const moveInArrangement = (idx: number, dir: -1 | 1) => {
    setOrder((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      saveArrangement(next);
      return next;
    });
  };

  return (
    <div className="flex h-screen flex-col bg-[var(--v-bg)] text-[var(--v-text)]">
      <TopBar
        desktop={desktop}
        liveStatus={liveState.status}
        onSettings={() => {
          setSettingsSection("lyrics");
          setSettingsOpen(true);
        }}
        onMedia={() => setMediaOpen(true)}
        update={update}
        mode={mode}
        onModeChange={setMode}
      />

      <div className="flex min-h-0 flex-1">
        {/* LEFT: the song library, which belongs to Lyrics only. Every other
            mode carries its own list (sermons, decks, plans, history), so
            leaving this mounted showed songs you cannot use and stole 288px
            from the panel that actually needed the room. */}
        {mode === "lyrics" && (
        <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--v-border)] bg-[var(--v-surface)]">
          <div className="border-b border-[var(--v-border)] p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--v-text-faint)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search library…"
                className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] py-2 pl-8 pr-3 text-sm outline-none focus:border-[var(--v-accent)]"
              />
            </div>
            <div className="mt-2 flex gap-2">
              <VButton variant="subtle" size="sm" className="flex-1" onClick={() => setEditorOpen("new")}>
                <Plus className="h-4 w-4" /> New
              </VButton>
              <VButton variant="subtle" size="sm" className="flex-1" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" /> Import
              </VButton>
            </div>
          </div>

          <div className="v-scroll min-h-0 flex-1 overflow-y-auto p-2">
            {songs.isLoading && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--v-text-faint)]">
                <Spinner /> Loading…
              </div>
            )}
            {songs.data?.length === 0 && (
              <p className="px-2 py-8 text-center text-sm text-[var(--v-text-faint)]">No songs found.</p>
            )}
            <ul className="space-y-0.5">
              {songs.data?.map((s) => (
                <SongRow
                  key={s.id}
                  song={s}
                  active={s.id === selectedId}
                  onSelect={() => setSelectedId(s.id)}
                  onDelete={() => deleteSong(s.id)}
                />
              ))}
            </ul>
          </div>
          <div className="border-t border-[var(--v-border)] px-3 py-2 text-[11px] text-[var(--v-text-faint)]">
            {songs.data?.length ?? 0} songs in library
          </div>
        </aside>
        )}

        {/* CENTER: arrangement / slide grid OR Bible browser - mode tabs now live in the top bar */}
        <main className="flex min-w-0 flex-1 flex-col">
          {mode === "history" ? (
            <HistoryPanel entries={history} onRecall={recallHistory} onClear={() => setHistory(clearHistory())} />
          ) : mode === "plans" ? (
            <PlansPanel onCueSong={cueSong} onCueScripture={cueScripture} />
          ) : mode === "bible" ? (
            <BiblePanel
              onSlidesChange={setBibleSlides}
              onPreview={(i) => stage.preview(i)}
              onSendLive={(i) => stage.goLive(i)}
              previewId={stage.previewSlide?.slideId ?? null}
              liveId={stage.status === "live" && stage.liveIndex >= 0 ? stage.slides[stage.liveIndex]?.slideId ?? null : null}
              langs={settings?.bibleLangs ?? { yor: true, hau: true, ibo: true }}
              cue={bibleCue}
            />
          ) : mode === "presentation" ? (
            <PresentationsPanel
              onSlidesChange={setPresentationSlides}
              onPreview={(i) => stage.preview(i)}
              onSendLive={(i) => stage.goLive(i)}
              previewId={stage.previewSlide?.slideId ?? null}
              liveId={stage.status === "live" && stage.liveIndex >= 0 ? stage.slides[stage.liveIndex]?.slideId ?? null : null}
            />
          ) : mode === "sermon" ? (
            <SermonPanel
              onSlidesChange={setSermonSlides}
              onPreview={(i) => stage.preview(i)}
              onSendLive={(i) => stage.goLive(i)}
              previewId={stage.previewSlide?.slideId ?? null}
              liveId={stage.status === "live" && stage.liveIndex >= 0 ? stage.slides[stage.liveIndex]?.slideId ?? null : null}
            />
          ) : (
            <>
              {!selectedId && <EmptyState />}
              {selectedId && full.isLoading && (
                <div className="flex flex-1 items-center justify-center gap-2 text-[var(--v-text-faint)]">
                  <Spinner /> Loading song…
                </div>
              )}
              {selectedId && full.data && (
                <>
                  <div className="flex items-center justify-between border-b border-[var(--v-border)] px-5 py-3">
                    <div className="min-w-0">
                      <h1 className="truncate font-display text-lg font-semibold">{full.data.song.title}</h1>
                      <p className="truncate text-xs text-[var(--v-text-faint)]">
                        {full.data.song.authors ? (JSON.parse(full.data.song.authors) as string[]).join(", ") : "-"}
                        {full.data.song.ccliNumber ? ` · CCLI ${full.data.song.ccliNumber}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <VButton variant="subtle" size="sm" onClick={() => setTranslateOpen(true)}>
                        <Languages className="h-4 w-4" /> Translate
                      </VButton>
                      <VButton variant="subtle" size="sm" onClick={() => setEditorOpen("edit")}>
                        <Pencil className="h-4 w-4" /> Edit
                      </VButton>
                    </div>
                  </div>

                  <div className="v-scroll min-h-0 flex-1 overflow-y-auto p-5">
                    <SlideGrid
                      slides={lyricStageSlides}
                      stage={stage}
                      order={order}
                      onRepeat={repeatSection}
                      onRemove={removeFromArrangement}
                      onMove={moveInArrangement}
                      song={full.data}
                      rawSlides={ctrl.slides}
                    />
                  </div>
                </>
              )}
            </>
          )}
        </main>

        {/* RIGHT: Preview → Live stage + transport */}
        <aside className="v-scroll flex w-[30rem] shrink-0 flex-col overflow-y-auto border-l border-[var(--v-border)] bg-[var(--v-surface)]">
          {/* PREVIEW | LIVE - side by side (ProPresenter-style) */}
          <div className="border-b border-[var(--v-border)] p-3">
            <div className="grid grid-cols-2 gap-3">
              {/* PREVIEW (cue next) */}
              <div className="flex flex-col">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--v-accent)]">
                    <Eye className="h-3.5 w-3.5" /> Preview
                  </span>
                  <span className="text-[10px] text-[var(--v-text-faint)]">{mode === "bible" ? "Scripture" : "Lyrics"}</span>
                </div>
                <div
                  className="relative aspect-video w-full overflow-hidden rounded-lg border-2 border-[var(--v-accent)]/50"
                  style={{ background: "#000" }}
                  onContextMenu={(e) => { e.preventDefault(); setScreenMenu({ x: e.clientX, y: e.clientY }); }}
                >
                  <CaptureStage state={previewState} scale />
                </div>
              </div>

              {/* LIVE (on air) */}
              <div className="flex flex-col">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-[var(--v-text-faint)]">Live</span>
                  <StatusPill status={liveState.status} />
                </div>
                <div
                  className={`relative aspect-video w-full overflow-hidden rounded-lg border-2 ${
                    liveState.status === "live"
                      ? "v-live-pulse border-[var(--v-live)]"
                      : "border-[var(--v-border)]"
                  }`}
                  style={{ background: "#000" }}
                  onContextMenu={(e) => { e.preventDefault(); setScreenMenu({ x: e.clientX, y: e.clientY }); }}
                >
                  <CaptureStage state={liveState} scale />
                </div>
              </div>
            </div>

            {/* One line, not a panel: an operator needs to know at a glance
                whether anything is reaching the projector, but no longer has
                to do anything to put it there. */}
            <ProjectorStatusLine desktop={desktop} projector={projector} />

            {screenMenu && (
              <ScreenContextMenu
                x={screenMenu.x}
                y={screenMenu.y}
                projectorOpen={projector.open}
                displays={projector.displays}
                activeDisplayId={projector.targetDisplay?.id ?? null}
                streamUrl={streamUrl}
                obsConfigured={!!settings?.stream}
                onSendToDisplay={(id) => {
                  // Sending from here also remembers the screen, so the next
                  // service opens on the one that was actually used.
                  patchSettings({
                    output: {
                      resolution: settings?.output.resolution ?? "auto",
                      autoProjector: settings?.output.autoProjector ?? true,
                      displayId: id,
                    },
                  });
                  projector.openProjector(id);
                  setScreenMenu(null);
                }}
                onCloseProjection={() => { projector.closeProjector(); setScreenMenu(null); }}
                onSendToObs={() => {
                  setSettingsSection("streaming");
                  setSettingsOpen(true);
                  setScreenMenu(null);
                }}
                onCopyStreamUrl={() => {
                  navigator.clipboard?.writeText(streamUrl);
                  setScreenMenu(null);
                }}
                onBlank={() => { stage.blank(); setScreenMenu(null); }}
                onClear={() => { stage.clear(); setScreenMenu(null); }}
                onClose={() => setScreenMenu(null)}
              />
            )}

            <VButton
              variant="ok"
              size="lg"
              className="mt-3 w-full text-base font-bold tracking-wide"
              onClick={sendLive}
              disabled={!stage.previewSlide}
            >
              <SendHorizontal className="h-5 w-5" /> GO LIVE <kbd className="ml-1 rounded-md bg-black/20 px-1.5 text-[11px] font-medium">↵</kbd>
            </VButton>
            <p className="mt-1.5 text-center text-[11px] text-[var(--v-text-faint)]">
              {liveState.status === "live"
                ? `Live: ${liveState.sectionLabel} · ${liveState.slideCount ? `slide ${liveState.slideIndex + 1}/${liveState.slideCount}` : liveState.songTitle}`
                : liveState.status === "blank"
                  ? "Live: blanked (black)"
                  : "Nothing live yet"}
            </p>
          </div>

          {/* Transport */}
          <div className="border-b border-[var(--v-border)] p-3">
            <div className="grid grid-cols-2 gap-2">
              <VButton variant="subtle" onClick={advancePrev} disabled={!stage.slides.length}>
                <ChevronLeft className="h-4 w-4" /> Prev
              </VButton>
              <VButton variant="subtle" onClick={advanceNext} disabled={!stage.slides.length}>
                Next <ChevronRight className="h-4 w-4" />
              </VButton>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <VButton size="lg" variant={liveState.status === "blank" ? "primary" : "subtle"} onClick={stage.blank}>
                <Square className="h-5 w-5" /> Blank
              </VButton>
              <VButton size="lg" variant="danger" onClick={stage.clear}>
                <Ban className="h-5 w-5" /> Clear
              </VButton>
            </div>
            <p className="mt-2 text-center text-[11px] text-[var(--v-text-faint)]">
              {advanceGoesLive
                ? "← → go live · Space blank · Esc clear"
                : "← → cue · Enter send live · Space blank · Esc clear"}
            </p>
          </div>

          {/* The projector panel used to sit here. The output now opens by
              itself the moment a second screen is connected, so a permanent
              "Open projector" button was a control for something that no
              longer needs asking. What remains lives where it is actually
              wanted: a status line under the live preview, the right-click
              menu on either preview, the View menu, and the shortcut. */}

          {/* AI auto-follow */}
          <AutoFollowPanel
            enabled={autoFollowOn}
            status={autoFollow.status}
            heard={autoFollow.heard}
            live={ctrl.status === "live"}
            onToggle={(v) => patchSettings({ autoFollow: v })}
          />

          {/* Stream / OBS browser source */}
          <StreamPanel />

          {/* Stage display + phone remote */}
          <StageRemotePanel notes={stageNotes} onNotes={setStageNotes} desktop={desktop} />
        </aside>
      </div>

      {editorOpen && (
        <SongEditor
          song={editorOpen === "edit" ? full.data ?? null : null}
          onClose={(savedId) => {
            setEditorOpen(false);
            if (savedId) setSelectedId(savedId);
          }}
        />
      )}
      {importOpen && (
        <ImportModal
          onClose={(savedId) => {
            setImportOpen(false);
            if (savedId) setSelectedId(savedId);
          }}
        />
      )}
      {settingsOpen && (
        <SettingsPage
          onClose={() => setSettingsOpen(false)}
          settings={settings}
          patchSettings={patchSettings}
          themes={themes.data ?? []}
          desktop={desktop}
          lyricPreviewTheme={activeTheme}
          biblePreviewTheme={bibleTheme}
          presentationPreviewTheme={presentationTheme}
          autoFollowStatus={autoFollow.status}
          autoFollowHeard={autoFollow.heard}
          initialSection={settingsSection}
          projector={projector}
        />
      )}
      {settings?.firstRun && (
        <WelcomeDialog
          onChoose={async (keepLibrary) => {
            if (!keepLibrary) {
              await fetch("/api/library/clear", { method: "POST" });
              qc.invalidateQueries({ queryKey: ["songs"] });
              setSelectedId(null);
            }
            patchSettings({ firstRun: false });
          }}
        />
      )}
      {update.dialogOpen && (
        <UpdateDialog status={update.status} onDismiss={update.dismiss} onClose={update.close} />
      )}
      {mediaOpen && <MediaLibrary onClose={() => setMediaOpen(false)} onCueCapture={setPendingCapture} />}
      {captureOpen && (
        <CapturePicker
          onClose={() => setCaptureOpen(false)}
          onPick={(s, layout) => {
            // Cue it, don't broadcast it: GO LIVE commits the capture.
            setPendingCapture({ sourceId: s.id, name: s.name, kind: s.kind, layout });
            setCaptureOpen(false);
          }}
        />
      )}
      {translateOpen && full.data && (
        <TranslateModal
          song={full.data}
          songId={selectedId}
          initialLang={settings?.secondaryLang ?? "ido"}
          onClose={() => setTranslateOpen(false)}
        />
      )}
    </div>
  );
}

/* ---------------- Sub-components ---------------- */

const MODE_TABS: { id: OperatorMode; label: string; icon: typeof Music4 }[] = [
  { id: "lyrics", label: "Lyrics", icon: Music4 },
  { id: "bible", label: "Bible", icon: BookOpen },
  { id: "presentation", label: "Presentations", icon: MonitorPlay },
  { id: "sermon", label: "Sermon", icon: NotebookPen },
  { id: "plans", label: "Plans", icon: ListChecks },
  { id: "history", label: "History", icon: History },
];

function TopBar({
  desktop,
  liveStatus,
  onSettings,
  onMedia,
  mode,
  onModeChange,
  update,
}: {
  desktop: ReturnType<typeof useDesktop>;
  liveStatus: string;
  onSettings: () => void;
  onMedia: () => void;
  mode: OperatorMode;
  onModeChange: (m: OperatorMode) => void;
  update: ReturnType<typeof useUpdateCheck>;
}) {
  // z-40: v-glass's backdrop-filter makes the header a stacking context, so
  // the Help dropdown's own z-index can't escape it - the header itself must
  // outrank the preview/live panels below.
  return (
    <header className="v-glass relative z-40 flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <div className="flex shrink-0 items-center gap-2">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[var(--v-accent)] to-[var(--v-accent-2)] text-black shadow-[0_2px_10px_var(--v-accent-glow)]">
          <Music4 className="h-4 w-4" />
        </div>
        <span className="hidden font-display text-sm font-bold tracking-tight lg:inline">Vifug Lyrics</span>
      </div>

      <nav className="v-scroll flex min-w-0 items-center gap-1 overflow-x-auto">
        {MODE_TABS.map((t) => {
          const Icon = t.icon;
          const active = mode === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onModeChange(t.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-[var(--v-accent-soft)] text-[var(--v-accent)]"
                  : "text-[var(--v-text-dim)] hover:bg-[var(--v-surface-3)]"
              }`}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <span className="hidden rounded bg-[var(--v-surface-3)] px-1.5 py-0.5 text-[10px] text-[var(--v-text-faint)] xl:inline-block">
          {desktop ? "Desktop" : "Preview"}
        </span>
        <UpdateNotice update={update} />
        <StatusPill status={liveStatus} />
        <HelpMenu onCheckUpdates={update.checkNow} />
        <VButton variant="ghost" size="sm" onClick={onMedia}>
          <Clapperboard className="h-4 w-4" /> Media
        </VButton>
        <VButton variant="ghost" size="sm" onClick={onSettings}>
          <Settings2 className="h-4 w-4" /> Settings
        </VButton>
      </div>
    </header>
  );
}

/**
 * "Update available" pill - shown when a newer release exists on GitHub.
 * Click opens the landing page's download section in the system browser;
 * the small × mutes the notice for that version.
 */
function UpdateNotice({ update }: { update: ReturnType<typeof useUpdateCheck> }) {
  if (!update.available) return null;
  return (
    <button
      onClick={update.openDialog}
      title="See what changed"
      className="flex items-center gap-1.5 rounded-full border border-[var(--v-accent)]/40 bg-[var(--v-accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--v-accent)] hover:bg-[var(--v-accent)]/20"
    >
      <Download className="h-3 w-3" /> Update {update.available.tag}
    </button>
  );
}

/** Help menu - everything routes to the guides hosted on the landing page. */
const HELP_BASE = "https://abahvictor360-sketch.github.io/vifug-lyrics";
const HELP_LINKS = [
  { icon: BookOpen, label: "How to use Vifug Lyrics", href: `${HELP_BASE}/guide.html` },
  { icon: Mic, label: "Set up AI auto-follow (Deepgram)", href: `${HELP_BASE}/deepgram-api-key.html` },
  { icon: Radio, label: "Streaming & NDI setup", href: "https://github.com/abahvictor360-sketch/vifug-lyrics/blob/main/docs/STREAMING_AND_NDI.md" },
  { icon: HelpCircle, label: "FAQ", href: `${HELP_BASE}/index.html#faq` },
  { icon: Mail, label: "Contact us", href: `${HELP_BASE}/contact.html` },
];

function HelpMenu({ onCheckUpdates }: { onCheckUpdates: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("click", onClick);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <VButton variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
        <HelpCircle className="h-4 w-4" /> Help
      </VButton>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-64 rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-2)] p-1.5 shadow-2xl">
          {HELP_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-[var(--v-text)] transition-colors hover:bg-[var(--v-surface-3)]"
            >
              <l.icon className="h-4 w-4 shrink-0 text-[var(--v-accent)]" /> {l.label}
            </a>
          ))}
          <div className="my-1 h-px bg-[var(--v-border)]" />
          <button
            onClick={() => {
              setOpen(false);
              onCheckUpdates();
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-[var(--v-text)] transition-colors hover:bg-[var(--v-surface-3)]"
          >
            <Download className="h-4 w-4 shrink-0 text-[var(--v-accent)]" /> Check for updates
          </button>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  if (status === "live")
    return (
      <span className="flex items-center gap-1 rounded-full bg-[var(--v-live-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--v-live)]">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--v-live)]" /> Live
      </span>
    );
  if (status === "blank")
    return <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-300">Blank</span>;
  return <span className="rounded-full bg-[var(--v-surface-3)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--v-text-faint)]">Idle</span>;
}

/**
 * Right-click menu on the Preview/Live screens: where should this go?
 *
 * "Send it to that screen" is the question an operator actually has in front
 * of them, and the answer is different in every room - the projector, a
 * confidence monitor at the back, or straight into OBS for the stream. So the
 * menu lists the real destinations by name rather than offering a single
 * open/close toggle that assumes there is only one.
 */
function ScreenContextMenu({
  x,
  y,
  projectorOpen,
  displays,
  activeDisplayId,
  streamUrl,
  obsConfigured,
  onSendToDisplay,
  onCloseProjection,
  onSendToObs,
  onCopyStreamUrl,
  onBlank,
  onClear,
  onClose,
}: {
  x: number;
  y: number;
  projectorOpen: boolean;
  displays: DisplayInfo[];
  activeDisplayId: number | null;
  streamUrl: string;
  obsConfigured: boolean;
  onSendToDisplay: (displayId: number) => void;
  onCloseProjection: () => void;
  onSendToObs: () => void;
  onCopyStreamUrl: () => void;
  onBlank: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  // Keep the menu on-screen near the cursor even close to the window edge.
  // The height grows with the number of screens, so the clamp has to as well.
  const MENU_W = 244;
  const estHeight = 210 + displays.length * 38;
  const left = Math.min(x, window.innerWidth - MENU_W - 8);
  const top = Math.max(8, Math.min(y, window.innerHeight - estHeight - 8));

  const item = (
    icon: React.ReactNode,
    label: string,
    onClick: () => void,
    opts: { danger?: boolean; hint?: string; active?: boolean } = {},
  ) => (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors ${
        opts.danger
          ? "text-[var(--v-live)] hover:bg-[var(--v-live-soft)]"
          : opts.active
            ? "bg-[var(--v-ok)]/10 text-[var(--v-ok)]"
            : "text-[var(--v-text)] hover:bg-[var(--v-surface-3)]"
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {opts.hint && <span className="shrink-0 text-[10px] text-[var(--v-text-faint)]">{opts.hint}</span>}
    </button>
  );

  const label = (text: string) => (
    <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--v-text-faint)]">
      {text}
    </p>
  );

  return (
    <div
      className="fixed z-50 w-[244px] rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-2)] p-1.5 shadow-2xl"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }}
    >
      {label("Send to screen")}
      {displays.length === 0 && (
        <p className="px-3 pb-1.5 text-[11px] text-[var(--v-text-faint)]">No screens detected.</p>
      )}
      {displays.map((d) =>
        item(
          <Monitor className="h-4 w-4 shrink-0" />,
          d.label,
          () => onSendToDisplay(d.id),
          {
            active: projectorOpen && activeDisplayId === d.id,
            hint:
              projectorOpen && activeDisplayId === d.id
                ? "on air"
                : d.isPrimary
                  ? "yours"
                  : `${d.size.width}×${d.size.height}`,
          },
        ),
      )}
      {projectorOpen &&
        item(<MonitorX className="h-4 w-4 shrink-0" />, "Turn off projection", onCloseProjection)}

      <div className="my-1 h-px bg-[var(--v-border)]" />
      {label("Send to stream")}
      {item(<Rocket className="h-4 w-4 shrink-0" />, "Add to OBS", onSendToObs, {
        hint: obsConfigured ? undefined : "set up",
      })}
      {item(<Link2 className="h-4 w-4 shrink-0" />, "Copy browser source link", onCopyStreamUrl, {
        hint: streamUrl ? undefined : "",
      })}

      <div className="my-1 h-px bg-[var(--v-border)]" />
      {item(<Square className="h-4 w-4 shrink-0" />, "Blank screen", onBlank)}
      {item(<Ban className="h-4 w-4 shrink-0" />, "Clear", onClear, { danger: true })}
    </div>
  );
}

function SongRow({
  song,
  active,
  onSelect,
  onDelete,
}: {
  song: SongListItem;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <li>
      <div
        onClick={onSelect}
        className={`group flex cursor-pointer items-center gap-2 rounded-lg border-l-2 px-2.5 py-2 text-sm transition-colors ${
          active
            ? "border-[var(--v-accent)] bg-[var(--v-accent-soft)] text-[var(--v-text)]"
            : "border-transparent hover:bg-[var(--v-surface-3)]"
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{song.title}</div>
          <div className="truncate text-[11px] text-[var(--v-text-faint)]">
            {song.authors.length ? song.authors.join(", ") : song.tags.slice(0, 2).join(" · ") || "-"}
          </div>
        </div>
        {confirm ? (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button onClick={onDelete} className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-[var(--v-live)] hover:bg-[var(--v-live-soft)]">
              Delete
            </button>
            <button onClick={() => setConfirm(false)} className="rounded px-1 text-[var(--v-text-faint)] hover:text-[var(--v-text)]">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirm(true);
            }}
            className="opacity-0 transition-opacity group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5 text-[var(--v-text-faint)] hover:text-[var(--v-live)]" />
          </button>
        )}
      </div>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[var(--v-surface-2)]">
        <Music4 className="h-8 w-8 text-[var(--v-text-faint)]" />
      </div>
      <div>
        <p className="font-display text-lg font-semibold">Select a song</p>
        <p className="text-sm text-[var(--v-text-faint)]">Pick from the library, or create / import a new one.</p>
      </div>
    </div>
  );
}

function SlideGrid({
  slides,
  rawSlides,
  stage,
  order,
  song,
  onRepeat,
  onRemove,
  onMove,
}: {
  slides: StageSlide[];
  rawSlides: Slide[];
  stage: StageController;
  order: string[];
  song: NonNullable<ReturnType<typeof useFullSong>["data"]>;
  onRepeat: (idx: number) => void;
  onRemove: (idx: number) => void;
  onMove: (idx: number, dir: -1 | 1) => void;
}) {
  // Map slides back to their arrangement item index (the "N:sectionId#i" prefix).
  const slidesByItem = useMemo(() => {
    const groups: { itemIdx: number; sectionId: string; slides: StageSlide[] }[] = [];
    slides.forEach((s, i) => {
      const raw = rawSlides[i];
      const itemIdx = Number((raw?.id ?? s.slideId ?? "0").split(":")[0]);
      const sectionId = raw?.sectionId ?? "";
      let g = groups.find((x) => x.itemIdx === itemIdx);
      if (!g) {
        g = { itemIdx, sectionId, slides: [] };
        groups.push(g);
      }
      g.slides.push(s);
    });
    return groups;
  }, [slides, rawSlides]);

  let flatIndex = -1;

  return (
    <div className="space-y-5">
      {slidesByItem.map((group) => {
        const sec = song.sections.find((x) => x.id === group.sectionId);
        return (
          <div key={group.itemIdx}>
            <div className="mb-2 flex items-center gap-2">
              <SectionChip label={sec?.label ?? "Section"} type={sec?.type ?? "verse"} />
              <div className="ml-1 flex items-center gap-1">
                <button title="Move up" onClick={() => onMove(group.itemIdx, -1)} className="rounded px-1 text-[var(--v-text-faint)] hover:bg-[var(--v-surface-3)] hover:text-[var(--v-text)]">
                  <ChevronLeft className="h-3.5 w-3.5 rotate-90" />
                </button>
                <button title="Move down" onClick={() => onMove(group.itemIdx, 1)} className="rounded px-1 text-[var(--v-text-faint)] hover:bg-[var(--v-surface-3)] hover:text-[var(--v-text)]">
                  <ChevronRight className="h-3.5 w-3.5 rotate-90" />
                </button>
                <button title="Repeat section" onClick={() => onRepeat(group.itemIdx)} className="flex items-center gap-1 rounded px-1.5 text-[10px] text-[var(--v-text-faint)] hover:bg-[var(--v-surface-3)] hover:text-[var(--v-text)]">
                  <Repeat className="h-3.5 w-3.5" /> repeat
                </button>
                <button title="Remove from order" onClick={() => onRemove(group.itemIdx)} className="rounded px-1 text-[var(--v-text-faint)] hover:bg-[var(--v-live-soft)] hover:text-[var(--v-live)]">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
              {group.slides.map((slide) => {
                flatIndex++;
                const idx = flatIndex;
                const isLive = stage.liveIndex === idx && stage.status === "live";
                const isPreview = stage.previewIndex === idx && !isLive;
                return (
                  <button
                    key={slide.slideId ?? idx}
                    onClick={() => stage.preview(idx)}
                    onDoubleClick={() => stage.goLive(idx)}
                    className={`group relative aspect-video overflow-hidden rounded-xl border-2 bg-black text-left transition-all duration-150 ${
                      isLive
                        ? "v-live-pulse border-[var(--v-live)] ring-2 ring-[var(--v-live)]/40"
                        : isPreview
                          ? "border-[var(--v-accent)] ring-2 ring-[var(--v-accent)]/30 shadow-[0_0_16px_var(--v-accent-glow)]"
                          : "border-[var(--v-border)] hover:-translate-y-0.5 hover:border-[var(--v-accent)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.5)]"
                    }`}
                  >
                    <div className="flex h-full w-full flex-col items-center justify-center p-2 text-center">
                      {slide.sourceLines.map((l, i) => (
                        <div key={i} className="font-lyric text-[11px] leading-tight text-white/90 line-clamp-2">
                          {l}
                        </div>
                      ))}
                    </div>
                    {isLive && (
                      <span className="absolute left-1.5 top-1.5 rounded bg-[var(--v-live)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                        Live
                      </span>
                    )}
                    {isPreview && (
                      <span className="absolute left-1.5 top-1.5 rounded bg-[var(--v-accent)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-black">
                        Preview
                      </span>
                    )}
                    <span className="absolute bottom-1 right-1.5 text-[9px] text-white/40">{idx + 1}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {!slides.length && (
        <p className="text-sm text-[var(--v-text-faint)]">This song has no lyrics yet. Click Edit to add sections.</p>
      )}
    </div>
  );
}

/**
 * Where the output currently is, in one line.
 *
 * This replaced a whole projector panel. Opening the output is no longer
 * something to be asked for, so the only thing left worth showing is whether
 * it is on a screen and which - plus a way back if it was closed on purpose,
 * since otherwise nothing short of unplugging the cable would bring it back.
 */
function ProjectorStatusLine({
  desktop,
  projector,
}: {
  desktop: ReturnType<typeof useDesktop>;
  projector: ReturnType<typeof useProjector>;
}) {
  const { open, justDetected, targetDisplay, openProjector, closeProjector } = projector;

  const label = open
    ? targetDisplay
      ? `Projecting on ${targetDisplay.label}`
      : "Projecting"
    : desktop && !targetDisplay
      ? "No second screen connected"
      : "Output closed";

  return (
    <div className="mt-2.5 flex items-center gap-2 text-[11px]">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          open ? "bg-[var(--v-ok)]" : "bg-[var(--v-text-faint)]"
        }`}
      />
      <span className={`min-w-0 truncate ${justDetected ? "text-[var(--v-accent)]" : "text-[var(--v-text-faint)]"}`}>
        {justDetected ? "Screen detected - projecting" : label}
      </span>
      {open ? (
        <button
          onClick={closeProjector}
          className="ml-auto shrink-0 font-medium text-[var(--v-text-faint)] hover:text-[var(--v-live)]"
        >
          Close
        </button>
      ) : (
        (!desktop || targetDisplay) && (
          <button
            onClick={() => openProjector()}
            className="ml-auto shrink-0 font-medium text-[var(--v-accent)] hover:underline"
          >
            Project
          </button>
        )
      )}
    </div>
  );
}

/* ---------------- Phase 2: AI auto-follow ---------------- */

function AutoFollowPanel({
  enabled,
  status,
  heard,
  live,
  onToggle,
}: {
  enabled: boolean;
  status: string;
  heard: string;
  live: boolean;
  onToggle: (v: boolean) => void;
}) {
  const label =
    status === "listening"
      ? "Listening…"
      : status === "connecting"
        ? "Connecting…"
        : status === "unavailable"
          ? "No speech key set"
          : status === "error"
            ? "Mic / connection error"
            : enabled
              ? live
                ? "Ready"
                : "Waiting for live slide"
              : "Off";
  return (
    <div className="border-b border-[var(--v-border)] p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--v-text-faint)]">
          <Ear className="h-3.5 w-3.5" /> AI Auto-Follow
        </span>
        <button
          onClick={() => onToggle(!enabled)}
          className={`relative h-5 w-9 rounded-full transition-colors ${enabled ? "bg-[var(--v-accent)]" : "bg-[var(--v-surface-3)]"}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${enabled ? "left-4" : "left-0.5"}`}
          />
        </button>
      </div>
      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--v-text-faint)]">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            status === "listening" ? "animate-pulse bg-[var(--v-ok)]" : status === "error" || status === "unavailable" ? "bg-[var(--v-live)]" : "bg-[var(--v-text-faint)]"
          }`}
        />
        {label}
      </p>
      {status === "listening" && heard && (
        <p className="mt-1 truncate rounded bg-[var(--v-surface-2)] px-2 py-1 text-[10px] italic text-[var(--v-text-dim)]">
          “…{heard}”
        </p>
      )}
      {status === "unavailable" && (
        <p className="mt-1 text-[10px] text-[var(--v-text-faint)]">
          Set <code>DEEPGRAM_API_KEY</code> in the server env to enable live speech-follow.
        </p>
      )}
      <p className="mt-1 text-[10px] text-[var(--v-text-faint)]">Manual next/prev always overrides.</p>
    </div>
  );
}

/* ---------------- Phase 2: Stream / OBS ---------------- */

function StreamPanel() {
  const [copied, setCopied] = useState(false);
  const streamUrl = typeof window !== "undefined" ? `${window.location.origin}/#/stream` : "/#/stream";
  return (
    <div className="border-b border-[var(--v-border)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--v-text-faint)]">
          <Radio className="h-3.5 w-3.5" /> Stream / OBS source
        </span>
      </div>
      <div className="flex gap-1.5">
        <input
          readOnly
          value={streamUrl}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-2 py-1.5 text-[11px] outline-none"
        />
        <button
          onClick={() => {
            navigator.clipboard?.writeText(streamUrl).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            });
          }}
          className="rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-2 hover:bg-[var(--v-surface-3)]"
        >
          {copied ? <Check className="h-4 w-4 text-[var(--v-ok)]" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <p className="mt-1.5 text-[10px] text-[var(--v-text-faint)]">
        Add as an OBS <b>Browser</b> source (transparent). For NDI, route this browser source out via OBS + the NDI plugin.
      </p>
      <a
        href="/#/stream"
        target="_blank"
        rel="noreferrer"
        className="mt-1.5 inline-block text-[11px] font-medium text-[var(--v-accent)] hover:underline"
      >
        Open stream output ↗
      </a>
    </div>
  );
}

/* ---------------- Live history ---------------- */

function HistoryPanel({
  entries,
  onRecall,
  onClear,
}: {
  entries: LiveHistoryEntry[];
  onRecall: (e: LiveHistoryEntry) => void;
  onClear: () => void;
}) {
  const fmt = (at: number) => {
    const d = new Date(at);
    const today = new Date().toDateString() === d.toDateString();
    return today
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString([], { month: "short", day: "numeric" }) +
          " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--v-border)] px-5 py-3">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--v-text-faint)]">
          {entries.length ? `${entries.length} item${entries.length === 1 ? "" : "s"} shown live` : "Live history"}
        </span>
        {entries.length > 0 && (
          <button
            onClick={onClear}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--v-text-faint)] hover:bg-[var(--v-surface-3)] hover:text-[var(--v-text)]"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear history
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[var(--v-text-faint)]">
          <History className="h-8 w-8" />
          <p className="text-sm">Nothing has gone live yet.</p>
          <p className="text-xs">Songs and Bible passages appear here as you present them.</p>
        </div>
      ) : (
        <div className="v-scroll flex-1 overflow-y-auto p-3">
          {entries.map((e) => (
            <button
              key={e.id}
              onClick={() => onRecall(e)}
              className="mb-1.5 flex w-full items-center gap-3 rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-2)] px-3 py-2.5 text-left transition-colors hover:border-[var(--v-accent)]/50 hover:bg-[var(--v-surface-3)]"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[var(--v-accent-soft)] text-[var(--v-accent)]">
                {e.kind === "lyric" ? <Music4 className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {e.kind === "lyric" ? e.title : e.caption}
                </span>
                <span className="block truncate text-[11px] text-[var(--v-text-faint)]">
                  {e.kind === "lyric" ? "Song" : e.title}
                </span>
              </span>
              <span className="shrink-0 text-[11px] text-[var(--v-text-faint)]">{fmt(e.at)}</span>
              <PlayCircle className="h-4 w-4 shrink-0 text-[var(--v-text-faint)]" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Phase 4: Service plans (playlists) ---------------- */

function PlansPanel({
  onCueSong,
  onCueScripture,
}: {
  onCueSong: (songId: string) => void;
  onCueScripture: (ref: string, versionId?: string) => void;
}) {
  const plans = usePlaylists();
  const create = useCreatePlaylist();
  const rename = useRenamePlaylist();
  const del = useDeletePlaylist();
  const saveItems = useSavePlaylistItems();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const plan = usePlaylist(selectedId);
  const [songQuery, setSongQuery] = useState("");
  const songs = useSongList(songQuery);
  const allSongs = useSongList(""); // for resolving titles of already-added items, regardless of search
  const manifest = useBibleManifest();
  const versions = manifest.data?.versions ?? [];

  // Working copy of items (persist on change).
  const [items, setItems] = useState<DraftItem[]>([]);
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (plan.data && loadedFor.current !== selectedId) {
      loadedFor.current = selectedId;
      setItems(
        plan.data.items.map((it) => ({
          itemType: it.itemType as PlaylistItemType,
          songId: it.songId,
          scriptureRef: it.scriptureRef,
          scriptureVersion: it.scriptureVersion,
          label: it.label,
        })),
      );
    }
  }, [plan.data, selectedId]);

  const persist = useCallback(
    (next: DraftItem[]) => {
      setItems(next);
      if (selectedId) saveItems.mutate({ id: selectedId, items: next });
    },
    [selectedId, saveItems],
  );

  const songTitle = (id: string | null | undefined) =>
    allSongs.data?.find((s) => s.id === id)?.title ?? "Unknown song";

  const [newName, setNewName] = useState("");
  const [addSongOpen, setAddSongOpen] = useState(false);
  const [addScriptureOpen, setAddScriptureOpen] = useState(false);

  const addItem = (it: DraftItem) => persist([...items, it]);
  const removeItem = (i: number) => persist(items.filter((_, idx) => idx !== i));
  const moveItem = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  };
  const cue = (it: DraftItem) => {
    if (it.itemType === "song" && it.songId) onCueSong(it.songId);
    else if (it.itemType === "scripture" && it.scriptureRef)
      onCueScripture(it.scriptureRef, it.scriptureVersion ?? undefined);
  };

  return (
    <div className="flex min-h-0 flex-1">
      {/* Plan list */}
      <div className="flex w-64 shrink-0 flex-col border-r border-[var(--v-border)]">
        <div className="border-b border-[var(--v-border)] p-3">
          <div className="flex gap-1.5">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) {
                  create.mutate(
                    { name: newName.trim() },
                    { onSuccess: (d) => { setSelectedId(d.id); loadedFor.current = null; } },
                  );
                  setNewName("");
                }
              }}
              placeholder="New service plan…"
              className="min-w-0 flex-1 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-2 py-1.5 text-sm outline-none focus:border-[var(--v-accent)]"
            />
            <VButton
              variant="subtle"
              size="sm"
              onClick={() => {
                if (!newName.trim()) return;
                create.mutate(
                  { name: newName.trim() },
                  { onSuccess: (d) => { setSelectedId(d.id); loadedFor.current = null; } },
                );
                setNewName("");
              }}
            >
              <Plus className="h-4 w-4" />
            </VButton>
          </div>
        </div>
        <div className="v-scroll min-h-0 flex-1 overflow-y-auto p-2">
          {plans.data?.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-[var(--v-text-faint)]">
              No service plans yet.
            </p>
          )}
          <ul className="space-y-0.5">
            {plans.data?.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => { setSelectedId(p.id); loadedFor.current = null; }}
                  className={`group flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                    p.id === selectedId
                      ? "bg-[var(--v-accent-soft)] text-[var(--v-accent)]"
                      : "hover:bg-[var(--v-surface-3)]"
                  }`}
                >
                  <ListChecks className="h-4 w-4 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <Trash2
                    className="hidden h-3.5 w-3.5 shrink-0 text-[var(--v-text-faint)] hover:text-[var(--v-danger)] group-hover:block"
                    onClick={(e) => {
                      e.stopPropagation();
                      del.mutate(p.id);
                      if (selectedId === p.id) setSelectedId(null);
                    }}
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Plan editor */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!selectedId || !plan.data ? (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--v-text-faint)]">
            Select or create a service plan.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-[var(--v-border)] px-5 py-3">
              <input
                defaultValue={plan.data.playlist.name}
                key={plan.data.playlist.id}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== plan.data!.playlist.name)
                    rename.mutate({ id: selectedId, name: v });
                }}
                className="min-w-0 flex-1 bg-transparent font-display text-lg font-semibold outline-none"
              />
              <label className="flex items-center gap-1.5 text-xs text-[var(--v-text-faint)]">
                <CalendarDays className="h-3.5 w-3.5" />
                <input
                  type="date"
                  defaultValue={plan.data.playlist.serviceDate ?? ""}
                  onChange={(e) => rename.mutate({ id: selectedId, serviceDate: e.target.value || null })}
                  className="rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-2 py-1 text-xs outline-none focus:border-[var(--v-accent)]"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--v-border)] px-5 py-2">
              <VButton variant="subtle" size="sm" onClick={() => setAddSongOpen((v) => !v)}>
                <Music4 className="h-4 w-4" /> Add song
              </VButton>
              <VButton variant="subtle" size="sm" onClick={() => setAddScriptureOpen((v) => !v)}>
                <BookOpen className="h-4 w-4" /> Add scripture
              </VButton>
              <VButton
                variant="subtle"
                size="sm"
                onClick={() => addItem({ itemType: "header", label: "Section" })}
              >
                <Plus className="h-4 w-4" /> Header
              </VButton>
              <VButton
                variant="subtle"
                size="sm"
                onClick={() => addItem({ itemType: "blank", label: "Blank" })}
              >
                <Square className="h-4 w-4" /> Blank
              </VButton>
            </div>

            {/* Song picker */}
            {addSongOpen && (
              <div className="border-b border-[var(--v-border)] bg-[var(--v-surface-2)] p-3">
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--v-text-faint)]" />
                  <input
                    autoFocus
                    value={songQuery}
                    onChange={(e) => setSongQuery(e.target.value)}
                    placeholder="Search songs by title, author or tag…"
                    className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface)] py-1.5 pl-8 pr-2 text-sm outline-none focus:border-[var(--v-accent)]"
                  />
                </div>
                <div className="v-scroll flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                  {songs.data?.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { addItem({ itemType: "song", songId: s.id }); setAddSongOpen(false); setSongQuery(""); }}
                      className="rounded-md border border-[var(--v-border)] bg-[var(--v-surface)] px-2.5 py-1 text-xs hover:border-[var(--v-accent)]"
                    >
                      {s.title}
                    </button>
                  ))}
                  {songs.data?.length === 0 && (
                    <p className="w-full py-3 text-center text-xs text-[var(--v-text-faint)]">No songs match "{songQuery}".</p>
                  )}
                </div>
              </div>
            )}

            {/* Scripture picker */}
            {addScriptureOpen && (
              <ScriptureAdd
                versions={versions.map((v) => ({ id: v.id, label: v.label }))}
                onAdd={(ref, versionId) => {
                  addItem({ itemType: "scripture", scriptureRef: ref, scriptureVersion: versionId });
                  setAddScriptureOpen(false);
                }}
              />
            )}

            <div className="v-scroll min-h-0 flex-1 overflow-y-auto p-4">
              {items.length === 0 && (
                <p className="py-8 text-center text-sm text-[var(--v-text-faint)]">
                  Empty plan. Add songs, scripture, headers or blanks.
                </p>
              )}
              <ol className="space-y-1.5">
                {items.map((it, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-2)] px-3 py-2"
                  >
                    <GripVertical className="h-4 w-4 shrink-0 text-[var(--v-text-faint)]" />
                    <span className="w-6 shrink-0 text-center text-xs text-[var(--v-text-faint)]">{i + 1}</span>
                    {it.itemType === "header" ? (
                      <input
                        defaultValue={it.label ?? ""}
                        onBlur={(e) => {
                          const next = [...items];
                          next[i] = { ...it, label: e.target.value };
                          persist(next);
                        }}
                        className="min-w-0 flex-1 bg-transparent text-sm font-semibold uppercase tracking-wide text-[var(--v-accent)] outline-none"
                      />
                    ) : (
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <ItemBadge type={it.itemType} />
                          <span className="truncate text-sm">
                            {it.itemType === "song"
                              ? songTitle(it.songId)
                              : it.itemType === "scripture"
                                ? `${it.scriptureRef}${it.scriptureVersion ? ` · ${it.scriptureVersion.toUpperCase()}` : ""}`
                                : it.label || "Blank"}
                          </span>
                        </div>
                      </div>
                    )}
                    {(it.itemType === "song" || it.itemType === "scripture") && (
                      <button
                        onClick={() => cue(it)}
                        title="Cue into stage"
                        className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--v-accent)]/40 bg-[var(--v-accent-soft)] px-2 py-1 text-xs font-medium text-[var(--v-accent)] hover:bg-[var(--v-accent)]/20"
                      >
                        <PlayCircle className="h-3.5 w-3.5" /> Cue
                      </button>
                    )}
                    <div className="flex shrink-0 items-center">
                      <button onClick={() => moveItem(i, -1)} className="rounded p-1 text-[var(--v-text-faint)] hover:bg-[var(--v-surface-3)]">
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => moveItem(i, 1)} className="rounded p-1 text-[var(--v-text-faint)] hover:bg-[var(--v-surface-3)]">
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => removeItem(i)} className="rounded p-1 text-[var(--v-text-faint)] hover:text-[var(--v-danger)]">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ItemBadge({ type }: { type: PlaylistItemType }) {
  const map: Record<PlaylistItemType, { label: string; cls: string }> = {
    song: { label: "SONG", cls: "text-[var(--v-accent)]" },
    scripture: { label: "SCRIPTURE", cls: "text-emerald-400" },
    blank: { label: "BLANK", cls: "text-[var(--v-text-faint)]" },
    header: { label: "HEADER", cls: "text-[var(--v-text-faint)]" },
  };
  const m = map[type];
  return (
    <span className={`shrink-0 rounded bg-[var(--v-surface-3)] px-1.5 py-0.5 text-[9px] font-semibold tracking-wide ${m.cls}`}>
      {m.label}
    </span>
  );
}

function ScriptureAdd({
  versions,
  onAdd,
}: {
  versions: { id: string; label: string }[];
  onAdd: (ref: string, versionId?: string) => void;
}) {
  const [ref, setRef] = useState("");
  const [ver, setVer] = useState(versions[0]?.id ?? "");
  const manifest = useBibleManifest();
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const version = manifest.data?.versions.find((v) => v.id === ver);

  // If what's typed parses as a clean reference ("John 3:16"), don't bother
  // searching - Add already jumps straight there. Otherwise, treat it as a
  // keyword search across the selected version's full text, same as the
  // Bible tab's own search.
  useEffect(() => {
    const q = ref.trim();
    if (!manifest.data || !version || q.length < 3 || parseReference(q, manifest.data)) {
      setHits(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      searchVersion(version, manifest.data!, q, 12).then((res) => {
        if (!cancelled) { setHits(res); setSearching(false); }
      });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [ref, version, manifest.data]);

  const add = (reference: string) => {
    onAdd(reference, ver);
    setRef("");
    setHits(null);
  };

  return (
    <div className="border-b border-[var(--v-border)] bg-[var(--v-surface-2)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && ref.trim()) add(ref.trim()); }}
          placeholder="Reference (John 3:16-18) or search by words…"
          className="min-w-0 flex-1 rounded-md border border-[var(--v-border)] bg-[var(--v-surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--v-accent)]"
        />
        <select
          value={ver}
          onChange={(e) => setVer(e.target.value)}
          className="rounded-md border border-[var(--v-border)] bg-[var(--v-surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--v-accent)]"
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
        <VButton variant="subtle" size="sm" onClick={() => ref.trim() && add(ref.trim())}>
          <Plus className="h-4 w-4" /> Add
        </VButton>
      </div>
      {searching && <p className="mt-2 text-[11px] text-[var(--v-text-faint)]">Searching…</p>}
      {hits && hits.length > 0 && (
        <div className="v-scroll mt-2 max-h-40 space-y-1 overflow-y-auto">
          {hits.map((h) => (
            <button
              key={`${h.code}-${h.chapter}-${h.verse}`}
              onClick={() => add(`${h.name} ${h.chapter}:${h.verse}`)}
              className="block w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface)] px-2.5 py-1.5 text-left text-xs hover:border-[var(--v-accent)]"
            >
              <span className="font-medium text-[var(--v-accent)]">{h.name} {h.chapter}:{h.verse}</span>
              <span className="ml-1.5 text-[var(--v-text-dim)]">{h.text}</span>
            </button>
          ))}
        </div>
      )}
      {hits && hits.length === 0 && !searching && (
        <p className="mt-2 text-[11px] text-[var(--v-text-faint)]">No matches for "{ref.trim()}".</p>
      )}
    </div>
  );
}

/* ---------------- Phase 4: Stage display + phone remote ---------------- */

function StageRemotePanel({
  notes,
  onNotes,
  desktop,
}: {
  notes: string;
  onNotes: (v: string) => void;
  desktop: ReturnType<typeof useDesktop>;
}) {
  const { networkOrigin } = useNetworkOrigin(desktop);
  const stageUrl = `${networkOrigin}/#/stage`;
  const remoteUrl = `${networkOrigin}/#/remote`;
  const [copied, setCopied] = useState<"stage" | "remote" | null>(null);
  const copy = (url: string, which: "stage" | "remote") => {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1400);
    });
  };
  return (
    <div className="border-b border-[var(--v-border)] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--v-text-faint)]">
        <MonitorSmartphone className="h-3.5 w-3.5" /> Stage &amp; Remote
      </div>

      {/* Service notes -> stage display */}
      <label className="mb-1 flex items-center gap-1 text-[11px] text-[var(--v-text-faint)]">
        <NotebookPen className="h-3 w-3" /> Notes for stage display
      </label>
      <textarea
        value={notes}
        onChange={(e) => onNotes(e.target.value)}
        rows={2}
        placeholder="e.g. Key of G · repeat chorus 2x · pastor speaks after bridge"
        className="mb-2 w-full resize-none rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-2 py-1.5 text-[11px] outline-none focus:border-[var(--v-accent)]"
      />

      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={() => copy(stageUrl, "stage")}
          className="flex items-center justify-center gap-1 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-2 py-1.5 text-[11px] hover:bg-[var(--v-surface-3)]"
        >
          {copied === "stage" ? <Check className="h-3.5 w-3.5 text-[var(--v-ok)]" /> : <Monitor className="h-3.5 w-3.5" />}
          Copy stage URL
        </button>
        <button
          onClick={() => copy(remoteUrl, "remote")}
          className="flex items-center justify-center gap-1 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-2 py-1.5 text-[11px] hover:bg-[var(--v-surface-3)]"
        >
          {copied === "remote" ? <Check className="h-3.5 w-3.5 text-[var(--v-ok)]" /> : <Smartphone className="h-3.5 w-3.5" />}
          Copy remote URL
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <a href="/#/stage" target="_blank" rel="noreferrer" className="text-[11px] font-medium text-[var(--v-accent)] hover:underline">
          Open stage ↗
        </a>
        <a href="/#/remote" target="_blank" rel="noreferrer" className="text-[11px] font-medium text-[var(--v-accent)] hover:underline">
          Open remote ↗
        </a>
      </div>
      <p className="mt-1.5 text-[10px] text-[var(--v-text-faint)]">
        Open the stage URL on a screen facing the team, and the remote URL on a phone on the same network.
      </p>
    </div>
  );
}

/* ---------------- Phase 2: Translate modal ---------------- */

function TranslateModal({
  song,
  songId,
  initialLang,
  onClose,
}: {
  song: NonNullable<ReturnType<typeof useFullSong>["data"]>;
  songId: string | null;
  initialLang: string;
  onClose: () => void;
}) {
  const [lang, setLang] = useState(initialLang || "ido");
  const translationsQ = useTranslations(songId);
  const save = useSaveTranslation(songId);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // Seed drafts from stored translations whenever lang / data changes.
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const s of song.sections) {
      const tr = translationsQ.data?.find((t) => t.sectionId === s.id && t.lang === lang);
      next[s.id] = tr?.lyrics ?? "";
    }
    setDrafts(next);
  }, [lang, translationsQ.data, song.sections]);

  const [savedId, setSavedId] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--v-border)] bg-[var(--v-surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--v-border)] px-5 py-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Translations</h2>
            <p className="text-xs text-[var(--v-text-faint)]">{song.song.title}</p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-2 py-1.5 text-sm outline-none"
            >
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            <button onClick={onClose} className="text-[var(--v-text-faint)] hover:text-[var(--v-text)]">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="v-scroll min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {song.sections.map((s) => (
            <div key={s.id}>
              <div className="mb-1.5 flex items-center gap-2">
                <SectionChip label={s.label} type={s.type} />
                <span className="text-[11px] text-[var(--v-text-faint)]">→ {langLabel(lang)}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <pre className="whitespace-pre-wrap rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] p-2.5 font-lyric text-xs text-[var(--v-text-dim)]">
                  {s.lyrics}
                </pre>
                <textarea
                  value={drafts[s.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                  onBlur={() => {
                    const val = (drafts[s.id] ?? "").trim();
                    save.mutate(
                      { sectionId: s.id, lang, lyrics: val },
                      { onSuccess: () => { setSavedId(s.id); setTimeout(() => setSavedId(null), 1200); } },
                    );
                  }}
                  placeholder={`${langLabel(lang)} translation…`}
                  rows={s.lyrics.split("\n").length}
                  className="w-full resize-none rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] p-2.5 font-lyric text-xs outline-none focus:border-[var(--v-accent)]"
                />
              </div>
              {savedId === s.id && (
                <span className="mt-1 flex items-center gap-1 text-[10px] text-[var(--v-ok)]">
                  <Check className="h-3 w-3" /> Saved
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--v-border)] px-5 py-3">
          <p className="text-[11px] text-[var(--v-text-faint)]">
            Translations save on blur. Enable <b>Dual-language</b> in Settings and pick this language to show them live.
          </p>
          <VButton variant="primary" onClick={onClose}>Done</VButton>
        </div>
      </div>
    </div>
  );
}
