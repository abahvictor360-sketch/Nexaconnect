/**
 * Which speakers the app plays out of.
 *
 * Every surface that makes a sound - a background video on the projector, a
 * standalone announcement video, a camera feed's own audio - goes through the
 * one device chosen here. Without it the browser sends everything to whatever
 * the OS calls "default", which in a church is routinely the laptop's own
 * speakers rather than the desk feeding the PA: the video plays, the room
 * hears nothing, and the operator has no way to say otherwise from inside the
 * app.
 *
 * The choice lives in settings (so it survives a restart and reaches the
 * projector window), and is mirrored here in a module store + localStorage so
 * a media element can be routed the moment it mounts, without waiting for the
 * settings query to come back.
 */

const STORAGE_KEY = "vifug.audio-output";
const MUTE_KEY = "vifug.audio-output-muted";

/** A media element that can be routed to a named output (Chrome/Edge/Electron). */
type Routable = HTMLMediaElement & {
  setSinkId?: (id: string) => Promise<void>;
  sinkId?: string;
};

export type AudioOutputDevice = { deviceId: string; label: string };

/**
 * Firefox and iOS Safari have no setSinkId: there, "default output" is the
 * only output, and the picker says so rather than offering a control that
 * silently does nothing.
 */
export function audioOutputSupported(): boolean {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function readStoredMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

let current: string | null = readStored();
let muted = readStoredMuted();
const listeners = new Set<(id: string | null) => void>();
const muteListeners = new Set<(m: boolean) => void>();

/** The device id every media element should be routed to; null = system default. */
export function getAudioOutput(): string | null {
  return current;
}

export function setAudioOutput(deviceId: string | null) {
  if (current === deviceId) return;
  current = deviceId;
  try {
    if (deviceId) localStorage.setItem(STORAGE_KEY, deviceId);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode / storage denied - the setting still applies for this window.
  }
  listeners.forEach((l) => l(deviceId));
}

export function subscribeAudioOutput(fn: (id: string | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Master mute. Mirrored the same way as the device, so a projector window
 * opened mid-service comes up silent if the desk has the sound muted, rather
 * than starting loud and being caught a second later.
 */
export function getAudioOutputMuted(): boolean {
  return muted;
}

export function setAudioOutputMuted(next: boolean) {
  if (muted === next) return;
  muted = next;
  try {
    if (next) localStorage.setItem(MUTE_KEY, "1");
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    // As above - the mute still holds for this window.
  }
  muteListeners.forEach((l) => l(next));
}

export function subscribeAudioOutputMuted(fn: (m: boolean) => void): () => void {
  muteListeners.add(fn);
  return () => muteListeners.delete(fn);
}

/**
 * Point one element at the chosen device. Never throws: a device that has
 * since been unplugged, or a browser without the API, must not take the video
 * down with it - it just plays out of the default, same as before.
 */
export async function routeToAudioOutput(el: HTMLMediaElement | null, deviceId: string | null): Promise<void> {
  const media = el as Routable | null;
  if (!media?.setSinkId) return;
  const want = deviceId ?? "";
  if ((media.sinkId ?? "") === want) return;
  try {
    await media.setSinkId(want);
  } catch {
    // NotFoundError (device gone) or NotAllowedError (no permission yet).
  }
}

/**
 * Same, for a Web Audio graph.
 *
 * The Audio Mixer's meter taps a video by routing it through an AudioContext,
 * which takes the sound out of the element and out of that element's route -
 * so without this, opening the mixer would quietly move video sound back to
 * the system default device.
 */
export async function routeContextToAudioOutput(ctx: AudioContext, deviceId: string | null): Promise<void> {
  const routable = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (!routable.setSinkId) return;
  try {
    await routable.setSinkId(deviceId ?? "");
  } catch {
    // Older Chromium, or a device that has gone away - plays out of default.
  }
}

/**
 * Output devices, named. Labels are blank until the page has been granted
 * audio permission once, so a bare enumerate lists "Speaker 1, Speaker 2" -
 * `probe` asks first, which is what the picker does when the operator opens it.
 */
export async function listAudioOutputs(opts?: { probe?: boolean }): Promise<AudioOutputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  if (opts?.probe) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      // Denied - fall through and list whatever is visible without labels.
    }
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === "audiooutput")
    // "default" and "communications" are aliases the OS re-points on its own;
    // the real devices below them are what an operator means to pick.
    .filter((d) => d.deviceId !== "default" && d.deviceId !== "communications")
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Speaker ${i + 1}` }));
}

/**
 * A short test tone on the chosen device, for checking the route before the
 * service rather than during it. Resolves when the tone has finished.
 */
export async function playTestTone(deviceId: string | null): Promise<void> {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = 440;
  // Ramped, not switched: a square-edged start on a PA is a thump through the
  // speakers, which is exactly what a sound check is meant not to do.
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
  osc.connect(gain).connect(dest);

  // Routed through an <audio> element rather than ctx.destination: only
  // elements can be sent to a chosen device.
  const el = new Audio();
  el.srcObject = dest.stream;
  await routeToAudioOutput(el, deviceId);
  osc.start();
  osc.stop(ctx.currentTime + 1);
  try {
    await el.play();
  } catch {
    // Autoplay refused before any gesture - the caller only ever calls this
    // from a click, so this is the rare "device is busy" case.
  }
  await new Promise((r) => setTimeout(r, 1000));
  el.pause();
  el.srcObject = null;
  void ctx.close();
}
