/**
 * One subscription helper for the three cross-process channels, over whichever
 * transport the server says it can actually deliver.
 *
 * Server-Sent Events assume one process holds every connection - true of the
 * Bun server and the desktop app, false of a serverless deployment, where the
 * stream a phone opens is attached to whichever instance answered and never
 * sees what the operator does on another. That is why the remote worked on the
 * same Wi-Fi and not over the internet.
 *
 * So the client asks (`GET /api/realtime`) instead of assuming, and falls back
 * to long-polling when told to. Callers do not care which they got.
 */

type Transport = "sse" | "poll";

let probe: Promise<Transport> | null = null;

/** Asked once per page load; the answer is a property of the deployment. */
export function realtimeTransport(): Promise<Transport> {
  probe ??= fetch("/api/realtime")
    .then((r) => (r.ok ? r.json() : { transport: "sse" }))
    .then((d: { transport?: string }) => (d.transport === "poll" ? "poll" : "sse"))
    // A failed probe means SSE: it is what every build did before this existed,
    // so an unreachable endpoint degrades to the old behaviour rather than to
    // no sync at all.
    .catch((): Transport => "sse");
  return probe;
}

/**
 * Subscribe to a snapshot channel ("live" or "stage").
 *
 * `onState` may be called with the same revision twice - after a reconnect,
 * say - so callers must already tolerate that. Every existing one does: they
 * compare `rev` before applying.
 */
export function subscribeSnapshot(
  channel: "live" | "stage",
  onState: (state: Record<string, unknown>) => void,
): () => void {
  let stopped = false;
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;

  const sse = () => {
    if (stopped) return;
    es = new EventSource(`/api/${channel}/stream`);
    es.addEventListener(channel, (e) => {
      try {
        onState(JSON.parse((e as MessageEvent).data) as Record<string, unknown>);
      } catch {
        /* ignore malformed frame */
      }
    });
    es.onerror = () => {
      es?.close();
      if (!stopped) timer = setTimeout(sse, 1500);
    };
  };

  const poll = async () => {
    // -1 asks for the current snapshot immediately rather than waiting for the
    // next change, so a surface opened mid-service is in sync at once.
    let rev = -1;
    while (!stopped) {
      try {
        controller = new AbortController();
        const r = await fetch(`/api/${channel}/poll?rev=${rev}`, { signal: controller.signal });
        if (stopped) return;
        if (r.status === 204) continue; // nothing changed within the hold
        if (!r.ok) throw new Error(String(r.status));
        const { state } = (await r.json()) as { state: Record<string, unknown> };
        if (typeof state?.rev === "number") rev = state.rev;
        onState(state);
      } catch {
        if (stopped) return;
        // Back off briefly so a server that is down is not hammered; the hold
        // itself provides the pacing on the happy path.
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  };

  void realtimeTransport().then((t) => {
    if (stopped) return;
    if (t === "sse") sse();
    else void poll();
  });

  return () => {
    stopped = true;
    es?.close();
    controller?.abort();
    if (timer) clearTimeout(timer);
  };
}

export type RemoteCommandMessage = {
  action: string;
  index?: number;
  songId?: string;
  ref?: string;
  versionId?: string;
  presentationId?: string;
  mediaId?: string;
};

/**
 * Subscribe to remote commands (the operator side of the phone remote).
 *
 * Commands are events, not state, so the poll transport tracks a sequence
 * number instead of a revision: a fresh subscriber starts from the current
 * head so joining never replays a service's worth of old presses, and two
 * "next" commands stay two.
 */
export function subscribeRemoteCommands(
  onCommand: (cmd: RemoteCommandMessage) => void,
): () => void {
  let stopped = false;
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;

  const sse = () => {
    if (stopped) return;
    es = new EventSource("/api/remote/stream");
    es.addEventListener("command", (e) => {
      try {
        onCommand(JSON.parse((e as MessageEvent).data) as RemoteCommandMessage);
      } catch {
        /* ignore malformed frame */
      }
    });
    es.onerror = () => {
      es?.close();
      if (!stopped) timer = setTimeout(sse, 1500);
    };
  };

  const poll = async () => {
    let seq: number | null = null;
    while (!stopped) {
      try {
        controller = new AbortController();
        // No seq on the first call: the reply carries the head to start from.
        const url = seq === null ? "/api/remote/poll" : `/api/remote/poll?seq=${seq}`;
        const r = await fetch(url, { signal: controller.signal });
        if (stopped) return;
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as { commands: RemoteCommandMessage[]; seq: number };
        seq = data.seq;
        for (const cmd of data.commands) onCommand(cmd);
      } catch {
        if (stopped) return;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  };

  void realtimeTransport().then((t) => {
    if (stopped) return;
    if (t === "sse") sse();
    else void poll();
  });

  return () => {
    stopped = true;
    es?.close();
    controller?.abort();
    if (timer) clearTimeout(timer);
  };
}
