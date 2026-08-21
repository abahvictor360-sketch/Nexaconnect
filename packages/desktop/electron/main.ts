/**
 * Vifug - free, offline-first worship presentation software.
 * Created by Victor Abah.
 */
import {
  app, BrowserWindow, ipcMain, dialog, Notification, screen, shell, Menu, desktopCapturer,
} from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { startEmbeddedServer } from "./server";
import { lanAddresses, lanAddressDetails, firewallState, allowThroughFirewall } from "./network";
import { ndiStatus, ndiStart, ndiStop, ndiRebind } from "./ndi";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Must run before 'ready': Electron's default getName() - and therefore the
// whole userData path - is keyed off this. The app was originally shipped as
// "Vifug Lyrics" and is now just "Vifug"; migrateLegacyUserData() below
// carries an existing install's database and media across from either older
// name so nobody's library appears to vanish on the upgrade that renames it.
app.setName("Vifug");

const isDev = !app.isPackaged && process.env.NODE_ENV !== "production";
const WEB_DEV_URL = process.env.WEBSITE_URL ?? "http://localhost:3000";
const WEB_DIST = path.join(__dirname, "../web-dist");

let baseUrl = WEB_DEV_URL;
let win: BrowserWindow | null;
let projectorWin: BrowserWindow | null = null;

function loadRoute(target: BrowserWindow, route: string) {
  // Hash routing: the web app uses wouter's useHashLocation so routes live
  // after the '#'. Root is "/#/", projector is "/#/projector".
  target.loadURL(`${baseUrl}/#${route}`);
}

/** Documents/Vifug/Media - the user-visible library folder. */
function mediaFolder(): string {
  return path.join(app.getPath("documents"), "Vifug", "Media");
}

/**
 * Media used to live in userData/media, invisible to the user, and later
 * under Documents/"Vifug Lyrics"/Media before the app's name shortened to
 * "Vifug". Move any files from either old location into today's folder on
 * first launch after upgrading; the DB stores bare filenames (`local:<name>`),
 * so the records keep resolving regardless of which folder they end up in.
 */
async function migrateLegacyMedia(target: string) {
  const legacySources = [
    path.join(app.getPath("userData"), "media"),
    path.join(app.getPath("documents"), "Vifug Lyrics", "Media"),
  ];
  for (const legacy of legacySources) {
    if (!fsSync.existsSync(legacy) || legacy === target) continue;
    for (const name of await fs.readdir(legacy)) {
      const to = path.join(target, name);
      if (fsSync.existsSync(to)) continue;
      await fs.rename(path.join(legacy, name), to).catch(() => {});
    }
  }
}

/**
 * Copy an existing profile's database (and legacy media, if not already
 * moved to Documents) from an older userData path this app has answered to
 * before - "@template/desktop" (the scaffold's original, never-renamed
 * package name) and "Vifug Lyrics" (this app's own name before it shortened
 * to "Vifug") - to the current, properly-branded one. Runs once, on the
 * first launch after whichever rename applies.
 *
 * Checked by the DATABASE FILE, not the folder: by the time this runs,
 * Electron has already created the new userData directory itself (session
 * partition, "Local State", etc.), so testing for the folder's existence
 * would treat every fresh profile as "already migrated" and silently skip
 * real migrations - which is exactly what shipped once. For the same reason,
 * a whole-directory rename onto the new path would fail (destination already
 * exists and is non-empty), so this copies just the two things that matter
 * rather than attempting one.
 */
async function migrateLegacyUserData(newUserData: string) {
  const newDbFile = path.join(newUserData, "vifug.db");
  if (fsSync.existsSync(newDbFile)) return; // already migrated, or a genuinely new database of its own

  const oldCandidates = [
    path.join(app.getPath("appData"), "Vifug Lyrics"),
    path.join(app.getPath("appData"), "@template", "desktop"),
  ];
  for (const oldUserData of oldCandidates) {
    if (!fsSync.existsSync(oldUserData)) continue; // nothing here to migrate - try the next candidate

    await fs.mkdir(newUserData, { recursive: true });
    const oldDbFile = path.join(oldUserData, "vifug.db");
    if (fsSync.existsSync(oldDbFile)) await fs.copyFile(oldDbFile, newDbFile);

    const oldMedia = path.join(oldUserData, "media");
    const newMedia = path.join(newUserData, "media");
    if (fsSync.existsSync(oldMedia) && !fsSync.existsSync(newMedia)) {
      await fs.cp(oldMedia, newMedia, { recursive: true }).catch(() => {});
    }
    if (fsSync.existsSync(newDbFile)) return; // migrated from this candidate - done
  }
}

