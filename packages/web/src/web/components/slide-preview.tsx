import { MediaImg, MediaVideo } from "./media-el";
import { runStyle, toRunLines, type TextAlign, type TextFormat } from "../lib/rich-text";
import type { MediaItem } from "../hooks/use-media";

/**
 * What a deck slide will actually look like, beside the box it is typed in.
 *
 * The editor needs this specifically because of per-word sizing. Colour,
 * bold and italic can be painted straight onto the text box, but size cannot
 * - the box is a real <textarea> with the caret and selection the operator
 * expects, and a run rendered half again as large there would wrap
 * differently from the invisible text underneath, putting the caret a few
 * characters away from the word it is on. So the box marks resized text and
 * this shows the truth.
 *
 * Deliberately not SlideRender. That one auto-fits against the surface it is
 * drawn on, carries theme merging, background video sound and live state;
 * none of which belongs in a thumbnail whose only job is "is that the right
 * size".
 */
export function SlidePreview({
  heading,
  body,
  formats,
  align,
  background,
  backgroundUrl,
  bgColor,
  textColor,
  className = "",
}: {
  heading: string;
  body: string;
  formats: TextFormat[];
  align: TextAlign | null;
  /** The picture or video behind it - the slide's own, or the deck's. */
  background?: MediaItem | null;
  /** An imported deck page, which is not in the media library and has only a URL. */
  backgroundUrl?: string | null;
  bgColor?: string | null;
  textColor?: string | null;
  className?: string;
}) {
  const lines = toRunLines(body, formats);
  const empty = !heading.trim() && !body.trim();

  return (
    <div
      className={`relative aspect-video w-full overflow-hidden rounded-md border border-[var(--v-border)] bg-black ${className}`}
      style={bgColor ? { background: bgColor } : undefined}
    >
      {background?.type === "color" ? (
        <span className="absolute inset-0" style={{ background: background.url }} />
      ) : background?.type === "video" ? (
        <MediaVideo src={background.url} muted className="absolute inset-0 h-full w-full object-cover" />
      ) : background?.type === "image" ? (
        <MediaImg src={background.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : backgroundUrl ? (
        <MediaImg src={backgroundUrl} alt="" className="absolute inset-0 h-full w-full object-contain" />
      ) : null}

      {empty ? (
        <span className="absolute inset-0 grid place-items-center text-[10px] text-white/40">
          Image / video slide
        </span>
      ) : (
        <div
          className="absolute inset-0 flex flex-col justify-center gap-[2%] px-[6%] py-[5%] leading-tight"
          style={{
            color: textColor ?? "#ffffff",
            textAlign: align ?? "center",
            // A drop shadow for the same reason the live output has one: white
            // words on a bright photo are unreadable without it, and a preview
            // that is readable where the screen is not would be a lie.
            textShadow: "0 1px 3px rgba(0,0,0,.75)",
          }}
        >
          {heading.trim() && (
            <span className="text-[9px] font-semibold uppercase tracking-wide opacity-90">{heading}</span>
          )}
          {lines.map((runs, i) => (
            <span key={i} className="text-[8px]">
              {runs.length === 0
                ? " "
                : runs.map((run, j) => (
                    <span key={j} style={runStyle(run)}>
                      {run.text}
                    </span>
                  ))}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
