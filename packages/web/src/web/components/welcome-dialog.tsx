import { useState } from "react";
import { Music4, Library, FilePlus2, BookOpen, Loader2 } from "lucide-react";
import { useDialog } from "../hooks/use-dialog";

const GUIDE_URL = "https://vifug.com/guide.html";

/**
 * Lines of a song on screen at once.
 *
 * Offered here because it is the one setting a congregation notices
 * immediately and a new operator has no reason to go looking for. Two is
 * roomy and easy to read from the back; four fits a whole verse and means
 * fewer clicks. Churches are split on it, and the ones who never find
 * Settings run a whole service on whatever we guessed.
 *
 * Two, three and four only. One is a special case and five or six are for a
 * particular kind of room - both stay in Settings, where the full 1-6 range
 * still lives. A first-run question with six answers is a quiz.
 */
const LINE_CHOICES = [
  { n: 2, label: "Roomy", hint: "Largest text. Easiest to read from the back row." },
  { n: 3, label: "Balanced", hint: "A good middle for most rooms." },
  { n: 4, label: "Fewer clicks", hint: "More of the verse at once, smaller text." },
] as const;

/*
 * Real words rather than grey bars, but short ones.
 *
 * A thumbnail this size cannot hold a full hymn line at a readable size four
 * times over - the first cut used whole lines and every preview ended in an
 * ellipsis, which made two lines look broken rather than roomy. Short phrases
 * fit at every count, so the only thing that changes between the three cards
 * is what the operator is actually choosing between: how big the words are
 * against how much of the verse fits.
 */
const PREVIEW_LINES = ["Amazing grace", "how sweet", "the sound", "that saved me"];

/** Sized so nothing is ever clipped; the gradient is the point. */
const PREVIEW_SIZE: Record<number, string> = { 2: "0.8rem", 3: "0.64rem", 4: "0.54rem" };

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
  /**
   * keepLibrary=false clears the bundled songs before the dialog closes.
   * linesPerSlide is whatever was picked above, saved with the same click.
   */
  onChoose: (keepLibrary: boolean, linesPerSlide: number) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<"keep" | "empty" | null>(null);
  // Two is what the app has always defaulted to, so leaving it alone changes
  // nothing for anyone who does not care.
  const [lines, setLines] = useState(2);

  const choose = async (keep: boolean) => {
    setBusy(keep ? "keep" : "empty");
    try {
      await onChoose(keep, lines);
    } finally {
      setBusy(null);
    }
  };

  const dialog = useDialog();

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-6">
      <div ref={dialog.ref} {...dialog.dialogProps} aria-labelledby="welcome-title" className="focus:outline-none w-full max-w-xl rounded-xl border border-[var(--v-border)] bg-[var(--v-surface-2)] p-6 text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-[var(--v-accent)] to-[var(--v-accent-2)] text-black">
          <Music4 className="h-6 w-6" />
        </div>
        <h1 id="welcome-title" className="font-display text-xl font-bold">Welcome to Vifug</h1>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-[var(--v-text-dim)]">
          Two quick questions. Both can be changed later in Settings.
        </p>

        <div className="mt-5 text-left">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--v-text-faint)]">
            How many lines of a song on screen at once?
          </p>
          <div role="radiogroup" aria-label="Lines per slide" className="grid gap-2.5 sm:grid-cols-3">
            {LINE_CHOICES.map((choice) => {
              const active = lines === choice.n;
              return (
                <button
                  key={choice.n}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setLines(choice.n)}
                  className={`rounded-lg border-2 p-2.5 text-left transition-colors ${
                    active
                      ? "border-[var(--v-accent)] bg-[var(--v-accent-soft)]"
                      : "border-[var(--v-border)] hover:border-[var(--v-text-faint)]"
                  }`}
                >
                  {/* A real slide at a tenth of the size. The text shrinks as
                      the line count climbs, which is the whole trade-off and
                      is far easier to see than to describe. */}
                  <span
                    aria-hidden="true"
                    className="mb-2 flex aspect-video flex-col items-center justify-center gap-[2px] overflow-hidden rounded bg-black px-1.5 text-center"
                  >
                    {PREVIEW_LINES.slice(0, choice.n).map((line) => (
                      <span
                        key={line}
                        className="block w-full font-semibold leading-tight text-white"
                        style={{ fontSize: PREVIEW_SIZE[choice.n] }}
                      >
                        {line}
                      </span>
                    ))}
                  </span>
                  <span className={`block text-sm font-semibold ${active ? "text-[var(--v-accent)]" : ""}`}>
                    {choice.n} lines
                    <span className="ml-1 font-normal text-[var(--v-text-dim)]">· {choice.label}</span>
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-[var(--v-text-dim)]">
                    {choice.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <p className="mb-2 mt-5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--v-text-faint)]">
          And your song library
        </p>
        <div className="grid gap-2.5 text-left sm:grid-cols-2">
          <button
            onClick={() => choose(true)}
            disabled={busy !== null}
            className="rounded-lg border-2 border-[var(--v-accent)] bg-[var(--v-accent-soft)] p-3.5 transition-colors disabled:opacity-50"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-[var(--v-accent)]">
              {busy === "keep" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Library className="h-4 w-4" />}
              Use the included songs
            </span>
            <span className="mt-1 block text-[12px] text-[var(--v-text-dim)]">
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
            <span className="mt-1 block text-[12px] text-[var(--v-text-dim)]">
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
