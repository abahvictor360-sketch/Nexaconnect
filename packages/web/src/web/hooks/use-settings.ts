import type { ServiceTimer } from "../lib/timer";
import type { Screen } from "../lib/screens";
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
  /**
   * How much of the screen edge the text keeps clear, as a percentage.
   * null/undefined = inherit the theme's own margin (and, for Bible and
   * presentations, the tighter default they start from). Setting it here is
   * what an operator reaches for when the projector crops the picture or the
   * words sit too close to the bottom of the wall.
   */
  safeMargin?: number | null;
  /**
   * The same, per edge, for a screen that is only cropped on one side - a
   * projector overshooting the top of a wall, a TV with overscan down one
   * edge. null/undefined = all four edges use safeMargin.
   */
  safeMarginEdges?: { top: number; right: number; bottom: number; left: number } | null;
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
  bibleLangs?: Record<string, boolean>;
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
  /**
   * Presentation background, same three states as bibleBackgroundId. A deck
   * slide with a background of its own still wins - this is what shows behind
   * the ones that have none, which used to be the lyric background whether
   * that suited the deck or not.
   */
  presentationBackgroundId?: string | null;
  /**
   * autoProjector: put the output on a second screen as soon as one is there,
   * without waiting to be asked. Defaults on - a plugged-in projector is
   * always meant for projecting.
   */
  output: { displayId: number | null; resolution: string; autoProjector?: boolean };
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
   * Service timer - a countdown or count-up drawn over whichever screens are
   * ticked. Stored here rather than pushed live because it is an anchor, not a
   * ticking value: see lib/timer.ts.
   */
  timer?: ServiceTimer | null;
  /**
   * Output screens beyond the built-in main one. The main screen is implicit
   * and always exists; only the extras are stored.
   */
  screens?: Screen[] | null;
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
  /**
   * Sound devices. The microphone is Auto-Follow's; the output is where every
   * sound the app makes (video and capture audio) is played. null on either =
   * the system default device.
   */
  audio?: {
    inputDeviceId: string | null;
    inputLabel: string | null;
    /** Speakers/interface video sound plays out of. null = system default. */
    outputDeviceId?: string | null;
    /** Remembered name of that device, for showing it when it is unplugged. */
    outputLabel?: string | null;
    /**
     * Master mute for everything the app plays out loud - video sound and
     * capture audio, on every output at once. Separate from a single clip's
     * own mute: this is the "kill the sound now" the desk reaches for.
     */
    outputMuted?: boolean;
    /** Mixer mute - also pauses AI auto-follow listening while set. */
    muted?: boolean;
    /**
     * Browser/OS-level noise suppression (WebRTC's built-in denoiser) applied
     * to the mic before Auto-Follow listens. undefined = on (the sane default
     * for speech recognition - off is for the rare case it's making a
     * deliberately quiet/close mic sound worse).
     */
    noiseSuppression?: boolean;
  } | null;
  /** Stream/browser-source geometry + encoding hints (see Settings → Stream). */
  stream?: {
    canvas: string;
    fps: number;
    bitrateKbps: number;
    encoder: "x264" | "nvenc" | "qsv" | "amf" | "videotoolbox";
    /**
     * Playback volume (0-100) for an unmuted background video, adjustable live
     * from the Stream / OBS panel. undefined = 100 (full volume).
     */
    mediaVolume?: number;
    /** Mixer mute for the media channel - mediaVolume is kept as the level to restore. */
    mediaMuted?: boolean;
    /**
     * How the /stream overlay sits inside an OBS browser source.
     *  - "fill"   (default) use the source's own size as the canvas, so the
     *             overlay always fills exactly the source OBS created
     *  - "canvas" lay out at `canvas` and letterboxes to fit - px-perfect
     *             across differently-sized sources, at the cost of
     *             transparent bars when the aspect ratios differ
     */
    fitMode?: "fill" | "canvas";
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
