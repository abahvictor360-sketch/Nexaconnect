import { useState } from "react";
import { Music4, Library, FilePlus2, BookOpen, Loader2 } from "lucide-react";

const GUIDE_URL = "https://abahvictor360-sketch.github.io/vifug-lyrics/guide.html";

/**
 * First-run welcome.
 *
 * The installer ships a seeded library, so a new install already has songs in
 * it. Some churches want exactly that; others want a clean shelf they fill
 * themselves. Asking once, up front, is kinder than either forcing the seed on
 * everyone or making them delete songs one at a time later.
 *
 * "Start empty" is deliberately not the default and is spelled out as
 * permanent - it deletes the bundled songs, and the only way back is
 * reinstalling.
 */
export function WelcomeDialog({
  onChoose,
}: {
  /** keepLibrary=false clears the bundled songs before the dialog closes. */
  onChoose: (keepLibrary: boolean) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<"keep" | "empty" | null>(null);

  const choose = async (keep: boolean) => {
    setBusy(keep ? "keep" : "empty");
    try {
      await onChoose(keep);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-6">
      <div className="w-full max-w-lg rounded-xl border border-[var(--v-border)] bg-[var(--v-surface-2)] p-6 text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-[var(--v-accent)] to-[var(--v-accent-2)] text-black">
          <Music4 className="h-6 w-6" />
        </div>
        <h1 className="font-display text-xl font-bold">Welcome to Vifug Lyrics</h1>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-[var(--v-text-dim)]">
          How would you like to start? You can always import or add songs later.
        </p>

        <div className="mt-5 grid gap-2.5 text-left sm:grid-cols-2">
          <button
            onClick={() => choose(true)}
            disabled={busy !== null}
            className="rounded-lg border-2 border-[var(--v-accent)] bg-[var(--v-accent-soft)] p-3.5 transition-colors disabled:opacity-50"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-[var(--v-accent)]">
              {busy === "keep" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Library className="h-4 w-4" />}
              Use the included songs
            </span>
            <span className="mt-1 block text-[11px] text-[var(--v-text-dim)]">
              Start with the bundled hymn library already loaded, ready to project.
            </span>
          </button>

          <button
            onClick={() => choose(false)}
            disabled={busy !== null}
            className="rounded-lg border-2 border-[var(--v-border)] p-3.5 transition-colors hover:border-[var(--v-text-faint)] disabled:opacity-50"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              {busy === "empty" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
              Start empty
            </span>
            <span className="mt-1 block text-[11px] text-[var(--v-text-dim)]">
              Remove the bundled songs and build your own library. This can’t be undone.
            </span>
          </button>
        </div>

        <a
          href={GUIDE_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--v-accent)] hover:underline"
        >
          <BookOpen className="h-3.5 w-3.5" />
          New here? Read the guide - setup, projector, remote and streaming
        </a>
      </div>
    </div>
  );
}
