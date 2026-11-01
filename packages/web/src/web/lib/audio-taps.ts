/**
 * The Audio Mixer's Media level, measured where the sound actually is.
 *
 * The meter used to be fed by tapping the video element in the operator's own
 * Live column, which only works when that copy is the one being heard. In a
 * real setup it never is: the projector window has the sound, the operator's
 * copy is muted, and a muted element feeds an analyser silence - so the meter
 * sat flat through every video while the room could plainly hear it.
 *
 * So the surface that HAS the sound measures its own level and says so, and
 * any window on this machine can listen. That is the one arrangement where
 * the number on the meter and the sound in the building come from the same
 * place.
 */

type Listener = (level: number | null) => void;

const CHANNEL = "vifug.media-level";
const listeners = new Set<Listener>();
let current: number | null = null;
let lastAt = 0;

/**
 * Nothing heard for this long means whoever was publishing has gone - the
 * projector window closed, the clip ended, the tab went away. Generous
 * compared with the publish rate so an ordinary hiccup does not blink the
 * meter out.
 */
const STALE_MS = 1200;

let chan: BroadcastChannel | null = null;
function channel(): BroadcastChannel | null {
  if (chan || typeof window === "undefined" || !("BroadcastChannel" in window)) return chan;
  chan = new BroadcastChannel(CHANNEL);
  chan.onmessage = (e) => deliver((e.data as { level: number | null })?.level ?? null, false);
  return chan;
}

function deliver(level: number | null, echo: boolean) {
  current = level;
  lastAt = level === null ? 0 : Date.now();
  if (echo) {
    try {
      channel()?.postMessage({ level });
    } catch {
      /* a window without BroadcastChannel still drives its own meter */
    }
  }
  listeners.forEach((l) => {
    try {
      l(level);
    } catch {
      /* one bad listener must not stop the others */
    }
  });
}

/**
 * Say what the sound is doing right now, or null when this surface has
 * stopped being the one making it. Called by whichever copy of the slide is
 * audible - see SlideRender's playAudio.
 */
export function publishMediaLevel(level: number | null) {
  deliver(level, true);
}

/** Levels from this window or any other on the same machine. */
export function subscribeMediaLevel(fn: Listener): () => void {
  channel();
  listeners.add(fn);
  fn(isFresh() ? current : null);
  return () => listeners.delete(fn);
}

/** Whether the last level is recent enough to still mean anything. */
export function isFresh(): boolean {
  return current !== null && Date.now() - lastAt < STALE_MS;
}

/**
 * A level tap that cannot silence the video.
 *
 * createMediaElementSource would be the obvious way to measure, and it is a
 * trap: it REROUTES the element's audio through the graph, permanently and
 * with no way back. In a window that was never clicked the browser leaves
 * that graph suspended, and the video goes quiet - a meter costing the
 * congregation the sound is a far worse bug than a meter that does not move.
 *
 * captureStream hands over a copy of what the element is playing and leaves
 * its own output alone, so the worst this can do is read zeros.
 */
const taps = new WeakMap<HTMLVideoElement, AnalyserNode | null>();

export function levelTap(el: HTMLVideoElement): AnalyserNode | null {
  const existing = taps.get(el);
  if (existing !== undefined) return existing;
  let analyser: AnalyserNode | null = null;
  try {
    const capture = (el as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
    const stream = capture ? capture.call(el) : null;
    if (stream && stream.getAudioTracks().length) {
      const ctx = new AudioContext();
      void ctx.resume().catch(() => {});
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      // Deliberately NOT connected to ctx.destination: this is a copy to
      // look at, and sending it on would play the clip a second time.
      ctx.createMediaStreamSource(stream).connect(analyser);
    }
  } catch {
    analyser = null;
  }
  taps.set(el, analyser);
  return analyser;
}
