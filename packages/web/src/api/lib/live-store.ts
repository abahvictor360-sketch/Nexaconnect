/**
 * Server-side live state store + SSE fan-out.
 *
 * The projector window shares BroadcastChannel/localStorage with the operator,
 * but an OBS browser-source (or any external stream client) runs in a separate
 * process and cannot. So the operator also POSTs live state to the server, which
 * keeps the latest snapshot and streams every change to connected SSE clients
 * (the /stream route). This is what makes streaming / OBS / NDI-bridge work.
 */

export type ServerLiveState = Record<string, unknown> & {
  rev?: number;
  srev?: number;
  /** Which browser published this - see web/lib/live-bus.ts. */
  origin?: string;
};

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
/**
 * The order everything else is judged by.
 *
 * `rev` is counted by the browser that published, so it only ranks that
 * browser's own frames. Two operators - a laptop and a phone, or the same
 * laptop after its storage was cleared - count separately, and the number
 * then goes up and down as they take turns. Anything that dropped an "older"
 * frame therefore froze: the screen kept whichever publisher had climbed
 * highest and ignored the rest, which is a service stuck on its first slide.
 *
 * `srev` is stamped here instead, where there is one of everything, so it
 * only ever increases and ranks frames from every publisher against each
 * other.
 */
const seqs = new Map<string, number>();

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

/**
 * Whether this frame is older than one already taken from the same browser.
 *
 * Each publish is sent as its own fire-and-forget POST, so two slide changes
 * a second apart are two requests racing each other across the room's Wi-Fi,
 * and they do arrive out of order. Whatever landed last used to win and stay
 * won: the operator's own windows looked right, because the local broadcast
 * is instant and in order, while every screen fed from the server sat on the
 * slide before. That is a slide change that simply does not reach the
 * projector or OBS, with nothing to say so.
 *
 * Only frames from the SAME browser can be compared this way - `rev` is its
 * own counter - which is exactly the race worth closing. Two different
 * operators are not racing, they are taking turns, and arrival order is the
 * only order those have.
 */
function isStale(incoming: ServerLiveState, current: ServerLiveState | undefined): boolean {
  if (!current) return false;
  if (!incoming.origin || incoming.origin !== current.origin) return false;
  return typeof incoming.rev === "number" && typeof current.rev === "number"
    ? incoming.rev <= current.rev
    : false;
}

export function setLiveState(state: ServerLiveState, screenId: string = MAIN): ServerLiveState {
  const current = states.get(screenId);
  if (isStale(state, current)) return current!;
  const next = (seqs.get(screenId) ?? 0) + 1;
  seqs.set(screenId, next);
  const stamped: ServerLiveState = { ...state, srev: next };
  states.set(screenId, stamped);
  for (const fn of subsFor(screenId)) {
    try {
      fn(stamped);
    } catch {
      /* ignore individual subscriber errors */
    }
  }
  return stamped;
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
