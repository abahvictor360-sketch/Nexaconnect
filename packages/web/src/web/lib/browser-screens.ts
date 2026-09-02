import type { DisplayInfo } from "./desktop";

/**
 * Putting the output on a second monitor from a browser.
 *
 * The desktop app asks Electron for the displays and opens a frameless window
 * on the one it wants. A browser used to have nothing of the sort, so the
 * hosted app could only do window.open at a default size on whatever screen
 * the operator was already looking at - they then had to drag it across and
 * fullscreen it by hand, every service.
 *
 * The Window Management API closes that gap. Chrome and Edge (and Chromium
 * derivatives) can enumerate the monitors attached to the machine and open a
 * window positioned on a specific one, which is exactly what is needed. It is
 * permission-gated, because knowing how many screens someone has and where
 * they are is a real fingerprinting surface, and the prompt only appears in
 * response to a click - so this is never called on load.
 *
 * Firefox and Safari have neither the API nor an equivalent. There the honest
 * answer is a plain window the operator moves themselves, which is what they
 * had before, and the UI says so rather than offering a monitor picker that
 * cannot pick.
 */

type ScreenDetailed = {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  left: number;
  top: number;
  width: number;
  height: number;
  isPrimary: boolean;
  isInternal: boolean;
  label: string;
  devicePixelRatio: number;
};

type ScreenDetails = {
  screens: ScreenDetailed[];
  currentScreen: ScreenDetailed;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
};

type WindowWithScreens = Window & {
  getScreenDetails?: () => Promise<ScreenDetails>;
};

export function supportsMultiScreen(): boolean {
  return typeof window !== "undefined" && typeof (window as WindowWithScreens).getScreenDetails === "function";
}

/** More than one monitor is attached, as far as the browser will say without asking. */
export function looksMultiScreen(): boolean {
  // isExtended is readable without permission and answers only yes/no, which
  // is enough to decide whether asking for the rest is worth a prompt.
  return (
    typeof window !== "undefined" &&
    (window.screen as Screen & { isExtended?: boolean }).isExtended === true
  );
}

let details: ScreenDetails | null = null;
const listeners = new Set<() => void>();

export function subscribeBrowserScreens(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* one bad listener must not stop the others */
    }
  }
}

/**
 * Ask for the monitor list, prompting if this is the first time.
 *
 * Only ever called from a click, because that is the only moment a browser
 * will show the prompt. A refusal - or a browser without the API - resolves to
 * an empty list rather than throwing, and every caller treats that as "open a
 * plain window the operator moves themselves".
 */
export async function loadBrowserScreens(): Promise<DisplayInfo[]> {
  const w = window as WindowWithScreens;
  if (!w.getScreenDetails) return [];
  try {
    if (!details) {
      details = await w.getScreenDetails();
      // Monitors plugged in or unplugged mid-service should show up in the
      // picker the same way they do in the desktop app.
      details.addEventListener("screenschange", emit);
    }
    return toDisplays(details);
  } catch {
    // Permission denied, or the prompt dismissed.
    return [];
  }
}

/**
 * Pick the list back up on a later visit without prompting again.
 *
 * The permission is remembered by the browser but the details object is not,
 * so without this the operator would be asked to "find my screens" once per
 * page load for a permission they already granted. Asking the permission
 * registry first is what keeps it silent: calling getScreenDetails blind would
 * prompt.
 */
export async function restoreBrowserScreens(): Promise<DisplayInfo[]> {
  if (details) return toDisplays(details);
  if (!supportsMultiScreen()) return [];
  try {
    const status = await navigator.permissions?.query({
      name: "window-management" as PermissionName,
    });
    if (status?.state !== "granted") return [];
  } catch {
    // Older Chrome called it window-placement, and a browser that does not
    // know the name at all throws. Neither is worth a prompt.
    return [];
  }
  return loadBrowserScreens();
}

/** Whatever has already been granted, without prompting. */
export function browserScreens(): DisplayInfo[] {
  return details ? toDisplays(details) : [];
}

function toDisplays(d: ScreenDetails): DisplayInfo[] {
  return d.screens.map((s, i) => ({
    // There is no stable id in the API, so position stands in for one. It is
    // enough to reopen on the same monitor within a session, which is all the
    // browser path claims to do.
    id: i,
    label: s.label || (s.isInternal ? "Built-in display" : `Display ${i + 1}`),
    bounds: { x: s.left, y: s.top, width: s.width, height: s.height },
    size: { width: s.width, height: s.height },
    scaleFactor: s.devicePixelRatio,
    isPrimary: s.isPrimary,
    internal: s.isInternal,
  }));
}

/** The monitor the output belongs on: not the operator's, if there is a choice. */
export function preferredScreen(displays: DisplayInfo[], displayId?: number | null): DisplayInfo | null {
  if (displayId != null) {
    const pinned = displays.find((d) => d.id === displayId);
    if (pinned) return pinned;
  }
  return displays.find((d) => !d.isPrimary) ?? null;
}

let projectorWindow: Window | null = null;

/**
 * Open (or move) the projector window.
 *
 * Deliberately synchronous. window.open is only allowed while the click that
 * asked for it is still "active", and an await in front of it spends that
 * activation - the first cut asked for the monitor list first and the popup
 * was silently blocked every time. So this opens with whatever monitors are
 * already known (see requestScreens, which does the asking on its own click)
 * and places the window in the same breath.
 *
 * `screenId` names an extra screen so its own address is loaded; omitted means
 * the main output. `placed` says whether it landed on a monitor of its own, so
 * the caller can tell the operator to drag it across when it did not.
 */
export function openBrowserProjector(opts?: {
  displayId?: number | null;
  screenId?: string | null;
}): { opened: boolean; placed: boolean } {
  const route = opts?.screenId
    ? `/#/projector?screen=${encodeURIComponent(opts.screenId)}`
    : "/#/projector";
  const name = `vifug-projector-${opts?.screenId ?? "main"}`;

  const target = preferredScreen(browserScreens(), opts?.displayId);

  // Reusing the name means a second click moves the window that is already
  // open rather than leaving a stranded one behind it.
  if (projectorWindow && !projectorWindow.closed && !opts?.screenId) {
    projectorWindow.focus();
    if (target) place(projectorWindow, target);
    return { opened: true, placed: !!target };
  }

  const features = target
    ? `popup=1,left=${target.bounds.x},top=${target.bounds.y},width=${target.size.width},height=${target.size.height}`
    : "popup=1,width=1280,height=720";

  const win = window.open(route, name, features);
  if (!win) return { opened: false, placed: false };
  if (!opts?.screenId) projectorWindow = win;
  if (target) place(win, target);
  return { opened: true, placed: !!target };
}

/**
 * Chrome honours left/top at open time but clamps width/height to the screen
 * the opener is on, so the window is nudged again once it exists. Harmless
 * when it already landed correctly.
 */
function place(win: Window, target: DisplayInfo) {
  try {
    win.moveTo(target.bounds.x, target.bounds.y);
    win.resizeTo(target.size.width, target.size.height);
  } catch {
    /* a stricter browser - the window is open, just not positioned */
  }
}

export function closeBrowserProjector() {
  try {
    projectorWindow?.close();
  } catch {
    /* already gone */
  }
  projectorWindow = null;
}

export function browserProjectorOpen(): boolean {
  return !!projectorWindow && !projectorWindow.closed;
}
