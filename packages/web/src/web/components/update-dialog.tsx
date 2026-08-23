import { useEffect } from "react";
import { Download, X, Check, Loader2, AlertTriangle, Sparkles } from "lucide-react";
import { VButton } from "./bits";
import { DOWNLOAD_PAGE, type UpdateStatus } from "../hooks/use-update-check";

/**
 * What a new version actually contains.
 *
 * "An update is available" on its own gives an operator no way to judge
 * whether to install it now or after Sunday, so the release notes are shown
 * in the prompt rather than buried behind a link to a download page.
 */

/**
 * Render GitHub release notes.
 *
 * A deliberately small subset of markdown - headings, bullets, and bold - is
 * enough for a changelog, and everything is emitted as text nodes rather than
 * HTML. Release notes come off the network, so treating them as markup would
 * mean injecting a third party's HTML into the app.
 */
function ReleaseNotes({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");

  const inline = (text: string) =>
    // Split on **bold** and `code`, keeping the delimiters' contents as spans.
    text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        return (
          <strong key={i} className="font-semibold text-[var(--v-text)]">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (/^`[^`]+`$/.test(part)) {
        return (
          <code key={i} className="rounded bg-[var(--v-surface-3)] px-1 py-0.5 text-[12px]">
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });

  const out: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flush = () => {
    if (!bullets.length) return;
    out.push(
      <ul key={`ul${out.length}`} className="my-1.5 space-y-1 pl-1">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--v-accent)]" />
            <span className="min-w-0">{inline(b)}</span>
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);

    if (bullet) {
      bullets.push(bullet[1] ?? "");
      continue;
    }
    flush();
    if (heading) {
      out.push(
        <p key={out.length} className="mt-3 text-[12px] font-semibold uppercase tracking-wide text-[var(--v-text-faint)] first:mt-0">
          {inline(heading[1] ?? "")}
        </p>,
      );
    } else if (line.trim()) {
      out.push(
        <p key={out.length} className="my-1.5">
          {inline(line)}
        </p>,
      );
    }
  }
  flush();

  return <div className="text-[12.5px] leading-relaxed text-[var(--v-text-dim)]">{out}</div>;
}

export function UpdateDialog({
  status,
  onDismiss,
  onSkip,
  onClose,
}: {
  status: UpdateStatus;
  /** "Remind Me Later" - mutes the dialog for this version until a newer one ships. */
  onDismiss: () => void;
  /** "Skip Version" - also hides the header's Update pill for this version. */
  onSkip: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const available = status.kind === "available" ? status.release : null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--v-border)] bg-[var(--v-surface)] shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b border-[var(--v-border)] px-5 py-4">
          <div
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
              available
                ? "bg-gradient-to-br from-[var(--v-accent)] to-[var(--v-accent-2)] text-black"
                : "bg-[var(--v-surface-3)] text-[var(--v-text-faint)]"
            }`}
          >
            {status.kind === "checking" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : status.kind === "error" ? (
              <AlertTriangle className="h-5 w-5 text-amber-400" />
            ) : status.kind === "current" ? (
              <Check className="h-5 w-5 text-[var(--v-ok)]" />
            ) : (
              <Sparkles className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base font-semibold">
              {status.kind === "checking" && "Checking for updates…"}
              {status.kind === "current" && "You are up to date"}
              {status.kind === "error" && "Could not check for updates"}
              {available && `${available.name} is available`}
              {status.kind === "idle" && "Updates"}
            </h2>
            <p className="text-[12px] text-[var(--v-text-faint)]">
              {status.kind === "current" && `Vifug ${status.version} is the newest version.`}
              {status.kind === "error" && status.message}
              {status.kind === "available" &&
                `You have ${status.version}. Installing keeps your songs, media and settings.`}
              {status.kind === "checking" && "Asking GitHub for the newest release."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-[var(--v-text-faint)] hover:bg-[var(--v-surface-3)] hover:text-[var(--v-text)]"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        {available && (
          <div className="v-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--v-text-faint)]">
              What changed
            </p>
            {available.notes ? (
              <ReleaseNotes markdown={available.notes} />
            ) : (
              <p className="text-[12.5px] text-[var(--v-text-dim)]">
                This release has no notes. The full list of changes is on the release page.
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-[var(--v-border)] px-5 py-3">
          {available ? (
            <>
              <VButton variant="ghost" onClick={onSkip}>
                Skip Version
              </VButton>
              <VButton variant="subtle" onClick={onDismiss}>
                Remind Me Later
              </VButton>
              <VButton
                variant="primary"
                onClick={() => window.open(DOWNLOAD_PAGE, "_blank", "noreferrer")}
              >
                <Download className="h-4 w-4" /> Update Now
              </VButton>
            </>
          ) : (
            <VButton variant="primary" onClick={onClose}>
              Close
            </VButton>
          )}
        </div>
      </div>
    </div>
  );
}
