import type { MediaItem } from "../hooks/use-media";

/**
 * The browser's own store for files it is holding.
 *
 * Files added on the hosted app are never uploaded, which left them living
 * only in the page - fine for one service, but a reload lost them and so did
 * closing the laptop. IndexedDB is the only browser store that will take a
 * video: localStorage tops out around 5MB of text and a cookie at 4KB, and a
 * cookie would also be sent to the server on every request, which is precisely
 * what "do not store it on the server" was trying to avoid.
 *
 * Nothing here ever leaves the machine. It is the same trade as before with
 * the disappearing removed: not uploaded, not shared, and still deletable from
 * the media library.
 */

const DB_NAME = "vifug";
const DB_VERSION = 1;
const STORE = "media";

export type StoredMedia = { id: string; item: MediaItem; blob: Blob };

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    // Private windows, disabled site data, and a handful of embedded browsers
    // have no usable IndexedDB. Every caller treats null as "no store" and
    // keeps the file in memory for the session, which is what used to happen
    // everywhere - degraded, not broken.
    if (typeof indexedDB === "undefined") return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    // Another tab holding an old version open blocks the upgrade forever;
    // answering null lets this tab carry on in memory rather than hang.
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function done<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function loadAllMedia(): Promise<StoredMedia[]> {
  const db = await open();
  if (!db) return [];
  const rows = await done<StoredMedia[]>(tx(db, "readonly").getAll() as IDBRequest<StoredMedia[]>);
  return rows ?? [];
}

export async function putMedia(row: StoredMedia): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  // A quota refusal is reported rather than thrown: the caller keeps the file
  // in memory and tells the operator it will not survive a reload, which is
  // more use than an upload that appears to fail.
  const ok = await new Promise<boolean>((resolve) => {
    let req: IDBRequest;
    try {
      req = tx(db, "readwrite").put(row);
    } catch {
      return resolve(false);
    }
    req.onsuccess = () => resolve(true);
    req.onerror = () => resolve(false);
  });
  return ok;
}

export async function deleteMedia(id: string): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    await done(tx(db, "readwrite").delete(id));
  } catch {
    /* already gone is the outcome we wanted anyway */
  }
}

/** Roughly how much room is left, when the browser will say. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e || e.usage == null || e.quota == null) return null;
    return { usage: e.usage, quota: e.quota };
  } catch {
    return null;
  }
}

/**
 * Ask the browser not to evict this data when it is short of room.
 *
 * Granted silently in Chrome once the site has been installed or used enough,
 * prompted for in Firefox, and unavailable in Safari. Never blocks anything -
 * a refusal just means the files are ordinary cache and could in principle be
 * cleared, which is the state they would have been in regardless.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
