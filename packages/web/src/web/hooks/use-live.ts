import { useEffect, useRef, useState } from "react";
import { LIVE_ORIGIN, liveBus, type LiveState } from "../lib/live-bus";
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
   * Two counters, and only one of them ranks anything.
   *
   * `rev` is counted by the browser that published the frame, so it orders
   * that browser's frames and nothing else. With two publishers - a laptop
   * and a phone, or one laptop whose stored count differs from the other's -
   * the numbers interleave and go backwards, and anything that dropped an
   * "older" frame stuck on whichever publisher had counted highest. That is
   * a service frozen on its first slide, with nothing else able to reach the
   * screen afterwards, Bible included.
   *
   * `srev` is stamped by the server as each frame passes through, so it
   * ranks every publisher against every other and only ever goes up. Server
   * frames are ordered by it.
   *
   * The echo of our OWN publication is the one case the server's order is
   * not enough for: the local bus delivered it instantly, so by the time it
   * comes back a newer local frame may already be on screen. That one is
   * recognised by its origin and compared on `rev`, which between two frames
   * from the same publisher is exactly what rev is good for.
   */
  const lastSrev = useRef(0);
  const localRev = useRef(0);

  useEffect(() => {
    const bus = liveBus(screenId);
    lastSrev.current = 0;
    localRev.current = 0;
    setState(bus.snapshot());
    return bus.subscribe((s) => {
      localRev.current = Math.max(localRev.current, s.rev ?? 0);
      setState(s);
    });
  }, [screenId]);

  useEffect(
    () =>
      subscribeSnapshot(serverChannel(screenId), (raw) => {
        const next = raw as Partial<LiveState>;
        const srev = typeof next.srev === "number" ? next.srev : 0;
        // Out of order or already seen. A server too old to stamp sends no
        // srev at all, and then every frame has srev 0 and none is skipped -
        // which is the right way round: applying in arrival order is what
        // the stream overlay has always done.
        if (srev && srev <= lastSrev.current) return;
        if (
          next.origin === LIVE_ORIGIN &&
          typeof next.rev === "number" &&
          next.rev < localRev.current
        ) {
          return;
        }
        lastSrev.current = Math.max(lastSrev.current, srev);
        setState((prev) => ({ ...prev, ...next }));
      }),
    [screenId],
  );

  return state;
}
