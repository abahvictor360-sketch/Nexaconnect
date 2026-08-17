import { useCallback, useEffect, useRef, useState } from "react";
import type { useDesktop } from "./use-desktop";

/**
 * Finding out that a new version exists, and what is in it.
 *
 * Two different questions, deliberately answered differently. On launch the
 * app checks quietly and only interrupts when there is genuinely something
 * new, because being told "you are up to date" every Sunday morning is noise.
 * Asking on purpose, from the menu, always gets an answer - silence in
 * response to a direct question reads as broken.
 *
 * A version the operator has waved away stays waved away until a newer one
 * appears, but a manual check ignores that: it is an explicit request to look
 * again.
 */

/**
 * Read straight from the release host. Routing this through vifug.com would
 * keep the repository out of the shipped app, but it would also make every
 * update check depend on that site being deployed and reachable - a silent
 * failure in the one feature whose whole job is to tell you something changed.
 * The download page the operator is sent to is still the site's own.
 */
const RELEASES_LATEST_API = "https://api.github.com/repos/abahvictor360-sketch/vifug-lyrics/releases/latest";
export const DOWNLOAD_PAGE = "https://vifug.com/#download";
const DISMISS_KEY = "vifug-update-dismissed";

/** "v1.3.2" / "1.3.2" -> [1,3,2]; returns null if unparseable. */
function parseVer(v: string): number[] | null {
  const m = v.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function isNewer(latest: string, current: string): boolean {
  const l = parseVer(latest);
  const c = parseVer(current);
  if (!l || !c) return false;
  for (let i = 0; i < 3; i++) {
    if (l[i] !== c[i]) return (l[i] ?? 0) > (c[i] ?? 0);
  }
  return false;
}

export type ReleaseInfo = {
  tag: string;
  /** Release title, falling back to the tag when the release has no name. */
  name: string;
  /** Raw markdown release notes - what changed. */
  notes: string;
  url: string;
  publishedAt: string | null;
};

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current"; version: string }
  | { kind: "available"; release: ReleaseInfo; version: string }
  | { kind: "error"; message: string };

export function useUpdateCheck(desktop: ReturnType<typeof useDesktop>) {
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const startedRef = useRef(false);

  const check = useCallback(
    async (manual: boolean) => {
      // Dev/browser escape hatch: localStorage "vifug-fake-version" pretends
      // the app is that version so the flow can be exercised without a build.
      const fake = typeof localStorage !== "undefined" ? localStorage.getItem("vifug-fake-version") : null;
      const current = fake ?? (desktop?.getAppVersion ? await desktop.getAppVersion() : null);
      if (!current) {
        if (manual) {
          setStatus({
            kind: "error",
            message: "Update checking is only available in the installed desktop app.",
          });
          setDialogOpen(true);
        }
        return;
      }

      setStatus({ kind: "checking" });
      if (manual) setDialogOpen(true);

      try {
        const r = await fetch(RELEASES_LATEST_API, { headers: { Accept: "application/vnd.github+json" } });
        if (!r.ok) {
          throw new Error(
            r.status === 403
              ? "Update checks are being rate-limited. Try again shortly."
              : "Could not reach the update server.",
          );
        }
        const rel = (await r.json()) as {
          tag_name?: string; name?: string; body?: string; published_at?: string;
        };
        const tag = rel.tag_name;
        if (!tag) throw new Error("No published release was found.");

        if (!isNewer(tag, current)) {
          setStatus({ kind: "current", version: current });
          return;
        }

        const release: ReleaseInfo = {
          tag,
          name: rel.name?.trim() || tag,
          notes: rel.body?.trim() || "",
          // Send people to the site's download section, not the release page.
          url: DOWNLOAD_PAGE,
          publishedAt: rel.published_at ?? null,
        };
        setStatus({ kind: "available", release, version: current });

        // Automatic checks respect a previous "not now"; a manual one does not.
        if (manual || localStorage.getItem(DISMISS_KEY) !== tag) setDialogOpen(true);
      } catch (e) {
        setStatus({ kind: "error", message: (e as Error).message });
        // An offline-first app must never nag about having no network. Only a
        // check the operator asked for reports that it failed.
        if (!manual) setDialogOpen(false);
      }
    },
    [desktop],
  );

  // One quiet check per launch.
  useEffect(() => {
    if (startedRef.current) return;
    const hasVersion = !!desktop?.getAppVersion ||
      (typeof localStorage !== "undefined" && !!localStorage.getItem("vifug-fake-version"));
    if (!hasVersion) return;
    startedRef.current = true;
    void check(false);
  }, [desktop, check]);

  /** "Not now" - mute this exact version until a newer one ships. */
  const dismiss = useCallback(() => {
    if (status.kind === "available") localStorage.setItem(DISMISS_KEY, status.release.tag);
    setDialogOpen(false);
  }, [status]);

  return {
    status,
    dialogOpen,
    /** Ask now, from the menu. Always reports back. */
    checkNow: () => check(true),
    dismiss,
    close: () => setDialogOpen(false),
    /** The badge in the header shows only for a genuinely newer version. */
    available: status.kind === "available" ? status.release : null,
    openDialog: () => setDialogOpen(true),
  };
}
