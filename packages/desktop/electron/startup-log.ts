import { app } from "electron";
import path from "node:path";
import fsSync from "node:fs";

/**
 * A record of what happened between double-click and a window appearing.
 *
 * Until now, a startup that failed produced nothing at all: no window, no
 * dialog, no file. A user reporting "I installed it and it does not open" had
 * literally nothing to send, and there was no way to tell a blocked port from
 * an unreadable Documents folder from a database that would not open. This is
 * the difference between a bug report and a shrug.
 *
 * Deliberately synchronous and dependency-free. It has to work before the
 * server, before the database, and while something is already going wrong -
 * anything clever here is one more thing that can fail in the same breath.
 */

let logFile: string | null = null;

function target(): string | null {
  if (logFile) return logFile;
  try {
    const dir = app.getPath("userData");
    fsSync.mkdirSync(dir, { recursive: true });
    logFile = path.join(dir, "startup.log");
    return logFile;
  } catch {
    // No userData means nothing is going to work anyway, but logging must not
    // be the thing that throws.
    return null;
  }
}

/** Where to tell the user to look. Safe to call even if logging failed. */
export function startupLogPath(): string {
  return target() ?? "(no writable folder for a log)";
}

/** Start a fresh log for this launch. Only the latest one is of any interest. */
export function beginStartupLog() {
  const file = target();
  if (!file) return;
  try {
    fsSync.writeFileSync(
      file,
      `Vifug ${app.getVersion()} starting - ${new Date().toISOString()}\n` +
        `platform ${process.platform} ${process.arch}, electron ${process.versions.electron}\n`,
      "utf8",
    );
  } catch {
    /* a log that cannot be written must not stop the app */
  }
}

export function logStartup(message: string) {
  const file = target();
  if (!file) return;
  try {
    fsSync.appendFileSync(file, `${new Date().toISOString()}  ${message}\n`, "utf8");
  } catch {
    /* as above */
  }
}

/** Log an error with its stack, which is the part worth having. */
export function logStartupError(where: string, err: unknown) {
  const e = err as Error & { code?: string };
  logStartup(
    `ERROR in ${where}: ${e?.code ? `[${e.code}] ` : ""}${e?.message ?? String(err)}\n` +
      (e?.stack ? `${e.stack}\n` : ""),
  );
}
