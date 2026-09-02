import { useEffect, useSyncExternalStore } from "react";
import {
  isSessionMedia, requestSessionMedia, sessionId, sessionMediaUrl, subscribeSessionMedia,
} from "../lib/session-media";

/**
 * Turn a stored media address into one this document can render.
 *
 * Ordinary media is already a URL and passes straight through. A file held in
 * the browser travels as a "session:<id>" marker instead, because an object
 * URL belongs to the document that made it - so each surface resolves the
 * marker against its own copy of the bytes, asking for them over the
 * same-browser channel if it does not have them yet.
 *
 * Returns "" while the bytes are still on their way, and keeps returning ""
 * on a surface that can never receive them - an OBS browser source, a phone.
 * Nothing renders there, which is the truthful outcome for a file that was
 * deliberately never uploaded.
 */
export function useMediaUrl(url: string | null | undefined): string {
  const session = isSessionMedia(url);
  // Subscribed unconditionally: hooks cannot be called on a condition, and the
  // subscription is inert for ordinary URLs anyway.
  const resolved = useSyncExternalStore(
    subscribeSessionMedia,
    () => (session ? sessionMediaUrl(url!) : null),
    () => null,
  );

  useEffect(() => {
    if (!session || resolved) return;
    requestSessionMedia(sessionId(url!));
  }, [session, resolved, url]);

  if (!url) return "";
  if (!session) return url;
  return resolved ?? "";
}
