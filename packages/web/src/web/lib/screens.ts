/**
 * Output screens.
 *
 * Vifug had exactly one live output. Every surface that renders it - the
 * projector window, the OBS browser source, the operator's own preview -
 * subscribed to a single channel, which is why live-bus.ts opens with "one
 * channel, render once output many".
 *
 * That is the right model when every screen shows the same thing, and the
 * wrong one the moment a church wants the stage monitor counting down while
 * the congregation sees a flyer. So a screen is now a thing with an identity,
 * and each one carries its own live state.
 *
 * MAIN_SCREEN keeps every existing name - the same BroadcastChannel, the same
 * localStorage key, the same server channel and the same /api/live/state
 * endpoint. That is deliberate rather than tidy: a projector window left open
 * from a previous version, an OBS source someone configured months ago and a
 * phone remote already on a stand all keep working untouched, and only the
 * screens that did not exist before need new names.
 */

export const MAIN_SCREEN = "main";

export type Screen = {
  id: string;
  /** Shown in the operator UI and the screen picker. */
  name: string;
  /**
   * Electron display id this screen opens on, when the operator has chosen
   * one. null = no preference; a browser screen never has one.
   */
  displayId: number | null;
};

export const DEFAULT_SCREENS: Screen[] = [
  { id: MAIN_SCREEN, name: "Main screen", displayId: null },
];

/** ids are used in channel names, URLs and localStorage keys. */
export function isValidScreenId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(id);
}

/** A readable, unique, URL-safe id derived from the name the operator typed. */
export function screenIdFrom(name: string, taken: readonly string[]): string {
  const base =
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "screen";
  if (!taken.includes(base) && isValidScreenId(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`.slice(0, 32);
    if (!taken.includes(candidate)) return candidate;
  }
  return `screen-${Date.now().toString(36)}`;
}

/* ---- the four names a screen owns -------------------------------------- */
/* Main keeps the unsuffixed form so nothing already pointed at it breaks.  */

/** BroadcastChannel name (same-machine windows). */
export function busChannel(screenId: string): string {
  return screenId === MAIN_SCREEN ? "vifug-live" : `vifug-live:${screenId}`;
}

/** localStorage snapshot key, so a window opening late syncs immediately. */
export function snapshotKey(screenId: string): string {
  return screenId === MAIN_SCREEN ? "vifug:live-state" : `vifug:live-state:${screenId}`;
}

/** Server channel id, used by the SSE/long-poll feed and the DB snapshot. */
export function serverChannel(screenId: string): string {
  return screenId === MAIN_SCREEN ? "live" : `live:${screenId}`;
}

/** Where the operator POSTs this screen's state for out-of-process clients. */
export function stateEndpoint(screenId: string): string {
  return screenId === MAIN_SCREEN
    ? "/api/live/state"
    : `/api/live/state?screen=${encodeURIComponent(screenId)}`;
}

/** The address to open this screen on another device. */
export function screenUrl(screenId: string, origin = ""): string {
  return screenId === MAIN_SCREEN
    ? `${origin}/#/projector`
    : `${origin}/#/projector?screen=${encodeURIComponent(screenId)}`;
}

/**
 * Which screen is this surface? Read from the hash query, since the app is a
 * hash router and `location.search` is empty for `/#/projector?screen=x`.
 */
export function screenFromLocation(): string {
  if (typeof window === "undefined") return MAIN_SCREEN;
  const hash = window.location.hash || "";
  const q = hash.indexOf("?");
  if (q === -1) return MAIN_SCREEN;
  const id = new URLSearchParams(hash.slice(q + 1)).get("screen");
  return id && isValidScreenId(id) ? id : MAIN_SCREEN;
}
