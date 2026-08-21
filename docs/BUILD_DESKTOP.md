# Building Vifug Desktop Installers

Vifug ships as a native desktop app (Electron) for **Windows (.exe)**,
**macOS (.dmg)** and **Linux (AppImage)**. Everything runs **offline** once
installed - the Bible data and song library live locally.

> **Why can't I just download the .exe/.dmg here?**
> Signed native installers must be built on their own OS: Windows installers
> need Windows (or Wine), and macOS `.dmg` files must be built and code-signed
> on a Mac. A Linux build server can only produce the Linux **AppImage**
> directly. Use the GitHub Actions workflow below to produce all three from a
> single push, or build locally on each target OS.

---

## 1. Prerequisites

- [Bun](https://bun.sh) `>= 1.1`
- Node-compatible toolchain (electron-builder uses it under the hood)
- Platform tools:
  - **Windows**: build on Windows, or on Linux/macOS with Wine + Mono
  - **macOS**: build on macOS (required for signing/notarization)
  - **Linux**: any modern distro

## 2. Install & build the web bundle

```bash
bun install
cd packages/web && bun run build      # emits packages/web/dist
```

The desktop app loads this static bundle offline.

## 3. Build the desktop installer

```bash
cd packages/desktop
bun run dist        # vite build + electron-builder for the current OS
```

Artifacts land in `packages/desktop/release/<version>/`:

| OS       | Output                          |
| -------- | -------------------------------- |
| Windows  | `VifugLyrics-Windows-Setup.exe`  |
| macOS    | `VifugLyrics-Mac-Installer.dmg`  |
| Linux    | `VifugLyrics-Linux.AppImage`     |

(Names stay version-independent - no version number in the filename - since
the landing page's download buttons link to these exact names directly.)

### Build only one target

```bash
bunx electron-builder --win nsis
bunx electron-builder --mac dmg
bunx electron-builder --linux AppImage
```

## 4. Cross-building & CI (all three at once)

Building all three OS targets by hand is painful. This repo includes
`.github/workflows/desktop-build.yml`, which runs a **matrix build** on
GitHub-hosted Windows, macOS and Linux runners and uploads every installer as a
workflow artifact (and attaches them to a GitHub Release on tags).

To use it:

1. Push this repo to GitHub.
2. Go to **Actions → Build Desktop Installers → Run workflow**, or push a tag
   like `v1.0.0` to trigger a release build.
3. Download the installers from the run's **Artifacts** section, or from the
   auto-created **Release**.

### Code signing (optional but recommended)

Set these repository secrets so installers are signed (no "unknown publisher"
warnings):

- **Windows**: `WIN_CSC_LINK` (base64 `.pfx`), `WIN_CSC_KEY_PASSWORD`
- **macOS**: `CSC_LINK` (base64 `.p12`), `CSC_KEY_PASSWORD`, plus
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for notarization

Without these, the app still builds - it just isn't code-signed.

## 5. Running the AppImage (Linux)

```bash
chmod +x "VifugLyrics-Linux.AppImage"
./"VifugLyrics-Linux.AppImage"
```

---

Offline-first, local SQLite source of truth, your words never leave the machine.
