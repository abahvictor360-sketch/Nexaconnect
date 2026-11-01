import { MediaImg, MediaVideo } from "./media-el";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { VButton } from "./bits";
import { MediaPicker } from "./media-picker";
import { useMedia } from "../hooks/use-media";
import { useSettings } from "../hooks/use-settings";

/** The only thing this card needs to know about a slide. */
export type DeckSlideBg = { backgroundId: string | null };

/**
 * Where the operator's choice to fold the card away is kept.
 *
 * Per browser rather than per deck: "I know where this is, stop giving it a
 * third of the slide list" is a thing somebody means about the app, not about
 * one presentation, and having to fold it again on every deck would be worse
 * than not being able to fold it at all.
 */
const HIDE_KEY = "vifug.deckBg.collapsed";

function readHidden(): boolean | null {
  try {
    const raw = localStorage.getItem(HIDE_KEY);
    return raw === null ? null : raw === "1";
  } catch {
    return null;
  }
}

/**
 * One background for a whole deck, with the reasons a slide might ignore it.
 *
 * Shared rather than written twice because it appears both in the editor and
 * on the Presentations panel, and the two must not drift: the counts, the
 * wording and the precedence they describe are the whole point of the card,
 * and a second copy is how one of them ends up saying something that is no
 * longer true.
 */
