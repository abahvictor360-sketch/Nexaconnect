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
  closeProjector: () => Promise<{ ok: boolean }>;
  projectorStatus: () => Promise<{ open: boolean }>;
  onProjectorState: (cb: (state: { open: boolean; displayId?: number }) => void) => () => void;

  // NDI output (native, optional - resolves gracefully if unavailable)
  ndiStatus?: () => Promise<NdiStatus>;
  ndiStart?: (opts: { sourceName: string; frameRate: number }) => Promise<NdiStatus>;
  ndiStop?: () => Promise<NdiStatus>;

  /** Non-loopback IPv4 addresses of this machine, for LAN-reachable companion links. */
  getLanIps?: () => Promise<string[]>;

  /** Pickable screens and windows for live capture (desktop only). */
  listCaptureSources?: () => Promise<CaptureSource[]>;

  // Events
  onDeepLink: (cb: (url: string) => void) => () => void;
  /** Menu actions ("new-song", "import", "settings", "about", "media", "media-add", "capture"). */
  onMenuAction?: (cb: (action: string) => void) => () => void;
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
