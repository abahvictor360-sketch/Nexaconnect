import { useEffect, useState } from "react";
import type { useDesktop } from "./use-desktop";
import type { LanAddress } from "../lib/desktop";

/**
 * The origin to hand to ANOTHER device on the same network - a phone for
 * Remote, a screen for Stage, a switcher for the Stream overlay.
 * window.location.origin is wrong for this in the desktop app: it's
 * http://127.0.0.1:port, reachable only from this machine itself.
 */
export function useNetworkOrigin(desktop: ReturnType<typeof useDesktop>) {
  const [lanIps, setLanIps] = useState<string[]>([]);
  const [lanDetails, setLanDetails] = useState<LanAddress[]>([]);
  useEffect(() => {
    desktop?.getLanIps?.().then(setLanIps).catch(() => {});
    // Adapter names are only used to label the addresses in Settings, so a
    // build without this call (an older preload) degrades to bare IPs.
    desktop?.getLanDetails?.().then(setLanDetails).catch(() => {});
  }, [desktop]);

  const port = typeof window !== "undefined" ? window.location.port : "";
  const localOrigin = typeof window !== "undefined" ? window.location.origin : "";
  // First LAN address is a reasonable default for the one-click "copy" UI;
  // Settings lists every address when there's more than one (Wi-Fi + Ethernet).
  const networkOrigin = desktop && lanIps[0] ? `http://${lanIps[0]}:${port}` : localOrigin;

  return { lanIps, lanDetails, port, localOrigin, networkOrigin };
}
