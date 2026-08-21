/**
 * A window-wide slot for "the video element currently on air."
 *
 * The Audio Mixer's Media channel needs a real level meter, not a fake
 * animation - but the actual projector is a separate Electron window (or a
 * separate browser tab entirely), so there is no DOM node this module could
 * ever reach there. The operator's own Live column, though, renders the exact
 * same background video inside THIS window (and already plays its audio out
 * loud here when unmuted, same as it always has) - so that element is what
 * gets registered, and the mixer taps it directly.
 */

type Listener = (el: HTMLVideoElement | null) => void;

let current: HTMLVideoElement | null = null;
const listeners = new Set<Listener>();

export function registerLiveMediaVideo(el: HTMLVideoElement | null) {
  current = el;
  listeners.forEach((l) => l(el));
}

export function subscribeLiveMediaVideo(fn: Listener): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

/**
 * One AnalyserNode per video element, cached for the element's lifetime.
 * `createMediaElementSource` can only ever be called once per element - a
 * second call throws - so a hook that re-runs its effect (StrictMode, a
 * re-subscribe) must reuse the same node rather than recreating it.
 */
const analysers = new WeakMap<HTMLVideoElement, AnalyserNode>();

export function getOrCreateAnalyser(el: HTMLVideoElement): AnalyserNode | null {
  const existing = analysers.get(el);
  if (existing) return existing;
  try {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    // The source must still reach the speakers - createMediaElementSource
    // reroutes the element's audio through the graph rather than tapping it,
    // so skipping this connection would silently mute the video.
    const source = ctx.createMediaElementSource(el);
    source.connect(analyser);
    source.connect(ctx.destination);
    analysers.set(el, analyser);
    return analyser;
  } catch {
    // Some browsers refuse a second AudioContext against an element already
    // routed elsewhere - fail quietly, the mixer just shows no meter.
    return null;
  }
}
