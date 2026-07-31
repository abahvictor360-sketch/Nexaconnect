/**
 * Minimal OBS WebSocket v5 client — just enough to authenticate and "teleport"
 * the live stream overlay into OBS as a Browser Source, with no manual
 * copy-paste of a URL into a source dialog.
 *
 * Protocol: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
 * Connect -> server sends Hello (op 0) -> client sends Identify (op 1, with a
 * SHA256(password+salt) then SHA256(that+challenge) response if auth is
 * enabled) -> server sends Identified (op 2) -> client sends Request (op 6),
 * server replies RequestResponse (op 7).
 */

type ObsMessage = { op: number; d: Record<string, unknown> };

export class ObsError extends Error {}

async function sha256Base64(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

type Send = (requestType: string, requestData?: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** Opens a connection, authenticates, runs `work`, then always closes the socket. */
async function withObs<T>(
  opts: { host: string; port: number; password?: string | null },
  work: (send: Send) => Promise<T>,
): Promise<T> {
  const ws = new WebSocket(`ws://${opts.host}:${opts.port}`);
  const pending = new Map<string, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  let reqId = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new ObsError("Timed out connecting to OBS.")), 6000);
      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new ObsError("Could not reach OBS — check the host/port and that the WebSocket server is enabled."));
      };
      ws.onmessage = (ev) => {
        void (async () => {
          const msg = JSON.parse(ev.data as string) as ObsMessage;
          if (msg.op === 0) {
            // Hello — authenticate if OBS requires it, then Identify.
            const auth = msg.d.authentication as { challenge: string; salt: string } | undefined;
            const identify: Record<string, unknown> = { rpcVersion: 1 };
            if (auth) {
              if (!opts.password) {
                clearTimeout(timeout);
                reject(new ObsError("OBS requires a password — copy it from Tools → WebSocket Server Settings."));
                return;
              }
              const secret = await sha256Base64(opts.password + auth.salt);
              identify.authentication = await sha256Base64(secret + auth.challenge);
            }
            ws.send(JSON.stringify({ op: 1, d: identify }));
          } else if (msg.op === 2) {
            clearTimeout(timeout);
            resolve();
          } else if (msg.op === 7) {
            const requestId = msg.d.requestId as string;
            const p = pending.get(requestId);
            if (!p) return;
            pending.delete(requestId);
            const status = msg.d.requestStatus as { result: boolean; comment?: string };
            if (status.result) p.resolve((msg.d.responseData as Record<string, unknown>) ?? {});
            else p.reject(new ObsError(status.comment || "OBS rejected the request."));
          }
        })();
      };
    });

    const send: Send = (requestType, requestData) =>
      new Promise((resolve, reject) => {
        const requestId = String(++reqId);
        pending.set(requestId, { resolve, reject });
        ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
        setTimeout(() => {
          if (pending.delete(requestId)) reject(new ObsError(`OBS did not respond to ${requestType}.`));
        }, 8000);
      });

    return await work(send);
  } finally {
    for (const p of pending.values()) p.reject(new ObsError("Connection closed."));
    pending.clear();
    ws.close();
  }
}

export async function testObsConnection(opts: {
  host: string;
  port: number;
  password?: string | null;
}): Promise<{ obsVersion: string }> {
  return withObs(opts, async (send) => {
    const d = await send("GetVersion");
    return { obsVersion: (d.obsVersion as string) ?? "unknown" };
  });
}

/**
 * Teleport: create (or update, if one already exists) a Browser Source input
 * named `inputName` pointing at `url`, placed in whatever scene is currently
 * on program. Re-running this (e.g. after moving OBS to a new scene) just
 * re-adds it there — safe to click again.
 */
export async function teleportToObs(opts: {
  host: string;
  port: number;
  password?: string | null;
  url: string;
  inputName: string;
}): Promise<{ sceneName: string; created: boolean }> {
  return withObs(opts, async (send) => {
    const inputSettings = { url: opts.url, width: 1920, height: 1080, reroute_audio: false };

    const { currentProgramSceneName } = (await send("GetCurrentProgramScene")) as {
      currentProgramSceneName: string;
    };
    const { inputs } = (await send("GetInputList")) as { inputs: { inputName: string }[] };
    const exists = inputs.some((i) => i.inputName === opts.inputName);

    if (exists) {
      await send("SetInputSettings", { inputName: opts.inputName, inputSettings, overlay: true });
      const { sceneItems } = (await send("GetSceneItemList", { sceneName: currentProgramSceneName })) as {
        sceneItems: { sourceName: string }[];
      };
      if (!sceneItems.some((i) => i.sourceName === opts.inputName)) {
        await send("CreateSceneItem", { sceneName: currentProgramSceneName, sourceName: opts.inputName });
      }
      return { sceneName: currentProgramSceneName, created: false };
    }

    await send("CreateInput", {
      sceneName: currentProgramSceneName,
      inputName: opts.inputName,
      inputKind: "browser_source",
      inputSettings,
      sceneItemEnabled: true,
    });
    return { sceneName: currentProgramSceneName, created: true };
  });
}
