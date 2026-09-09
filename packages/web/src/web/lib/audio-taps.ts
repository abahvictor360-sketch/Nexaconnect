/**
 * A window-wide slot for "the video element currently on air."
 *
 * The Audio Mixer's Media channel needs a real level meter, not a fake
 * animation - but the actual projector is a separate Electron window (or a
 * separate browser tab entirely), so there is no DOM node this module could
 * ever reach there. The operator's own Live column, though, renders the exact
 * same background video inside THIS window - so when that copy is the one
 * being heard (see SlideRender's playAudio), it is what gets registered and
 * the mixer taps it directly. When the sound is coming out of another window
 * instead, nothing is registered: a muted element feeds the analyser silence,
 * and a meter reading flat would say "dead channel" rather than "playing
 * somewhere else".
 */

import { getAudioOutput, routeContextToAudioOutput, subscribeAudioOutput } from "./audio-output";

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
    // The graph now owns this element's sound, so the operator's chosen
    // speakers have to be set on the graph too - otherwise opening the mixer
    // moves the video's audio back to the system default device.
    void routeContextToAudioOutput(ctx, getAudioOutput());
    subscribeAudioOutput((id) => void routeContextToAudioOutput(ctx, id));
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
