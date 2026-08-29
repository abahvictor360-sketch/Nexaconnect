# Streaming, Browser Source & NDI

Vifug outputs live lyrics to surfaces that all stay in sync:

| Surface | Where it runs | Transport |
| --- | --- | --- |
| **Operator preview** | Operator app | in-memory |
| **Projector / live view** (`/#/projector`) | Electron second-monitor window; or a browser tab, tablet or spare laptop anywhere | BroadcastChannel on the same machine, plus the network path below |
| **Stream / Browser source** (`/#/stream`) | Any process: OBS, vMix, streaming PC, NDI bridge | Negotiated: SSE, or long-poll when hosted |
| **Stage display** (`/#/stage`) | Band / confidence monitor | Same as above |
| **Phone remote** (`/#/remote`) | A phone, PIN-gated | Same as above |

The stream page cannot use BroadcastChannel (it runs out-of-process), so it
syncs over the network and renders on a **transparent background** so it
composites cleanly over video.

**The transport is asked for, not assumed.** `GET /api/realtime` reports which
one the deployment can actually deliver, and the client uses it. A long-lived
server - the Bun server or the desktop app - gives Server-Sent Events. A
serverless deployment cannot: every request may land on a different instance,
so a stream opened there sees nothing the operator does, and the client falls
back to long-polling instead. Nothing needs configuring either way.

One consequence worth knowing if you automate these pages: `waitUntil:
"networkidle"` never fires on the long-poll transport, because a request is
always in flight. Use `domcontentloaded`.

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

This works with a hosted deployment too, which is the useful part: the OBS
machine sits at the venue and pulls lyrics from the cloud over HTTPS, then
emits NDI onto its **own** LAN, where vMix, a TriCaster or Resolume pick it up.
NDI is a local-network discovery protocol and never travels over the internet -
the browser source is what crosses it.

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
