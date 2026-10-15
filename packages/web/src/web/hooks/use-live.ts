import { useEffect, useRef, useState } from "react";
import { liveBus, type LiveState } from "../lib/live-bus";
import { subscribeSnapshot } from "../lib/realtime";
import { MAIN_SCREEN, serverChannel } from "../lib/screens";

/**
 * Subscribe to the live output state (used by the projector window, the
 * operator's own media-capture status, and the media library).
 *
 * BroadcastChannel + localStorage (via liveBus) is the primary, instant path
 * between windows in the same app. But it is same-process only - and even
 * within one process, a projector window that opens fresh gets nothing until
 * the NEXT publish if its startup snapshot read raced the very first one, or
 * if BroadcastChannel simply didn't deliver for some reason (background
 * changes silently "not appearing on the projector" is exactly what this
 * looks like from the operator's chair, and there is no in-app signal that a
 * broadcast was dropped). The server-side SSE feed - the same one /stream
 * and /remote already depend on for out-of-process sync - is a second,
 * independent path: every publish already reaches it via publishLive()'s
 * POST to /api/live/state, so subscribing here costs nothing and means a
 * missed broadcast self-heals within one round trip instead of staying wrong
 * until the next unrelated change happens to publish again.
 */
export function useLiveState(screenId: string = MAIN_SCREEN): LiveState {
  const [state, setState] = useState<LiveState>(() => liveBus(screenId).snapshot());
  /*
   * The newest revision this page has heard over the LOCAL bus, or null if it
   * has heard none.
   *
   * Revisions are counted by the browser that publishes them, so they only
   * order frames from one publisher. Comparing a server frame against
   * whatever revision this page happens to be holding was therefore wrong
   * the moment the publisher was somebody else - and it froze the output:
   * a projector or stage screen on another device picks up the last state
   * the server kept, say revision 40, and then the next operator browser to
   * start publishing counts from 1 again. Every frame of the service that
   * followed was "older" than what the screen already had, so the screen sat
   * on last week's slide and last week's background for the whole service,
   * while the operator's own windows - which hear the local bus, not the
   * server - looked perfectly fine.
   *
   * The comparison is only meaningful against revisions from the same
   * counter, which is to say the local bus. A surface that never hears it,
   * which is every surface on another device, now applies server frames in
   * the order the server sends them - the same thing the OBS stream overlay
   * has always done, and the reason that one kept working.
   */
  const localRev = useRef<number | null>(null);

  useEffect(() => {
    const bus = liveBus(screenId);
    localRev.current = null;
    setState(bus.snapshot());
    return bus.subscribe((s) => {
      // Local frames always win: they are this browser's own publication,
      // and taking them also re-anchors the comparison below, so a publisher
      // whose count restarted cannot wedge anything shut.
      localRev.current = s.rev;
      setState(s);
    });
  }, [screenId]);

  useEffect(
    () =>
      subscribeSnapshot(serverChannel(screenId), (raw) => {
        const next = raw as Partial<LiveState>;
        // Never let a slow/out-of-order echo stomp a newer broadcast that
        // already arrived over BroadcastChannel from the same publisher.
        if (localRev.current !== null && typeof next.rev === "number" && next.rev <= localRev.current) {
          return;
        }
        setState((prev) => ({ ...prev, ...next }));
      }),
    [screenId],
  );

  return state;
}
