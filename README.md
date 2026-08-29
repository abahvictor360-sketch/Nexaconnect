# Vifug

Free, offline-first worship presentation software - song lyrics, offline Bible
versions, projector/NDI output, AI auto-follow, phone remote and more.
Created and maintained by **[Victor Abah](https://github.com/abahvictor360-sketch)**.

Monorepo: Bun workspaces + Turborepo.

## Project Structure

```
.env                         Secrets (gitignored), loaded via Vite's loadEnv
packages/
  web/                       Unified server (API + web frontend via Vite)
    vite.config.ts           Vite 7 config - loads .env, sets port, registers plugins
    index.html               Frontend HTML entry
    vite/plugins/
      hono-dev-plugin.ts     Intercepts /api/* in dev, forwards to Hono via SSR
      runable-analytics-plugin.ts
    src/
      api/
        index.ts             Hono routes (.basePath('api')) + AppType export
        database/
          index.ts           Database client (Turso/LibSQL)
          schema.ts          Drizzle schema
      web/
        main.tsx             App entry
        app.tsx              Root component + Wouter routing
        pages/               Page components
        components/          UI components
        hooks/
          use-desktop.ts     Desktop detection
        lib/
          api.ts             Typed API client (hono client)
          desktop.ts         Electron API types
          utils.ts           Shared utilities
        styles.css           Tailwind CSS entry
  mobile/                    Expo + React Native + expo-router
    app/                     File-based routing
    lib/
      api.ts                 Typed API client
  desktop/                   Electron shell (loads web app from server)
    electron/
      main.ts                Main process + IPC handlers
      preload.ts             contextBridge API
    vite.config.ts           Vite config
```

## Environment Variables

Secrets and credentials live in `.env` at the project root (gitignored). Vite's `loadEnv` loads them into `process.env` at dev/build time (configured in `packages/web/vite.config.ts`). In API code (Hono), use `process.env.YOUR_VAR`. In browser code, only `VITE_`-prefixed vars are exposed via `import.meta.env.VITE_YOUR_VAR`. Drizzle scripts use `bun --env-file=../../.env` to load env vars directly.

## Desktop UI

The desktop app has no separate renderer by default. It loads the web app from `packages/web`; desktop-specific UI should live in `packages/web/src/web/` and be gated with `useDesktop()` / `window.electronAPI`. Keep `packages/desktop` for Electron window setup, menus/tray/shortcuts, IPC handlers, native OS APIs, and packaging. Only add a separate desktop renderer when the product intentionally needs a different desktop-only UI architecture.

## Servers

Dev servers are started and managed automatically - no need to run them manually.

## Database

```sh
cd packages/web
bun run db:push        # Push schema to database
bun run db:generate    # Generate migration files
bun run db:migrate     # Run migrations
bun run db:studio      # Open Drizzle Studio
```

## Running Locally

```sh
bun install
cd packages/web && bun run reseed:local   # creates + seeds local.db
cd ../.. && bun run dev                   # Vite on :5173, API on /api/*
```

`reseed:local` is not optional on a fresh clone: `DATABASE_URL` must be set in
the root `.env` before the API will answer anything, and locally it is a file
URL pointing at the database that script creates.

```
DATABASE_URL=file:/absolute/path/to/packages/web/local.db
```

## Deploying to Vercel

`packages/web` is deployable as its own Vercel project - set the project's root
directory to `packages/web` and `packages/web/vercel.json` supplies the rest.
`packages/web/api/[...route].ts` hands each request to the same Hono app.

Set `DATABASE_URL` and `DATABASE_AUTH_TOKEN` in the project's environment
variables. It must be a **remote** libsql URL, not a file one: a `file:` URL
needs the native `libsql` package and a writable disk, and serverless functions
have neither. The same `@libsql/client` speaks to a remote database over HTTP
with no code change.

### Media uploads

Uploads try object storage first (`POST /api/media/presign`, then the browser
PUTs straight to the bucket) and fall back to the server's own disk. A hosted
deployment has no writable disk, so the bucket is not optional there - without
it both paths fail. Set `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY` and `S3_BUCKET`.

The bucket needs a CORS rule allowing `PUT` from the app's origin, since the
browser uploads to it directly. Without one the upload is blocked, the client
falls back to disk, and the failure looks like nothing happening.

`GET /api/media/storage` reports whether storage is configured, and which
variables are missing, without attempting an upload.

### Not available on serverless

Two features need the long-lived Bun server in `packages/web/src/server.ts`:

- **Projector / stage / OBS sync.** `/api/live`, `/api/stage` and `/api/remote`
  are SSE routes whose state is a module-level variable in
  `src/api/lib/live-store.ts` and `src/api/lib/channels.ts`. Every request can
  land on a different instance, so there is no shared state to stream.
- **Media uploads to local disk** (`MEDIA_DIR`). Object storage covers this
  case; see above.

Lyrics, the offline Bible and presentation reads are unaffected. The Bible is
plain static JSON under `public/bible/` and needs no API at all.

## Author

Vifug is created and maintained by **Victor Abah**
([GitHub](https://github.com/abahvictor360-sketch) ·
[contact@vifug.com](mailto:contact@vifug.com), feedback to [feedback@vifug.com](mailto:feedback@vifug.com)).