export function DeckBackgroundCard({
  backgroundId,
  onChange,
  slides,
  onUseOnAll,
  busy = false,
  collapsible = false,
  className = "",
}: {
  backgroundId: string | null;
  onChange: (id: string | null) => void;
  slides: DeckSlideBg[];
  /** Drop the per-slide pictures that are standing in this one's way. */
  onUseOnAll: () => void;
  /** A save is in flight - the panel writes straight through, the editor does not. */
  busy?: boolean;
  /**
   * Let the operator fold this away.
   *
   * On the Presentations tab the card sits above the slides all the time,
   * and once the background is set there is nothing left to do with it - it
   * is just taking room away from the thing the operator is actually looking
   * at. In the editor it stays open: that is a form being filled in, and
   * hiding a field in a form is how it goes unnoticed.
   */
  collapsible?: boolean;
  className?: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  /*
   * null until the stored choice has been read, so the first paint does not
   * guess and then jump. Nothing stored means: folded if the deck already
   * has a background, because then the card has done its job, and open if it
   * has none, because then it is the thing to notice.
   */
  const [hidden, setHidden] = useState<boolean | null>(null);
  useEffect(() => setHidden(readHidden()), []);
  const folded = collapsible && (hidden ?? !!backgroundId);
  const setFolded = (next: boolean) => {
    setHidden(next);
    if (next) setPickerOpen(false);
    try {
      localStorage.setItem(HIDE_KEY, next ? "1" : "0");
    } catch {
      /* a browser that refuses storage still folds, just not next time */
    }
  };
  const media = useMedia();
  const settings = useSettings().data;
  const deckBg = backgroundId ? media.data?.find((m) => m.id === backgroundId) : null;

  /*
   * Which slides will ignore this background, and why - the answer to "I set
   * one picture for the whole deck and nothing happened".
   *
   * A slide's own background wins, which is the point of having one, but
   * until the card said so the deck background simply looked broken on any
   * deck whose slides already carried something. The two reasons a slide
   * carries one are not the same and must not be offered the same way:
   *
   *  - A picture chosen from the library is a decoration. Dropping it just
   *    means the slide follows the deck instead, and the picture is still in
   *    the library if they want it back.
   *  - An imported PowerPoint or PDF page IS the slide. It is not in the
   *    library, which is how it is recognised here, and clearing it would
   *    leave an empty slide - so it is reported, never offered as a button.
   *
   * Both are held back until the library has loaded, or every slide would
   * briefly be counted as an imported page.
   */
  const chosen = media.data
    ? slides.filter((s) => s.backgroundId && media.data!.some((m) => m.id === s.backgroundId)).length
    : 0;
  const imported = media.data
    ? slides.filter((s) => s.backgroundId && !media.data!.some((m) => m.id === s.backgroundId)).length
    : 0;

  const thumb =
    deckBg ? (
      deckBg.type === "video" ? (
        <MediaVideo src={deckBg.url} muted className="h-full w-full object-cover" />
      ) : deckBg.type === "color" ? (
        <span className="block h-full w-full" style={{ background: deckBg.url }} />
      ) : (
        <MediaImg src={deckBg.url} alt="" className="h-full w-full object-cover" />
      )
    ) : (
      <span className="grid h-full w-full place-items-center text-[10px] text-[var(--v-text-faint)]">None</span>
    );

  /*
   * Folded is a slim line, not nothing at all.
   *
   * A control that disappears completely is a control nobody can find again,
   * so the name stays, and so does the picture currently in force - which is
   * the one thing worth seeing at a glance while running a service.
   */
  if (folded) {
    return (
      <button
        onClick={() => setFolded(false)}
        className={`flex w-full items-center gap-2.5 rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-2)] px-3 py-1.5 text-left transition-colors hover:border-[var(--v-text-faint)] ${className}`}
      >
        <span className="relative aspect-video w-10 shrink-0 overflow-hidden rounded border border-[var(--v-border)] bg-black">
          {thumb}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--v-text-dim)]">
          Background for every slide
          {chosen > 0 && (
            <span className="ml-1.5 text-[var(--v-text-faint)]">
              · {chosen} slide{chosen === 1 ? "" : "s"} keep{chosen === 1 ? "s" : ""} its own
            </span>
          )}
        </span>
        {busy && <span className="shrink-0 text-[11px] text-[var(--v-text-faint)]">saving…</span>}
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--v-text-faint)]" />
      </button>
    );
  }

  return (
    <div className={`rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-2)] p-3 ${className}`}>
      <div className="flex items-start gap-3">
        <button
          onClick={() => setPickerOpen((v) => !v)}
          title="Choose one background for every slide"
          className={`relative aspect-video w-24 shrink-0 overflow-hidden rounded-md border-2 bg-black transition-colors ${
            pickerOpen ? "border-[var(--v-accent)]" : "border-[var(--v-border)] hover:border-[var(--v-text-faint)]"
          }`}
        >
          {thumb}
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="min-w-0 flex-1">
              Background for every slide
              {busy && <span className="ml-2 text-[11px] font-normal text-[var(--v-text-faint)]">saving…</span>}
            </span>
            {collapsible && (
              <button
                onClick={() => setFolded(true)}
                title="Fold this away - the slim line stays, so it is still here when you want it"
                className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-normal text-[var(--v-text-faint)] transition-colors hover:text-[var(--v-text)]"
              >
                Hide <ChevronUp className="h-3.5 w-3.5" />
              </button>
            )}
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-[var(--v-text-dim)]">
            Used by every slide that has not been given one of its own.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <VButton variant="subtle" size="sm" onClick={() => setPickerOpen((v) => !v)}>
              {pickerOpen ? "Done" : backgroundId ? "Change" : "Choose"}
            </VButton>
            {/* The one-click version of what was asked for: the picture the
                lyrics already use, so a service looks like one service
                rather than two. */}
            {settings?.activeBackgroundId && settings.activeBackgroundId !== backgroundId && (
              <VButton variant="subtle" size="sm" onClick={() => onChange(settings.activeBackgroundId ?? null)}>
                Match the lyrics background
              </VButton>
            )}
            {backgroundId && (
              <VButton variant="subtle" size="sm" onClick={() => onChange(null)}>
                Clear
              </VButton>
            )}
          </div>
          {/* Why the picture they just chose is not on every slide, said
              where they are standing when they wonder. */}
          {chosen > 0 && (
            <p className="mt-2 text-[12px] leading-snug text-[var(--v-text-dim)]">
              {chosen === 1
                ? "1 slide has a picture of its own and keeps it."
                : `${chosen} slides have a picture of their own and keep it.`}{" "}
              <button
                className="font-medium text-[var(--v-accent)] underline-offset-2 hover:underline"
                onClick={onUseOnAll}
              >
                Use this background on {chosen === 1 ? "it" : "them"} too
              </button>
            </p>
          )}
          {imported > 0 && (
            <p className="mt-1 text-[12px] leading-snug text-[var(--v-text-faint)]">
              {imported === 1 ? "1 slide is" : `${imported} slides are`} an imported page, which is the slide itself -{" "}
              {imported === 1 ? "it shows" : "they show"} the page rather than any background.
            </p>
          )}
        </div>
      </div>
      {pickerOpen && (
        <div className="mt-3 border-t border-[var(--v-border)] pt-3">
          <MediaPicker
            activeId={backgroundId}
            onSelect={(id) => onChange(id)}
            defaultFit={settings?.mediaDefaults?.fit ?? "cover"}
            defaultMuted={!(settings?.mediaDefaults?.videoSound ?? true)}
          />
        </div>
      )}
    </div>
  );
}
