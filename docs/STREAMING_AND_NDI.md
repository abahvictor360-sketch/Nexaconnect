# Streaming, Browser Source & NDI

Vifug outputs live lyrics to three surfaces that all stay in sync:

| Surface | Where it runs | Transport |
| --- | --- | --- |
| **Projector** (`/#/projector`) | Electron second-monitor window | BroadcastChannel (same machine) |
| **Operator preview** | Operator app | in-memory |
| **Stream / Browser source** (`/#/stream`) | Any process: OBS, vMix, streaming PC, NDI bridge | Server-Sent Events (`/api/live/stream`) |

The stream page cannot use BroadcastChannel (it runs out-of-process), so it
subscribes to the server's SSE feed and renders on a **transparent background**
so it composites cleanly over video.

## Use as an OBS / vMix Browser Source

1. In OBS add a **Browser** source.
2. URL: `https://<your-app-url>/#/stream`
   - Copy it straight from the operator **Stream / OBS source** panel.
3. Width `1920`, Height `1080`, FPS `30`.
4. Leave "Shutdown source when not visible" **off** so the SSE connection stays warm.
5. Lyrics now appear over your scene with a transparent backdrop. Changing the
   active background in the operator (image / video / color) also flows through.

The stream page auto-reconnects if the connection drops (1.5s backoff) and
renders the last published state on connect.

## NDI output

**Native NDI cannot be built or run inside the Runable sandbox** - the NDI SDK
ships closed-source native binaries that require a real OS/network stack, so we
do **not** fake a native NDI sender. Instead the supported production path is:

### Recommended: OBS → NDI (works today, no native code)

1. Add the `/#/stream` page as a Browser source in OBS (above).
2. Install the **DistroAV** OBS plugin (formerly `obs-ndi`): <https://github.com/DistroAV/DistroAV>
3. OBS → **Tools → NDI Output Settings** → enable **Main Output** (or add a
   dedicated NDI filter on the lyrics source).
4. Any NDI receiver on the network (vMix, TriCaster, Resolume, another OBS via
   NDI source) now sees "OBS (lyrics)" as an NDI stream.

This gives real NDI on the wire without any native build.

### Optional: native NDI sender (build on a real machine)

If you want the desktop app itself to emit NDI directly (no OBS), build this on
a developer machine - **not** in the sandbox:

1. Download the **NDI SDK** from <https://ndi.video/for-developers/ndi-sdk/>.
2. Add a native Node addon such as [`grandiose`](https://github.com/Streampunk/grandiose)
   (`bun add grandiose`) to the Electron main process.
3. In `packages/desktop/electron/main.ts`, capture the projector `BrowserWindow`
   frames via `webContents.beginFrameSubscription((image) => sender.video(...))`
   and push them into an NDI sender created from the SDK.
4. Rebuild with `electron-builder` (`bun run dist` in `packages/desktop`). The
   native `.node` binary is compiled per-platform, so run the build on each
   target OS (Windows/macOS/Linux).

Until then, the OBS→NDI bridge above is the shipping path.

## Native desktop build (installers)

The sandbox runs the Electron app in dev via `xvfb-run`, but **packaged
installers must be built on the target OS** (electron-builder shells out to
platform tooling and code-signing):

```bash
cd packages/desktop
bun install
bun run dist        # vite build + electron-builder for the current OS
```

- **Windows** → produces `.exe` (NSIS). Build on Windows.
- **macOS** → produces `.dmg`. Build on macOS (notarization needs an Apple ID).
- **Linux** → produces `.AppImage` / `.deb`.

Point the desktop build at your deployed web URL via `WEBSITE_URL` so the
Electron windows load the production operator/projector.
