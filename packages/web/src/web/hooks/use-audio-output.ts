import { useEffect, useSyncExternalStore } from "react";
import {
  getAudioOutput,
  getAudioOutputMuted,
  routeToAudioOutput,
  setAudioOutput,
  setAudioOutputMuted,
  subscribeAudioOutput,
  subscribeAudioOutputMuted,
} from "../lib/audio-output";

/** The output device every sound in this window should go to. null = system default. */
export function useAudioOutput(): string | null {
  return useSyncExternalStore(subscribeAudioOutput, getAudioOutput, () => null);
}

/** True while the master output mute is on - nothing the app plays is heard. */
export function useAudioOutputMuted(): boolean {
  return useSyncExternalStore(subscribeAudioOutputMuted, getAudioOutputMuted, () => false);
}

/**
 * Publishes the operator's chosen output device to this window.
 *
 * Called by every surface that loads settings (operator, projector, stream);
 * the media elements themselves read the store rather than settings, so a
 * background video mounting mid-render is routed without threading the device
 * through half the component tree.
 */
export function usePublishAudioOutput(deviceId: string | null | undefined, outputMuted?: boolean) {
  useEffect(() => {
    setAudioOutput(deviceId ?? null);
  }, [deviceId]);
  useEffect(() => {
    setAudioOutputMuted(outputMuted ?? false);
  }, [outputMuted]);
}

/**
 * Keeps one media element pointed at the chosen device - on mount, when the
 * operator changes it mid-service, and when the element's source changes
 * (some browsers reset the route with the stream).
 */
export function useRoutedAudio(
  ref: React.RefObject<HTMLMediaElement | null>,
  ...deps: unknown[]
) {
  const deviceId = useAudioOutput();
  useEffect(() => {
    void routeToAudioOutput(ref.current, deviceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, deviceId, ...deps]);
}
