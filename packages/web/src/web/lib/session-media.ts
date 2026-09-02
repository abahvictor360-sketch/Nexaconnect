import type { MediaItem } from "../hooks/use-media";

/**
 * Media that lives in the browser for one session and is never uploaded.
 *
 * The hosted app has no writable disk, so a background picture has always had
 * to go to object storage. When there is no bucket - or the bucket refuses -
 * the upload simply failed, which left the browser app unable to show a flyer
 * at all. Keeping the file in the page is the honest alternative: nothing is
 * stored anywhere, so there is nothing to configure, nothing to pay for and
 * nothing left behind. The cost is stated rather than hidden: once no Vifug
 * tab is holding the bytes any more, they are gone.
 *
 * The desktop app is unaffected. It has a real disk and writes there, which is
 * what an offline church laptop needs - a background that vanished on restart
 * would be a regression, not a feature.
 */

/** Marks a URI/URL as living in this browser rather than on a server. */
export const SESSION_PREFIX = "session:";

export function isSessionMedia(uri: string | null | undefined): boolean {
  return !!uri && uri.startsWith(SESSION_PREFIX);
}

export function sessionId(uri: string): string {
  return uri.slice(SESSION_PREFIX.length);
}

type Entry = { item: MediaItem; blob: Blob };

/** Files this document holds, and the object URLs it has minted for them. */
const entries = new Map<string, Entry>();
const objectUrls = new Map<string, string>();
const listeners = new Set<() => void>();

function notify() {
  rebuild();
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* a bad listener must not stop the others */
    }
  }
}

/** Re-render callers when the set of session files changes. */
export function subscribeSessionMedia(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/*
 * Same-browser fan-out.
 *
 * An object URL belongs to the document that created it, so handing the
 * projector window a blob: address created in the operator window is a link
 * that dies with whoever made it. The blob itself is structured-cloneable, so
 * the surfaces pass the FILE between them and each mints its own URL. That
 * also makes a projector self-sufficient once it has been given the bytes.
 *
 * This reaches windows of the same browser and no further. An OBS browser
 * source is a separate browser, and a phone is a separate machine; neither can
 * be handed a file that was never uploaded. That is the trade, and the media
 * library says so.
 */
const CHANNEL = "vifug-session-media";
let chan: BroadcastChannel | null = null;

function bus(): BroadcastChannel | null {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return null;
  if (chan) return chan;
  chan = new BroadcastChannel(CHANNEL);
  chan.onmessage = (e) => {
    const msg = e.data as
      | { t: "want"; id: string }
      | { t: "have"; id: string; blob: Blob; item: MediaItem };
    if (!msg) return;
    if (msg.t === "want") {
      const held = entries.get(msg.id);
      if (held) chan!.postMessage({ t: "have", id: msg.id, blob: held.blob, item: held.item });
      return;
    }
    if (msg.t === "have" && !entries.has(msg.id)) {
      entries.set(msg.id, { item: msg.item, blob: msg.blob });
      notify();
    }
  };
  return chan;
}

/** Ask whoever holds this file to send it over. */
export function requestSessionMedia(id: string) {
  bus()?.postMessage({ t: "want", id });
}

/** Take a file into this session. Returns the MediaItem the app renders. */
export function addSessionMedia(file: File): MediaItem {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const uri = SESSION_PREFIX + id;
  const type: MediaItem["type"] = file.type.startsWith("video")
    ? "video"
    : file.type.startsWith("audio")
      ? "audio"
      : "image";
  const item: MediaItem = {
    id: uri,
    type,
    uri,
    // The marker travels as the url too. Every surface resolves it for itself,
    // and one that cannot resolve it shows nothing rather than a broken image.
    url: uri,
    loop: 1,
    fit: null,
    muted: 1,
    colorFilter: null,
    createdAt: new Date().toISOString(),
    sessionOnly: true,
    name: file.name,
  };
  entries.set(id, { item, blob: file });
  // Open the bytes to the other surfaces immediately: a projector already on a
  // monitor should not have to ask before the first slide is sent to it.
  bus()?.postMessage({ t: "have", id, blob: file, item });
  notify();
  return item;
}

/**
 * Everything this browser is holding, newest first.
 *
 * The array is cached and only rebuilt when the set actually changes:
 * useSyncExternalStore compares snapshots by identity, and a fresh array on
 * every read is an infinite render loop rather than a slow one.
 */
let snapshot: MediaItem[] = [];
export function listSessionMedia(): MediaItem[] {
  return snapshot;
}
function rebuild() {
  snapshot = [...entries.values()].map((e) => e.item).reverse();
}

export function removeSessionMedia(uri: string) {
  const id = sessionId(uri);
  const url = objectUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(id);
  }
  entries.delete(id);
  notify();
}

/** Patch the render options of a held file, as the library's toggles do. */
export function updateSessionMedia(uri: string, patch: Partial<MediaItem>) {
  const id = sessionId(uri);
  const held = entries.get(id);
  if (!held) return;
  held.item = { ...held.item, ...patch };
  bus()?.postMessage({ t: "have", id, blob: held.blob, item: held.item });
  notify();
}

/**
 * A URL this document can actually render, or null when the bytes are not
 * here. Minted once per file and kept, so re-rendering does not leak a new
 * object URL every frame.
 */
export function sessionMediaUrl(uri: string): string | null {
  const id = sessionId(uri);
  const existing = objectUrls.get(id);
  if (existing) return existing;
  const held = entries.get(id);
  if (!held) return null;
  const url = URL.createObjectURL(held.blob);
  objectUrls.set(id, url);
  return url;
}
