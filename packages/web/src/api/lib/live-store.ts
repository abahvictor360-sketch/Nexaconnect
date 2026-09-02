/**
 * Server-side live state store + SSE fan-out.
 *
 * The projector window shares BroadcastChannel/localStorage with the operator,
 * but an OBS browser-source (or any external stream client) runs in a separate
 * process and cannot. So the operator also POSTs live state to the server, which
 * keeps the latest snapshot and streams every change to connected SSE clients
 * (the /stream route). This is what makes streaming / OBS / NDI-bridge work.
 */

export type ServerLiveState = Record<string, unknown> & { rev?: number };

const IDLE: ServerLiveState = { status: "idle", rev: 0 };

/**
 * One state and one subscriber set per output screen.
 *
 * Keyed by screen id ("main" plus whatever the operator has added), so a
 * browser source pointed at the overflow screen is not fed the main screen's
 * slides. Screens are created lazily: an id that has never been published to
 * reads as idle rather than erroring, which is what a projector opened before
 * anything has been sent to it should show anyway.
 */
const MAIN = "main";
const states = new Map<string, ServerLiveState>();
const subscribers = new Map<string, Set<(s: ServerLiveState) => void>>();

function subsFor(screenId: string): Set<(s: ServerLiveState) => void> {
  let set = subscribers.get(screenId);
  if (!set) {
    set = new Set();
    subscribers.set(screenId, set);
  }
  return set;
}

export function getLiveState(screenId: string = MAIN): ServerLiveState {
  return states.get(screenId) ?? IDLE;
}

export function setLiveState(state: ServerLiveState, screenId: string = MAIN): ServerLiveState {
  states.set(screenId, state);
  for (const fn of subsFor(screenId)) {
    try {
      fn(state);
    } catch {
      /* ignore individual subscriber errors */
    }
  }
  return state;
}

export function subscribeLive(
  fn: (s: ServerLiveState) => void,
  screenId: string = MAIN,
): () => void {
  const set = subsFor(screenId);
  set.add(fn);
  return () => set.delete(fn);
}

export function liveSubscriberCount(screenId: string = MAIN): number {
  return subsFor(screenId).size;
}