async function ensureProductionServer() {
  if (isDev) return;
  const userData = app.getPath("userData");
  await migrateLegacyUserData(userData);
  const dbFile = path.join(userData, "vifug.db");
  if (!fsSync.existsSync(dbFile)) {
    // First run: install the bundled, pre-seeded library database.
    const seed = path.join(process.resourcesPath, "seed.db");
    if (fsSync.existsSync(seed)) await fs.copyFile(seed, dbFile);
  }
  const media = mediaFolder();
  await fs.mkdir(media, { recursive: true });
  await migrateLegacyMedia(media);
  const port = await startEmbeddedServer(WEB_DIST, dbFile, media);
  baseUrl = `http://127.0.0.1:${port}`;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#0a0a0c",
    title: "Vifug",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Links that open in a new tab (target="_blank") - e.g. the Help menu's
  // links to the landing-page guides - should open in the system browser,
  // not a bare chromeless Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  loadRoute(win, "/");
}

// --- Application menu (File / Edit / View / Window / Help) ---
// Sends an action name to the renderer, which owns the actual UI state
// (opening the New Song editor, Import modal, Settings, etc.) - mirrors the
// existing deep-link pattern rather than main.ts reaching into app state.
function sendMenuAction(action: string) {
  win?.webContents.send("menu:action", action);
}

function buildAppMenu() {
  const isMac = process.platform === "darwin";
  const cmdOrCtrl = "CmdOrCtrl";

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        { label: "New Song", accelerator: `${cmdOrCtrl}+N`, click: () => sendMenuAction("new-song") },
        { label: "Import…", accelerator: `${cmdOrCtrl}+I`, click: () => sendMenuAction("import") },
        { type: "separator" },
        { label: "Settings…", accelerator: `${cmdOrCtrl}+,`, click: () => sendMenuAction("settings") },
        { type: "separator" },
        isMac ? { role: "close" } : { label: "Quit", accelerator: `${cmdOrCtrl}+Q`, click: () => app.quit() },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Media",
      submenu: [
        { label: "Media Library", accelerator: `${cmdOrCtrl}+M`, click: () => sendMenuAction("media") },
        { label: "Add Media…", click: () => sendMenuAction("media-add") },
        { type: "separator" },
        { label: "Screen / Window Capture…", click: () => sendMenuAction("capture") },
        { type: "separator" },
        { label: "Open Media Folder", click: () => shell.openPath(mediaFolder()) },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "close" }],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Guide",
          click: () => shell.openExternal("https://vifug.com/guide.html"),
        },
        {
          label: "Report a bug",
          click: () => shell.openExternal("https://vifug.com/contact.html"),
        },
        { type: "separator" },
        { label: "Check for Updates…", click: () => sendMenuAction("check-updates") },
        { label: "About Vifug", click: () => sendMenuAction("about") },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- Reaching this machine from a phone or tablet on the same network. ---
ipcMain.handle("network:lan-ips", () => lanAddresses());
ipcMain.handle("network:lan-details", () => lanAddressDetails());
ipcMain.handle("network:firewall-status", () => firewallState());
ipcMain.handle("network:firewall-allow", () => allowThroughFirewall(app.getPath("exe")));

