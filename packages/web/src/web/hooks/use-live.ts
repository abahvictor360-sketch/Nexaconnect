import { useEffect, useState } from "react";
import { liveBus, type LiveState } from "../lib/live-bus";

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
export function useLiveState(): LiveState {
  const [state, setState] = useState<LiveState>(() => liveBus().snapshot());

  useEffect(() => {
    const bus = liveBus();
    setState(bus.snapshot());
    return bus.subscribe(setState);
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      es = new EventSource("/api/live/stream");
      es.addEventListener("live", (e) => {
        try {
          const raw = JSON.parse((e as MessageEvent).data) as Partial<LiveState>;
          // Never let a slow/out-of-order SSE frame stomp a newer broadcast
          // that already arrived over BroadcastChannel.
          setState((prev) => (typeof raw.rev === "number" && raw.rev <= prev.rev ? prev : { ...prev, ...raw }));
        } catch {
          /* ignore malformed frame */
        }
      });
      es.onerror = () => {
        es?.close();
        if (!stopped) setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      stopped = true;
      es?.close();
    };
  }, []);

  return state;
}
