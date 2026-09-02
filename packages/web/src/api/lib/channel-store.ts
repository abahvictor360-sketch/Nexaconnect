/**
 * Durable backing for the live/stage snapshots and the remote command queue,
 * used when the API runs somewhere that cannot keep them in memory.
 *
 * live-store.ts and channels.ts hold these in module-level variables and fan
 * out over SSE. That is right for the Bun server - one process owns every
 * connection - and wrong for serverless, where consecutive requests can land
 * on different instances: the operator's POST updates one instance's memory
 * and the phone's SSE stream is attached to another, so a remote works on the
 * same Wi-Fi (where the LAN reaches that one process) but not over the
 * internet. Here the shared state goes in the database, which both ends see.
 *
 * Nothing switches on its own. `isServerlessRuntime()` decides, and a local or
 * desktop install never reads or writes these tables.
 */
import { eq, gt, asc, desc, lt } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import type { RemoteCommand } from "./channels";

/**
 * Vercel sets VERCEL=1 in every build and every function invocation.
 * CHANNEL_STORE=db forces it on elsewhere; CHANNEL_STORE=memory forces it off,
 * which is the escape hatch if this is ever wrong.
 */
export function isServerlessRuntime(): boolean {
  const forced = process.env.CHANNEL_STORE;
  if (forced === "db") return true;
  if (forced === "memory") return false;
  return !!process.env.VERCEL;
}

export type Snapshot = Record<string, unknown> & { rev?: number };

/** A read that has never been written yields this, matching the in-memory idle. */
const IDLE: Snapshot = { status: "idle", rev: 0 };

/**
 * Channel ids: "live" and "stage" as before, plus "live:<screen>" for every
 * output screen beyond the main one - see web/lib/screens.ts, which owns the
 * naming on the other side of the wire.
 */
export type ChannelId = "live" | "stage" | `live:${string}`;

export async function readSnapshot(id: ChannelId): Promise<Snapshot> {
  const [row] = await db
    .select()
    .from(schema.channelState)
    .where(eq(schema.channelState.id, id));
  if (!row) return IDLE;
  try {
    return JSON.parse(row.payload) as Snapshot;
  } catch {
    return IDLE;
  }
}

export async function writeSnapshot(id: ChannelId, state: Snapshot): Promise<void> {
  const payload = JSON.stringify(state);
  // The client owns `rev` and already refuses to apply an older one, so it is
  // stored as sent rather than recomputed here; a mirror that renumbered
  // revisions would let a stale frame look newer than the broadcast it lost to.
  const rev = typeof state.rev === "number" ? state.rev : 0;
  const updatedAt = new Date().toISOString();
  const updated = await db
    .update(schema.channelState)
    .set({ payload, rev, updatedAt })
    .where(eq(schema.channelState.id, id));
  if (!updated.rowsAffected) {
    await db.insert(schema.channelState).values({ id, payload, rev, updatedAt });
  }
}

export async function appendRemoteCommand(cmd: RemoteCommand): Promise<void> {
  await db.insert(schema.remoteCommands).values({
    payload: JSON.stringify({ ...cmd, ts: cmd.ts ?? Date.now() }),
    createdAt: new Date().toISOString(),
  });
}

/** Commands newer than `after`, oldest first, with the seq to poll from next. */
export async function readRemoteCommandsAfter(
  after: number,
): Promise<{ commands: RemoteCommand[]; seq: number }> {
  const rows = await db
    .select()
    .from(schema.remoteCommands)
    .where(gt(schema.remoteCommands.seq, after))
    .orderBy(asc(schema.remoteCommands.seq))
    .limit(50);
  const commands: RemoteCommand[] = [];
  for (const row of rows) {
    try {
      commands.push(JSON.parse(row.payload) as RemoteCommand);
    } catch {
      /* skip a malformed row rather than stalling the queue on it */
    }
  }
  return { commands, seq: rows.length ? rows[rows.length - 1]!.seq : after };
}

/** The seq a fresh subscriber starts from, so it never replays old commands. */
export async function latestRemoteSeq(): Promise<number> {
  const [row] = await db
    .select({ seq: schema.remoteCommands.seq })
    .from(schema.remoteCommands)
    .orderBy(desc(schema.remoteCommands.seq))
    .limit(1);
  return row?.seq ?? 0;
}

/**
 * Drop commands older than an hour. They are consumed within milliseconds, so
 * anything still here is from a past service and only makes the table grow.
 * Called opportunistically on append; a failure is not worth failing a
 * command over.
 */
export async function pruneRemoteCommands(): Promise<void> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  try {
    await db.delete(schema.remoteCommands).where(lt(schema.remoteCommands.createdAt, cutoff));
  } catch {
    /* best effort */
  }
}
