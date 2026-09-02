/**
 * Service timer - one countdown/count-up, shown on whichever screens you pick.
 *
 * Two decisions shape everything here.
 *
 * It is stored in settings rather than pushed on the live channel, and the
 * surfaces poll for it exactly as they already do for the announcement bar. A
 * timer that ticked over the wire would put one message per second on every
 * channel, and on the long-poll transport the hosted deployment falls back to
 * that is untenable.
 *
 * Polling is only safe because nothing here is a countdown *value* - it is an
 * ANCHOR, the wall-clock instant the timer reaches zero (or started counting
 * up). Each screen computes its own remaining time from that and ticks
 * locally. A projector that learns about the timer three seconds late still
 * shows the right number, because it is deriving it rather than being told it.
 *
 * Clocks are the catch. The anchor is an absolute instant, so a stage laptop
 * whose clock is two minutes out would show a countdown two minutes wrong.
 * Every surface therefore corrects against the server's clock (see
 * useServerSkew) instead of trusting its own.
 */

export type TimerScreens = {
  /** The worship team's confidence monitor. */
  stage: boolean;
  /** The projector / congregation output, and "full screen on this device". */
  live: boolean;
  /** The OBS/vMix browser source. */
  stream: boolean;
};

export type TimerPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";

export type ServiceTimer = {
  enabled: boolean;
  /** Shown above the digits. Empty hides the line entirely. */
  label: string;
  mode: "countdown" | "countup";
  /**
   * Epoch ms. Countdown: the instant it reaches zero. Count-up: the instant it
   * started. null when the timer has been set up but never started.
   */
  anchor: number | null;
  running: boolean;
  /**
   * While paused, the frozen value in ms - remaining for a countdown, elapsed
   * for a count-up. Resuming turns it back into an anchor.
   */
  frozenMs: number | null;
  /** The duration Reset returns a countdown to, in seconds. */
  durationSec: number;
  /** Keep counting past zero as a negative, rather than stopping at 00:00. */
  overrun: boolean;
  screens: TimerScreens;
  position: TimerPosition;
  /** Roughly 4/7/11% of the screen's smaller edge. */
  size: "small" | "medium" | "large";
  color: string;
  /** Turn amber with this many seconds left. 0 disables the warning. */
  warnAtSec: number;
};

export const DEFAULT_TIMER: ServiceTimer = {
  enabled: false,
  label: "",
  mode: "countdown",
  anchor: null,
  running: false,
  frozenMs: null,
  durationSec: 300,
  overrun: true,
  screens: { stage: true, live: false, stream: false },
  position: "top-right",
  size: "medium",
  color: "#FFFFFF",
  warnAtSec: 30,
};

/**
 * Signed milliseconds on the clock: positive is time left (countdown) or time
 * elapsed (count-up); negative only ever means a countdown has overrun.
 */
export function timerMs(t: ServiceTimer, now: number): number {
  if (!t.running) return t.frozenMs ?? (t.mode === "countdown" ? t.durationSec * 1000 : 0);
  if (t.anchor == null) return t.mode === "countdown" ? t.durationSec * 1000 : 0;
  return t.mode === "countdown" ? t.anchor - now : now - t.anchor;
}

/** "5:00", "1:02:03", or "-0:12" once a countdown has run over. */
export function formatTimer(ms: number): string {
  const neg = ms < 0;
  // Round up, so a timer started at 5:00 reads 5:00 rather than 4:59.
  const total = Math.ceil(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const body = h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
  return neg ? `-${body}` : body;
}

/** normal | warning | overrun - drives the colour, nothing else. */
export function timerPhase(t: ServiceTimer, ms: number): "normal" | "warn" | "over" {
  if (t.mode !== "countdown") return "normal";
  if (ms < 0) return "over";
  if (t.warnAtSec > 0 && ms <= t.warnAtSec * 1000) return "warn";
  return "normal";
}

/** Should this surface draw it at all? */
export function timerVisibleOn(t: ServiceTimer | null | undefined, screen: keyof TimerScreens): boolean {
  if (!t?.enabled || !t.screens?.[screen]) return false;
  // A finished countdown with overrun off stops being interesting at zero.
  if (t.mode === "countdown" && !t.overrun && t.running && t.anchor != null && t.anchor <= Date.now()) {
    return false;
  }
  return true;
}

/** Start (or restart) from the configured duration. */
export function startedTimer(t: ServiceTimer, now: number): ServiceTimer {
  return {
    ...t,
    running: true,
    frozenMs: null,
    anchor: t.mode === "countdown" ? now + t.durationSec * 1000 : now,
  };
}

/** Resume a paused timer, keeping the value it was frozen at. */
export function resumedTimer(t: ServiceTimer, now: number): ServiceTimer {
  const ms = t.frozenMs ?? (t.mode === "countdown" ? t.durationSec * 1000 : 0);
  return { ...t, running: true, frozenMs: null, anchor: t.mode === "countdown" ? now + ms : now - ms };
}

export function pausedTimer(t: ServiceTimer, now: number): ServiceTimer {
  return { ...t, running: false, frozenMs: timerMs(t, now) };
}

export function resetTimer(t: ServiceTimer): ServiceTimer {
  return { ...t, running: false, frozenMs: null, anchor: null };
}
