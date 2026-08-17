import { useCallback, useEffect, useState } from "react";
import { normalize, type TextFormat } from "../lib/rich-text";

/**
 * Emphasis applied to Bible verses.
 *
 * Songs and slides own their text, so their formatting is stored with them. A
 * verse is different: it comes out of a read-only version file that the app
 * must never rewrite, and the same verse can be marked up differently from one
 * service to the next. So the formatting is kept separately, keyed by the
 * slide id (version + book + chapter + verse), which is stable and already
 * unique.
 *
 * It lives in localStorage rather than the database because it belongs to this
 * machine's operator rather than to the shared library, and because a service
 * is usually prepared days ahead - losing the markup on restart would make the
 * feature useless for exactly the case it exists for.
 */
const KEY = "vifug:verse-formats";

type Store = Record<string, TextFormat[]>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function useVerseFormats() {
  const [store, setStore] = useState<Store>(() => (typeof window === "undefined" ? {} : read()));

  // Another window (a second operator screen, the projector) may mark up the
  // same verse; picking up its writes keeps them from silently diverging.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setStore(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const formatsFor = useCallback((slideId: string): TextFormat[] => store[slideId] ?? [], [store]);

  const setFormatsFor = useCallback((slideId: string, formats: TextFormat[]) => {
    setStore((prev) => {
      const clean = normalize(formats);
      const next = { ...prev };
      // Dropping the key entirely when nothing is left keeps the store from
      // growing an empty entry for every verse ever glanced at.
      if (clean.length) next[slideId] = clean;
      else delete next[slideId];
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* quota or private mode - the markup is still live for this session */
      }
      return next;
    });
  }, []);

  return { formatsFor, setFormatsFor };
}
