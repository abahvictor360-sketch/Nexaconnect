/**
 * Making the companion screens actually reachable.
 *
 * The embedded server already listens on 0.0.0.0, so in principle any phone or
 * tablet on the same Wi-Fi can open the stage display or the remote. Two things
 * routinely stop that from working, and neither announces itself: the app can
 * offer the wrong address, and Windows Firewall can silently refuse the
 * connection. Both produce the same symptom - a URL that just times out - so
 * this module exists to pick the right address and to say plainly when the
 * firewall is the thing in the way.
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Windows firewall rule name. Also what the user sees in Windows Defender. */
const RULE_NAME = "Vifug companion screens";

/**
 * Adapters that exist for virtualisation rather than for reaching the room.
 * WSL, Hyper-V, VirtualBox, VMware and Docker all add one, each on its own
 * private subnet that no phone can route to.
 */
const VIRTUAL =
  /(wsl|hyper-?v|virtualbox|vmware|docker|vethernet|loopback|tailscale|zerotier|tap-?windows|bluetooth|npcap)/i;

/** Adapters that are actually plugged into the building's network. */
const PHYSICAL = /^(wi-?fi|wlan|ethernet|en\d|eth\d|wl\w+|local area connection$)/i;

export type LanAddress = {
  address: string;
  /** Adapter name, shown so the operator can tell Wi-Fi from Ethernet. */
  adapter: string;
  /** Higher is more likely to be reachable from another device. */
  score: number;
};

/**
 * This machine's LAN addresses, best first.
 *
 * A typical Windows machine has several IPv4 addresses and only one of them is
 * usable. Every disconnected adapter gets a 169.254.x.x link-local address that
 * nothing can route to, so those are dropped outright rather than ranked -
 * offering one produces a dead link that looks exactly like a broken feature.
 */
export function lanAddressDetails(): LanAddress[] {
  const out: LanAddress[] = [];
  for (const [adapter, entries] of Object.entries(os.networkInterfaces())) {
    for (const net of entries ?? []) {
      if (net.family !== "IPv4" || net.internal) continue;
      const address = net.address;
      // Link-local (APIPA): assigned when an adapter has no DHCP lease.
      if (address.startsWith("169.254.")) continue;

      let score = 0;
      if (/^192\.168\./.test(address)) score += 3;                      // usual home/church router
      else if (/^10\./.test(address)) score += 2;                       // larger managed networks
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) score += 1;  // the rest of RFC1918
      if (PHYSICAL.test(adapter)) score += 2;
      if (VIRTUAL.test(adapter)) score -= 5;

      out.push({ address, adapter, score });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Just the addresses, best first - what the renderer builds URLs from. */
export function lanAddresses(): string[] {
  return lanAddressDetails().map((a) => a.address);
}

export type FirewallState = {
  /** "ok" = allowed, "blocked" = no rule, "unknown" = could not tell. */
  status: "ok" | "blocked" | "unknown";
  /** Only Windows blocks by default and only Windows can be fixed from here. */
  fixable: boolean;
  detail: string;
};

/**
 * Is this app allowed to accept connections from the network?
 *
 * Only meaningful on Windows. macOS prompts the user the first time a program
 * listens and remembers the answer, and desktop Linux generally ships with no
 * inbound filtering at all, so on those platforms there is nothing useful to
 * report and nothing to offer to fix.
 */
export async function firewallState(): Promise<FirewallState> {
  if (process.platform !== "win32") {
    return {
      status: "unknown",
      fixable: false,
      detail:
        process.platform === "darwin"
          ? "macOS asks once, the first time the app accepts a connection. If companion screens cannot connect, allow Vifug under System Settings > Network > Firewall."
          : "No inbound firewall is managed by the app on this system.",
    };
  }

  try {
    // Exits non-zero when no rule of that name exists, which is precisely the
    // "not allowed through yet" case.
    const { stdout } = await run("netsh", [
      "advfirewall", "firewall", "show", "rule", `name=${RULE_NAME}`,
    ]);
    if (/Enabled:\s*Yes/i.test(stdout)) {
      return { status: "ok", fixable: true, detail: "Windows Firewall is allowing companion screens through." };
    }
    return {
      status: "blocked",
      fixable: true,
      detail: "A firewall rule exists for Vifug but it is disabled.",
    };
  } catch {
    return {
      status: "blocked",
      fixable: true,
      detail:
        "Windows Firewall has no rule for Vifug, so other devices on your network cannot connect.",
    };
  }
}

/**
 * Ask Windows to allow inbound connections to this app.
 *
 * Adding a firewall rule needs administrator rights, so this deliberately goes
 * through Start-Process -Verb RunAs and the operator sees the standard Windows
 * elevation prompt. Nothing happens if they decline.
 *
 * The rule is scoped to `remoteip=localsubnet`, which is both safer and more
 * reliable than the alternatives: only devices on the same subnet can reach the
 * app - exactly the phones and tablets this feature is for - and because it is
 * not restricted by profile it keeps working whether Windows has labelled the
 * church Wi-Fi as Private or Public. A profile-scoped rule silently fails on
 * networks marked Public, which is a very common way for this to appear broken.
 */
export async function allowThroughFirewall(exePath: string): Promise<FirewallState> {
  if (process.platform !== "win32") {
    return { status: "unknown", fixable: false, detail: "Not applicable on this platform." };
  }

  // The commands go into a temporary script rather than being nested inside a
  // -Command string. Both the rule name and the install path contain spaces,
  // and quoting them through PowerShell -> Start-Process -> PowerShell -> netsh
  // is a well-known way to produce a rule with a mangled path that silently
  // never matches. A file has no quoting layers to get wrong.
  //
  // The delete first means a stale rule left by an earlier install path is
  // replaced rather than sitting alongside the new one doing nothing; it is
  // expected to fail on a clean machine, hence SilentlyContinue.
  const script = [
    `$ErrorActionPreference = 'SilentlyContinue'`,
    `netsh advfirewall firewall delete rule name="${RULE_NAME}" | Out-Null`,
    `$ErrorActionPreference = 'Stop'`,
    `netsh advfirewall firewall add rule name="${RULE_NAME}" dir=in action=allow ` +
      `program="${exePath}" enable=yes profile=any remoteip=localsubnet`,
  ].join("\r\n");

  const scriptPath = path.join(os.tmpdir(), `vifug-firewall-${process.pid}.ps1`);
  try {
    await fs.writeFile(scriptPath, script, "utf8");
    await run("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList ` +
        `'-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath.replace(/'/g, "''")}'`,
    ]);
  } catch {
    // Declining the elevation prompt lands here; so does a locked-down machine.
    return {
      status: "blocked",
      fixable: true,
      detail:
        "The firewall rule was not added. This needs administrator approval - try again and accept the Windows prompt, or ask whoever manages this computer.",
    };
  } finally {
    await fs.unlink(scriptPath).catch(() => {});
  }

  return firewallState();
}
