import { ipcRenderer, contextBridge } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  getAppVersion: () => ipcRenderer.invoke("app:version"),

  // Dialog
  showOpenDialog: (opts: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke("dialog:open", opts),
  showSaveDialog: (opts: Electron.SaveDialogOptions) =>
    ipcRenderer.invoke("dialog:save", opts),

  // File system
  readFile: (path: string) => ipcRenderer.invoke("fs:read", path),
  writeFile: (path: string, data: string) =>
    ipcRenderer.invoke("fs:write", path, data),

  // Notifications
  showNotification: (title: string, body: string) =>
    ipcRenderer.invoke("notification:show", title, body),

  // Window controls
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),

  // Displays + projector (second-monitor output)
  listDisplays: () => ipcRenderer.invoke("displays:list"),
  onDisplaysChanged: (cb: (displays: unknown[]) => void) => {
    const listener = (_: unknown, displays: unknown[]) => cb(displays);
    ipcRenderer.on("displays:changed", listener);
    return () => ipcRenderer.removeListener("displays:changed", listener);
  },
  openProjector: (opts: { displayId?: number; fullscreen?: boolean }) =>
    ipcRenderer.invoke("projector:open", opts),
  closeProjector: () => ipcRenderer.invoke("projector:close"),
  projectorStatus: () => ipcRenderer.invoke("projector:status"),
  onProjectorState: (cb: (state: { open: boolean; displayId?: number }) => void) => {
    const listener = (_: unknown, state: { open: boolean; displayId?: number }) => cb(state);
    ipcRenderer.on("projector:state", listener);
    return () => ipcRenderer.removeListener("projector:state", listener);
  },

  // Screen / window capture - returns pickable sources. The renderer that
  // shows the feed acquires the stream itself from the chosen id.
  listCaptureSources: () => ipcRenderer.invoke("capture:sources"),

  // NDI output (native, optional)
  ndiStatus: () => ipcRenderer.invoke("ndi:status"),
  ndiStart: (opts: { sourceName: string; frameRate: number }) =>
    ipcRenderer.invoke("ndi:start", opts),
  ndiStop: () => ipcRenderer.invoke("ndi:stop"),

  // LAN address(es) so companion screens (Stage/Remote/Stream) can be opened
  // from another device on the same network, not just this machine.
  getLanIps: () => ipcRenderer.invoke("network:lan-ips"),

  // Events from main → renderer
  onDeepLink: (cb: (url: string) => void) => {
    ipcRenderer.on("deep-link", (_, url) => cb(url));
    return () => ipcRenderer.removeAllListeners("deep-link");
  },
  onMenuAction: (cb: (action: string) => void) => {
    const listener = (_: unknown, action: string) => cb(action);
    ipcRenderer.on("menu:action", listener);
    return () => ipcRenderer.removeListener("menu:action", listener);
  },
});
