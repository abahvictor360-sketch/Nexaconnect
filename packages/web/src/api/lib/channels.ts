/**
 * Out-of-process channels for the stage display and the phone remote.
 *
 * Like live-store, these let clients that CANNOT share BroadcastChannel (a
 * phone on the LAN, a stage-display laptop, an OBS machine) stay in sync with
 * the operator over the network via Server-Sent Events.
 *
 *  - STAGE:  operator -> stage display. Latest snapshot kept + fanned out.
 *            Carries current slide, next slide, notes and status.
 *  - REMOTE: remote  -> operator. Fire-and-forget commands (next/prev/blank…).
 *            No snapshot; each command is delivered to current subscribers.
 */

export type StageSnapshot = Record<string, unknown> & { rev?: number };
export type RemoteCommand = {
  action: string;
  index?: number;
  ts?: number;
  /** selectSong */
  songId?: string;
  /** selectScripture */
  ref?: string;
  versionId?: string;
  /** selectPresentation */
  presentationId?: string;
  /** cueMedia */
  mediaId?: string;
};

const STAGE_IDLE: StageSnapshot = { status: "idle", rev: 0 };

let stageCurrent: StageSnapshot = STAGE_IDLE;
const stageSubs = new Set<(s: StageSnapshot) => void>();
const remoteSubs = new Set<(c: RemoteCommand) => void>();

export function getStage(): StageSnapshot {
  return stageCurrent;
}

export function setStage(s: StageSnapshot): StageSnapshot {
  stageCurrent = s;
  for (const fn of stageSubs) {
    try {
      fn(s);
    } catch {
      /* ignore */
    }
  }
  return stageCurrent;
}

export function subscribeStage(fn: (s: StageSnapshot) => void): () => void {
  stageSubs.add(fn);
  return () => stageSubs.delete(fn);
}

export function sendRemote(cmd: RemoteCommand): void {
  const withTs = { ...cmd, ts: cmd.ts ?? Date.now() };
  for (const fn of remoteSubs) {
    try {
      fn(withTs);
    } catch {
      /* ignore */
    }
  }
}

export function subscribeRemote(fn: (c: RemoteCommand) => void): () => void {
  remoteSubs.add(fn);
  return () => remoteSubs.delete(fn);
}
