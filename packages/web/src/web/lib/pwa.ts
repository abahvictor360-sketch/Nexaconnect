import { isDesktop } from "./desktop";

/**
 * Register the service worker - on the hosted app only.
 *
 * The desktop app loads the very same bundle from its own localhost server,
 * so without a guard it would install a service worker over its own origin.
 * That would put a cache in front of an app that ships its assets inside the
 * installer: after an update the window could keep serving the previous
 * version's files, and the only cure would be a cache clear nobody would know
 * to do. It has no offline problem to solve either, being offline by design.
 *
 * Left registered rather than aggressively updated: Vite fingerprints every
 * asset and index.html is fetched network-first, so a new deployment is picked
 * up on the next load without asking the operator to do anything.
 */
export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (isDesktop()) {
    // Also clean up after a build that registered one before this guard
    // existed, so an installed copy is not left with a stale cache forever.
    void navigator.serviceWorker?.getRegistrations?.().then((rs) => {
      for (const r of rs) void r.unregister();
    }).catch(() => {});
    return;
  }
  if (!("serviceWorker" in navigator)) return;
  // Registration competes with the app's own first paint for the network, and
  // an app that installs slightly later is better than one that renders
  // slightly later.
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* an unsupported or blocked worker must not break the app */
    });
  });
}

/**
 * The browser's own install prompt, deferred so it can be offered somewhere
 * that makes sense rather than the instant the page opens.
 *
 * Chrome fires beforeinstallprompt once, and only if the app is installable
 * and not already installed. Safari never fires it at all - there the route is
 * Share -> Add to Home Screen, which is why the UI says that instead of
 * showing a button that would do nothing.
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

export function watchInstallPrompt() {
  if (typeof window === "undefined" || isDesktop()) return;
  window.addEventListener("beforeinstallprompt", (e) => {
    // Without this the browser shows its own mini-infobar and the event is
    // spent; holding it is what lets the app decide where to ask.
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

function emit() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* one bad listener must not stop the others */
    }
  }
}

export function subscribeInstall(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function canInstall(): boolean {
  return deferred !== null;
}

/** Show the browser's install dialog. Resolves true if they installed it. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  // The event is single-use whatever they choose, so it is dropped either way.
  deferred = null;
  emit();
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    return outcome === "accepted";
  } catch {
    return false;
  }
}

/** Already running as an installed app rather than in a browser tab. */
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari's own flag, which predates display-mode and is still the only
    // signal there.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}
