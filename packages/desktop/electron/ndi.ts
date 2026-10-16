/**
 * Native NDI output (optional).
 *
 * Publishes a BrowserWindow's rendered frames as an NDI source on the local
 * network using the `grandiose` native addon + the NewTek/NDI runtime. Both are
 * OPTIONAL: if either is missing we degrade gracefully (`available: false`) and
 * the app keeps working - the operator can still use the OBS → NDI bridge.
 *
 * Nothing here is imported unless the desktop app runs, and `grandiose` is
 * loaded via a guarded require so a missing addon never crashes the process or
 * the build.
 */
import { createRequire } from "node:module";
import type { BrowserWindow, NativeImage } from "electron";

const require = createRequire(import.meta.url);

export type NdiStatus = {
  available: boolean;
  running: boolean;
  sourceName?: string;
  reason?: string;
  /**
   * How many frames have actually gone out, and how long ago the last one
   * did. A receiver showing a blank picture has two very different causes -
   * nothing is being sent, or it is being sent and not arriving - and from
   * the outside they look identical. This is what tells them apart without
   * guessing.
   */
  framesSent?: number;
  /** Milliseconds since the last frame, or null when none has been sent. */
  lastFrameAgoMs?: number | null;
  /** True when the picture comes from our own window rather than a projector. */
  ownWindow?: boolean;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
// Maintained N-API forks first, then the legacy addon. Whichever resolves and
// exposes `send` wins; a missing addon or NDI runtime just means available:false.
const CANDIDATES = ["@stagetimerio/grandiose", "grandiose"];

let grandiose: any = null;
let loadTried = false;
let loadError: string | undefined;

function loadGrandiose(): any {
  if (loadTried) return grandiose;
  loadTried = true;
  const failures: string[] = [];
  for (const name of CANDIDATES) {
    try {
      const mod = require(name);
      if (mod && typeof mod.send === "function") {
        grandiose = mod;
        return grandiose;
      }
    } catch (err) {
      // Keep every candidate's failure, not just the last one. Reporting only
      // the final error named the legacy fallback ("Cannot find module
      // 'grandiose'") while hiding why the package we actually ship failed,
      // which sent a real diagnosis off in the wrong direction.
      failures.push(`${name}: ${err instanceof Error ? err.message : "load failed"}`);
    }
  }
  if (!grandiose) loadError = failures.length ? failures.join(" | ") : "addon_missing";
  return grandiose;
}

let sender: any = null;
let running = false;
let currentName = "Vifug";
let currentFrameRate = 30;
let frameIntervalMs = 1000 / 30;
let lastFrame = 0;
let boundWin: BrowserWindow | null = null;
/**
 * A window of our own to render when there is no projector to capture.
 *
 * NDI used to capture the projector window and nothing else, which quietly
 * made a second monitor a requirement for it: a laptop with one screen has no
 * projector window, so there was nothing to subscribe to and the sender put
 * out a source carrying no frames at all. From the receiving end that is
 * indistinguishable from NDI being broken - the name appears in OBS and the
 * picture never comes.
 *
 * Sending over the network is the whole point of NDI, so it should not need a
 * monitor. When no projector is open this renders the same projector route
 * offscreen instead, at the size NDI is sending, and captures that. A real
 * projector opening later takes over and this is torn down.
 */
let ownWin: BrowserWindow | null = null;
let makeOwnWin: (() => BrowserWindow) | null = null;
/** Offscreen windows deliver frames through `paint`, not frame subscription. */
let paintHandler: ((e: unknown, dirty: unknown, image: NativeImage) => void) | null = null;
/**
 * The last picture sent, and a timer that keeps sending it.
 *
 * Both capture paths only hand over a frame when something CHANGES. A slide
 * that is just sitting there produces nothing, so a receiver that connects
 * during it - which is the normal way round, since the switcher is set up
 * before the service - waits for the first change before it sees any picture
 * at all. Repeating the last frame makes the source look the way a camera
 * does: always sending, whether or not anything moved.
 */
let lastSent: { data: Buffer; width: number; height: number } | null = null;
let keepalive: ReturnType<typeof setInterval> | null = null;
let framesSent = 0;
let lastSentAt = 0;

export function ndiStatus(): NdiStatus {
  const g = loadGrandiose();
  if (!g) return { available: false, running: false, reason: loadError ?? "addon_missing" };
  return {
    available: true,
    running,
    sourceName: running ? currentName : undefined,
    framesSent,
    lastFrameAgoMs: lastSentAt ? Date.now() - lastSentAt : null,
    ownWindow: !!ownWin && !ownWin.isDestroyed(),
  };
}

export async function ndiStart(
  win: BrowserWindow | null,
  opts: { sourceName: string; frameRate: number },
  /** Builds the offscreen window used when no projector is open. */
  fallback?: () => BrowserWindow,
): Promise<NdiStatus> {
  const g = loadGrandiose();
  if (!g) return ndiStatus();
  if (fallback) makeOwnWin = fallback;

  currentName = opts.sourceName?.trim() || "Vifug";
  currentFrameRate = Math.max(1, Math.min(60, opts.frameRate || 30));
  frameIntervalMs = 1000 / currentFrameRate;

  try {
    g.initialize?.();
    if (!sender) {
      sender = await g.send({ name: currentName, clockVideo: true, clockAudio: false });
    }
    running = true;
    attach(win ?? openOwnWin());
    startKeepalive();
  } catch (err) {
    loadError = err instanceof Error ? err.message : "send_failed";
    running = false;
    sender = null;
    return { available: true, running: false, reason: loadError };
  }
  return ndiStatus();
}

export async function ndiStop(): Promise<NdiStatus> {
  running = false;
  stopKeepalive();
  lastSent = null;
  framesSent = 0;
  lastSentAt = 0;
  detach();
  closeOwnWin();
  try {
    await sender?.destroy?.();
  } catch {
    /* ignore */
  }
  sender = null;
  return ndiStatus();
}

/** Re-point the capture at a new window (e.g. projector reopened). No-op if off. */
export function ndiRebind(win: BrowserWindow | null): void {
  if (!running) return;
  // A real projector always wins; falling back is only for having nothing.
  attach(win ?? openOwnWin());
  if (win) closeOwnWin();
}

function openOwnWin(): BrowserWindow | null {
  if (ownWin && !ownWin.isDestroyed()) return ownWin;
  if (!makeOwnWin) return null;
  try {
    ownWin = makeOwnWin();
    ownWin.on("closed", () => {
      ownWin = null;
    });
    return ownWin;
  } catch {
    ownWin = null;
    return null;
  }
}

function closeOwnWin(): void {
  const w = ownWin;
  ownWin = null;
  if (w && !w.isDestroyed()) {
    try {
      w.destroy();
    } catch {
      /* ignore */
    }
  }
}

function attach(win: BrowserWindow | null): void {
  detach();
  if (!win || win.isDestroyed()) return;
  boundWin = win;
  if (win.webContents.isOffscreen()) {
    // Offscreen rendering paints straight to a NativeImage and never goes
    // through the compositor, which is what lets a window nobody can see
    // produce frames at all.
    win.webContents.setFrameRate(currentFrameRate);
    paintHandler = (_e, _dirty, image) => onFrame(image);
    win.webContents.on("paint", paintHandler as never);
  } else {
    win.webContents.beginFrameSubscription(false, onFrame);
  }
}

function detach(): void {
  if (boundWin && !boundWin.isDestroyed()) {
    try {
      if (paintHandler && boundWin.webContents.isOffscreen()) {
        boundWin.webContents.off("paint", paintHandler as never);
      } else {
        boundWin.webContents.endFrameSubscription();
      }
    } catch {
      /* ignore */
    }
  }
  paintHandler = null;
  boundWin = null;
}

function startKeepalive(): void {
  stopKeepalive();
  keepalive = setInterval(() => {
    if (!running || !sender || !lastSent) return;
    // Only when the picture has gone quiet; a changing slide is already
    // sending at the target rate and does not need help.
    if (Date.now() - lastFrame < frameIntervalMs * 2) return;
    send(lastSent.data, lastSent.width, lastSent.height);
  }, Math.max(100, frameIntervalMs));
}

function stopKeepalive(): void {
  if (keepalive) clearInterval(keepalive);
  keepalive = null;
}

function onFrame(image: NativeImage): void {
  if (!running || !sender) return;
  const now = Date.now();
  if (now - lastFrame < frameIntervalMs) return; // throttle to target fps
  lastFrame = now;

  const { width, height } = image.getSize();
  if (!width || !height) return;
  const data = image.getBitmap(); // BGRA, top-down
  lastSent = { data, width, height };
  send(data, width, height);
}

function send(data: Buffer, width: number, height: number): void {
  framesSent += 1;
  lastSentAt = Date.now();
  try {
    const g = grandiose;
    // Fire-and-forget: awaiting per-frame would backpressure the paint loop.
    // timecode is omitted so the NDI runtime synthesizes a monotonic clock.
    Promise.resolve(
      sender.video({
        xres: width,
        yres: height,
        frameRateN: currentFrameRate * 1000,
        frameRateD: 1000,
        pictureAspectRatio: width / height,
        frameFormatType: g.FORMAT_TYPE_PROGRESSIVE ?? 1,
        fourCC: g.FOURCC_BGRA,
        lineStrideBytes: width * 4,
        data,
      }),
    ).catch(() => {
      /* drop this frame; keep the sender alive */
    });
  } catch {
    /* drop this frame; keep the sender alive */
  }
}
