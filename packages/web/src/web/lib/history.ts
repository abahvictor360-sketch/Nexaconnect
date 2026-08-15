/**
 * Live history - every song / Bible passage that has been shown live.
 * Persisted to localStorage so the list survives restarts. Newest first,
 * de-duplicated by item (a song going live again moves to the top instead
 * of piling up entries).
 */

export type LiveHistoryEntry = {
  id: string;
  kind: "lyric" | "bible";
  /** Song title (lyric) or Bible version label (bible). */
  title: string;
  /** Verse reference for bible entries ("John 3:16"); empty for songs. */
  caption: string;
  songId?: string;
  ref?: string;
  versionId?: string;
  at: number;
};

const KEY = "vifug:live-history";
const MAX = 200;

function entryKey(e: Pick<LiveHistoryEntry, "kind" | "songId" | "versionId" | "ref">): string {
  return e.kind === "lyric" ? `lyric:${e.songId}` : `bible:${e.versionId}:${e.ref}`;
}

export function loadHistory(): LiveHistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as LiveHistoryEntry[];
  } catch {
    /* ignore */
  }
  return [];
}

function save(list: LiveHistoryEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/**
 * Record a live event. Returns the updated list - or the SAME array reference
 * when the item is already at the top (so callers can setState without
 * causing pointless re-renders).
 */
export function recordHistory(
  list: LiveHistoryEntry[],
  entry: Omit<LiveHistoryEntry, "id" | "at">,
): LiveHistoryEntry[] {
  const key = entryKey(entry);
  if (list.length > 0 && entryKey(list[0]!) === key) return list;
  const next: LiveHistoryEntry[] = [
    { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now() },
    ...list.filter((e) => entryKey(e) !== key),
  ].slice(0, MAX);
  save(next);
  return next;
}

export function clearHistory(): LiveHistoryEntry[] {
  save([]);
  return [];
}
