import { useEffect, useState } from "react";
import type { useDesktop } from "./use-desktop";

/**
 * Update notice: once per launch, compare the installed app version against
 * the newest GitHub release tag and surface it if newer. Desktop-only (the
 * browser build has no installed version), fails silently offline, and a
 * dismissed version stays dismissed until an even newer one appears.
 */

const RELEASES_LATEST_API = "https://api.github.com/repos/abahvictor360-sketch/vifug-lyrics/releases/latest";
export const DOWNLOAD_PAGE = "https://abahvictor360-sketch.github.io/vifug-lyrics/#download";
const DISMISS_KEY = "vifug-update-dismissed";

/** "v1.3.2" / "1.3.2" → [1,3,2]; returns null if unparseable. */
function parseVer(v: string): number[] | null {
  const m = v.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function isNewer(latest: string, current: string): boolean {
  const l = parseVer(latest);
  const c = parseVer(current);
  if (!l || !c) return false;
  for (let i = 0; i < 3; i++) {
    if (l[i] !== c[i]) return l[i] > c[i];
  }
  return false;
}

export type UpdateInfo = { tag: string; dismiss: () => void };

export function useUpdateCheck(desktop: ReturnType<typeof useDesktop>): UpdateInfo | null {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    // Dev/browser escape hatch: localStorage "vifug-fake-version" pretends the
    // app is that version so the notice can be exercised without a desktop build.
    const fake = typeof localStorage !== "undefined" ? localStorage.getItem("vifug-fake-version") : null;
    if (!desktop?.getAppVersion && !fake) return;
    let cancelled = false;

    (async () => {
      try {
        const current = fake ?? (await desktop!.getAppVersion!());
        const r = await fetch(RELEASES_LATEST_API);
        if (!r.ok) return; // rate-limited or offline - try again next launch
        const rel = (await r.json()) as { tag_name?: string };
        const tag = rel.tag_name;
        if (!tag || !isNewer(tag, current)) return;
        if (localStorage.getItem(DISMISS_KEY) === tag) return; // user said not now
        if (!cancelled) {
          setUpdate({
            tag,
            dismiss: () => {
              localStorage.setItem(DISMISS_KEY, tag);
              setUpdate(null);
            },
          });
        }
      } catch {
        // offline-first app: no network is normal, never surface an error
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [desktop]);

  return update;
}
