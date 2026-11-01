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

/**
 * Nothing heard for this long means whoever was publishing has gone - the
 * projector window closed, the clip ended, Auto-Follow stopped listening.
 * Generous compared with the publish rate so an ordinary hiccup does not
 * blink the meter out.
 */
const STALE_MS = 1200;

/**
 * One meter's worth of "somebody on this machine can hear this".
 *
 * A channel per thing being metered, because the surface that can measure is
 * not the surface that shows the number: a video's sound is in the projector
 * window, and the microphone belongs to whoever opened it. Both are the same
 * shape - measure where the sound is, say so, draw it wherever the mixer
 * happens to be.
 */
function levelChannel(name: string) {
  const listeners = new Set<Listener>();
  let current: number | null = null;
  let lastAt = 0;
  let chan: BroadcastChannel | null = null;

  const fresh = () => current !== null && Date.now() - lastAt < STALE_MS;

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

  function channel(): BroadcastChannel | null {
    if (chan || typeof window === "undefined" || !("BroadcastChannel" in window)) return chan;
    chan = new BroadcastChannel(name);
    chan.onmessage = (e) => deliver((e.data as { level: number | null })?.level ?? null, false);
    return chan;
  }

  return {
    /** Say what is being heard, or null on stopping. */
    publish: (level: number | null) => deliver(level, true),
    /** Levels from this window or any other on the same machine. */
    subscribe(fn: Listener): () => void {
      channel();
      listeners.add(fn);
      fn(fresh() ? current : null);
      return () => listeners.delete(fn);
    },
    /** Whether the last level is recent enough to still mean anything. */
    isFresh: fresh,
    /** True when some window is already metering this, so a second need not. */
    hasPublisher: fresh,
  };
}

const media = levelChannel("vifug.media-level");
const mic = levelChannel("vifug.mic-level");

export const publishMediaLevel = media.publish;
export const subscribeMediaLevel = media.subscribe;
export const isFresh = media.isFresh;

export const publishMicLevel = mic.publish;
export const subscribeMicLevel = mic.subscribe;
export const isMicLevelFresh = mic.isFresh;
/**
 * Whether something else is already listening to the microphone and
 * reporting it - Auto-Follow, or the mic test. The mixer's own meter checks
 * this before opening the device a second time: two streams on one mic means
 * two recording indicators, and some drivers will not hand it out twice.
 */
export const micHasPublisher = mic.hasPublisher;

/** Peak deviation from silence, the shape both meters read. */
export function peakLevel(analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buf);
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
  return Math.min(1, peak / 96);
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
