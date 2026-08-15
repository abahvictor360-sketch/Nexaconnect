import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export type ThemeOverride = {
  bgColor?: string | null;
  textColor?: string | null;
  textAlign?: "left" | "center" | "right" | null;
  fontWeight?: number | null;
  fontSize?: number | null;
  fontFamily?: string | null;
  /** fullscreen | lower_third | lower_third_bg (lower third with a backdrop bar) */
  displayMode?: "fullscreen" | "lower_third" | "lower_third_bg" | null;
  /** Where the lower third sits on screen. */
  verticalPos?: "top" | "center" | "bottom" | null;
  /** Bible only: color of the scripture reference caption (e.g. "John 3:16"). */
  referenceColor?: string | null;
  /** Color of the secondary/translation line; null = textColor at reduced opacity. */
  translationColor?: string | null;
  /** Drop shadow behind the text; null = none, undefined = inherit. */
  textShadow?: { color: string; blur: number; x: number; y: number } | null;
};

export type AppSettings = {
  activeThemeId: string | null;
  linesPerSlide: number;
  paginatorMode: "fixed" | "manual" | "autofit";
  songDisplayLang: string | null;
  dualLanguage: boolean;
  secondaryLang: string | null;
  autoFollow: boolean;
  /** Deepgram API key for AI auto-follow (falls back to server env). */
  deepgramApiKey?: string | null;
  /**
   * Language the room is sung/spoken in, for AI auto-follow transcription.
   * A Deepgram language code (e.g. "en", "es", "fr") or "multi" to
   * auto-detect. Defaults to "en".
   */
  autoFollowLang?: string | null;
  /**
   * How eagerly auto-follow advances (0.15–0.6). Fraction of a slide's words
   * that must be heard before it jumps. Lower = more eager. Default 0.34.
   */
  autoFollowThreshold?: number;
  /** How many upcoming slides auto-follow scans for a match. Default 3. */
  autoFollowLookahead?: number;
  /**
   * NDI output (desktop only). When enabled, the Electron app publishes the
   * projector window as an NDI source on the local network (requires the
   * native NDI runtime + grandiose addon; falls back gracefully if absent).
   */
  ndi?: { enabled: boolean; sourceName: string; frameRate: number } | null;
  /** Next/Prev (arrows, buttons, remote) sends the slide live immediately. */
  advanceGoesLive?: boolean;
  activeBackgroundId?: string | null;
  /**
   * Which non-English Bible language packs are enabled. English core
   * (kjv/web/asv/bbe) is always available. Missing = default (all on).
   */
  bibleLangs?: { yor: boolean; hau: boolean; ibo: boolean };
  /**
   * Operator-set lyric display overrides layered over the active theme
   * (background/text color, font family/size/weight, alignment).
   * Any field left null/undefined inherits the theme.
   */
  lyricTheme?: ThemeOverride | null;
  /**
   * Per-display Bible overrides layered over the (already overridden) lyric
   * theme. Any field left null/undefined inherits the lyric look.
   */
  bibleTheme?: ThemeOverride | null;
  /**
   * Scripture-only background. undefined = same background as lyrics,
   * null = explicitly plain (theme color only), string = a media id.
   */
  bibleBackgroundId?: string | null;
  output: { displayId: number | null; resolution: string };
  ui: { language: string };
  /**
   * Scrolling announcement bar pinned to the bottom of the projector and
   * stream outputs (not the operator's own preview thumbnails). Independent
   * of the live slide - shows even when nothing is live. bgColor/textColor
   * null = built-in defaults (near-black bar, white text).
   */
  announcement?: {
    enabled: boolean;
    text: string;
    speed: number;
    bgColor?: string | null;
    textColor?: string | null;
  } | null;
  /**
   * Presentation display overrides (theme look) - same shape as lyricTheme/
   * bibleTheme, layered over the active theme when a presentation is live.
   */
  presentationTheme?: ThemeOverride | null;
  /** Defaults applied to newly added background media (not retroactive). */
  mediaDefaults?: { fit: "cover" | "contain" | "fill"; videoSound: boolean };
  /** OBS WebSocket connection used by "Teleport to OBS" (Settings → Streaming & output). */
  obs?: { host: string; port: number; password: string } | null;
  /** vMix Web Controller connection used by "Teleport to vMix". */
  vmix?: { host: string; port: number } | null;
  /**
   * Phone-remote lock. The embedded server listens on 0.0.0.0 so any device on
   * the Wi-Fi can reach it - without a PIN, anyone on the network could drive
   * the service. On by default; the PIN is generated server-side on first use.
   */
  remote?: { requirePin: boolean; pin: string | null } | null;
  /** Microphone for Auto-Follow. null deviceId = system default input. */
  audio?: { inputDeviceId: string | null; inputLabel: string | null } | null;
  /** Stream/browser-source geometry + encoding hints (see Settings → Stream). */
  stream?: {
    canvas: string;
    fps: number;
    bitrateKbps: number;
    encoder: "x264" | "nvenc" | "qsv" | "amf" | "videotoolbox";
  } | null;
  /** Operator shortcuts: action -> accepted KeyboardEvent.key values. */
  shortcuts?: Record<string, string[]> | null;
  /** True until the welcome dialog has been answered on this install. */
  firstRun?: boolean;
};

export function useSettings(opts?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await api.settings.$get();
      const data = await res.json();
      return data.config as AppSettings;
    },
    ...(opts?.refetchInterval ? { refetchInterval: opts.refetchInterval } : {}),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (config: AppSettings) => {
      const res = await api.settings.$put({ json: { config } });
      return res.json();
    },
    onMutate: async (config) => {
      await qc.cancelQueries({ queryKey: ["settings"] });
      const prev = qc.getQueryData<AppSettings>(["settings"]);
      qc.setQueryData(["settings"], config);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["settings"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
}
