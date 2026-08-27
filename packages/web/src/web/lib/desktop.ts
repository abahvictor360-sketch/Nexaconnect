/** Type definition for the Electron preload API exposed via contextBridge */
export interface ElectronAPI {
  platform: string;
  /** Installed app version, e.g. "1.3.1". Optional: older installs lack it. */
  getAppVersion?: () => Promise<string>;

  // Dialog
  showOpenDialog: (opts: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
    properties?: string[];
  }) => Promise<string[]>;
  showSaveDialog: (opts: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<string | null>;

  // File system
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;

  // Notifications
  showNotification: (title: string, body: string) => Promise<void>;

  // Window controls
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;

  // Displays + projector
  listDisplays: () => Promise<DisplayInfo[]>;
  /** Fires whenever a monitor is plugged/unplugged or its bounds change. */
  onDisplaysChanged: (cb: (displays: DisplayInfo[]) => void) => () => void;
  openProjector: (opts: { displayId?: number; fullscreen?: boolean }) => Promise<{ ok: boolean; displayId: number }>;
  /** `dismissed` marks a close the operator did at the projector itself. */
  closeProjector: (opts?: { dismissed?: boolean }) => Promise<{ ok: boolean }>;
  projectorStatus: () => Promise<{ open: boolean }>;
  /** `dismissed` marks a close the operator did at the projector window itself. */
  onProjectorState: (
    cb: (state: { open: boolean; displayId?: number; dismissed?: boolean }) => void,
  ) => () => void;

  // NDI output (native, optional - resolves gracefully if unavailable)
  ndiStatus?: () => Promise<NdiStatus>;
  ndiStart?: (opts: { sourceName: string; frameRate: number }) => Promise<NdiStatus>;
  ndiStop?: () => Promise<NdiStatus>;

  /** Routable IPv4 addresses of this machine, best first, for companion links. */
  getLanIps?: () => Promise<string[]>;
  /** The same addresses with their adapter names, for the Settings picker. */
  getLanDetails?: () => Promise<LanAddress[]>;
  /** Whether the OS firewall is letting other devices reach this app. */
  firewallStatus?: () => Promise<FirewallState>;
  /** Ask the OS to allow inbound connections. Prompts for admin on Windows. */
  firewallAllow?: () => Promise<FirewallState>;

  /** Pickable screens and windows for live capture (desktop only). */
  listCaptureSources?: () => Promise<CaptureSource[]>;

  /**
   * Window title to record, standing up an offscreen 1080p surface first if
   * no projector is open. `temporary` says whether it was created for this
   * recording and should be released afterwards.
   */
  recorderSurface?: () => Promise<{ title: string; temporary: boolean }>;
  /** Tear down a surface created by recorderSurface(). */
  recorderRelease?: () => Promise<{ ok: boolean }>;

  /** Copy the library (database + media) into a dated folder the user picks. */
  backupCreate?: () => Promise<{ ok: boolean; folder?: string; error?: string; canceled?: boolean }>;
  /** Replace the library from a backup folder, then relaunch. */
  backupRestore?: () => Promise<{ ok: boolean; error?: string; canceled?: boolean }>;

  // Events
  onDeepLink: (cb: (url: string) => void) => () => void;
  /** Menu actions ("new-song", "import", "settings", "about", "media", "media-add", "capture"). */
  onMenuAction?: (cb: (action: string) => void) => () => void;
}

export interface LanAddress {
  address: string;
  /** Adapter name, so Wi-Fi can be told from Ethernet. */
  adapter: string;
  /** Higher means more likely to be reachable from another device. */
  score: number;
}

export interface FirewallState {
  status: "ok" | "blocked" | "unknown";
  /** True when the app can offer to fix it (Windows only). */
  fixable: boolean;
  detail: string;
}

export interface CaptureSource {
  /**
   * Desktop sources: the chromeMediaSourceId. Video inputs (webcams and HDMI
   * capture cards): the deviceId behind a "camera:" prefix.
   */
  id: string;
  name: string;
  kind: "screen" | "window" | "camera";
  /** Preview still as a data: URL; empty for video inputs, which have none. */
  thumbnail: string;
}

export interface NdiStatus {
  available: boolean;
  running: boolean;
  sourceName?: string;
  reason?: string;
}

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
  internal: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export function getDesktopAPI(): ElectronAPI | null {
  return window.electronAPI ?? null;
}

export function isDesktop(): boolean {
  return getDesktopAPI() !== null;
}