// --- Projector / second-monitor output ---
function serializeDisplays() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Display ${i + 1}`,
    bounds: d.bounds,
    size: d.size,
    scaleFactor: d.scaleFactor,
    isPrimary: d.id === primary.id,
    internal: (d as unknown as { internal?: boolean }).internal ?? false,
  }));
}

ipcMain.handle("displays:list", () => serializeDisplays());

// Live display detection - a monitor plugged/unplugged mid-service should
// show up (or drop out) in the Projector picker without an app restart.
// Registered from app.whenReady() below: the `screen` module throws if
// touched before Electron's 'ready' event fires.
function watchDisplays() {
  const broadcastDisplays = () => {
    win?.webContents.send("displays:changed", serializeDisplays());
  };
  screen.on("display-added", broadcastDisplays);
  screen.on("display-removed", broadcastDisplays);
  screen.on("display-metrics-changed", broadcastDisplays);
}

ipcMain.handle("projector:open", (_e, opts: { displayId?: number; fullscreen?: boolean }) => {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const target =
    displays.find((d) => d.id === opts?.displayId) ??
    displays.find((d) => d.id !== primary.id) ??
    primary;

  const wantFullscreen = opts?.fullscreen ?? true;

  if (projectorWin && !projectorWin.isDestroyed()) {
    // A fullscreen window ignores setBounds - drop out of fullscreen first,
    // move to the target display, show it THERE, then restore fullscreen.
    // setFullScreen on a hidden/other-display window fullscreens the wrong
    // monitor on Windows, so the order is: position → show → fullscreen.
    if (projectorWin.isFullScreen()) projectorWin.setFullScreen(false);
    projectorWin.setBounds(target.bounds);
    projectorWin.show();
    if (wantFullscreen) projectorWin.setFullScreen(true);
    projectorWin.focus();
    ndiRebind(projectorWin);
    win?.webContents.send("projector:state", { open: true, displayId: target.id });
    return { ok: true, displayId: target.id };
  }

  // Do NOT pass fullscreen:true to the constructor: on Windows the window can
  // fullscreen onto the primary display before the x/y bounds are applied.
  // Create hidden on the target display, then fullscreen + show once ready.
  projectorWin = new BrowserWindow({
    x: target.bounds.x,
    y: target.bounds.y,
    width: target.bounds.width,
    height: target.bounds.height,
    show: false,
    frame: false,
    backgroundColor: "#000000",
    title: "Vifug Projector",
    autoHideMenuBar: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  let shown = false;
  const reveal = () => {
    if (shown || !projectorWin || projectorWin.isDestroyed()) return;
    shown = true;
    // Order matters on Windows: position on the target display, make the
    // window visible THERE, and only then fullscreen it. Fullscreening a
    // hidden window snaps it to the primary display.
    projectorWin.setBounds(target.bounds);
    projectorWin.show();
    projectorWin.setBounds(target.bounds);
    if (wantFullscreen) projectorWin.setFullScreen(true);
    projectorWin.moveTop();
  };
  projectorWin.once("ready-to-show", reveal);
  // Safety net: some GPU/driver combos never emit ready-to-show.
  setTimeout(reveal, 2000);
  // Esc closes the projection (reliable even for a frameless fullscreen window,
  // where the renderer keydown can be swallowed).
  projectorWin.webContents.on("before-input-event", (_e, input) => {
    if (input.type === "keyDown" && input.key === "Escape") {
      if (projectorWin && !projectorWin.isDestroyed()) projectorWin.close();
    }
  });
  loadRoute(projectorWin, "/projector");
  projectorWin.on("closed", () => {
    projectorWin = null;
    ndiRebind(null);
    win?.webContents.send("projector:state", { open: false });
  });
  // Once the projector is up, point any running NDI sender at it.
  projectorWin.webContents.on("did-finish-load", () => ndiRebind(projectorWin));
  win?.webContents.send("projector:state", { open: true, displayId: target.id });
  return { ok: true, displayId: target.id };
});

ipcMain.handle("projector:close", () => {
  if (projectorWin && !projectorWin.isDestroyed()) projectorWin.close();
  projectorWin = null;
  ndiRebind(null);
  return { ok: true };
});

ipcMain.handle("projector:status", () => ({
  open: !!(projectorWin && !projectorWin.isDestroyed()),
}));

// --- NDI output (native, optional) ---
// The projector window is the capture source, so NDI mirrors exactly what the
// second monitor shows. If the projector isn't open yet, the sender waits and
// picks it up on the next projector:open.
ipcMain.handle("ndi:status", () => ndiStatus());
ipcMain.handle("ndi:start", (_e, opts: { sourceName: string; frameRate: number }) =>
  ndiStart(projectorWin, opts),
);
ipcMain.handle("ndi:stop", () => ndiStop());

// --- Screen / window capture ---
// Only enumerates sources and hands back their ids; the actual stream is
// acquired in the renderer that will display it (a MediaStream can't be passed
// across windows), so the projector grabs its own feed from the same id.
ipcMain.handle("capture:sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.id.startsWith("screen:") ? "screen" : "window",
    thumbnail: s.thumbnail.toDataURL(),
  }));
});

// --- IPC Handlers ---

// Dialog
ipcMain.handle("dialog:open", async (_, opts) => {
  const result = await dialog.showOpenDialog(opts);
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("dialog:save", async (_, opts) => {
  const result = await dialog.showSaveDialog(opts);
  return result.canceled ? null : result.filePath;
});

// File system
ipcMain.handle("fs:read", async (_, filePath: string) => {
  return fs.readFile(filePath, "utf-8");
});

ipcMain.handle("fs:write", async (_, filePath: string, data: string) => {
  await fs.writeFile(filePath, data, "utf-8");
});

// Notifications
ipcMain.handle("notification:show", (_, title: string, body: string) => {
  new Notification({ title, body }).show();
});

// App version - the renderer's update check compares this to the newest
// GitHub release tag.
ipcMain.handle("app:version", () => app.getVersion());

// Window controls
ipcMain.handle("window:minimize", () => win?.minimize());
ipcMain.handle("window:maximize", () => {
  if (win?.isMaximized()) {
    win.unmaximize();
  } else {
    win?.maximize();
  }
});
ipcMain.handle("window:close", () => win?.close());

// --- App lifecycle ---

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(async () => {
  watchDisplays();
  buildAppMenu();
  await ensureProductionServer();
  createWindow();
});
