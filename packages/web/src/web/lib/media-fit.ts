/**
 * How a picture or video is placed on the screen.
 *
 * The three values are CSS object-fit's, but the names an operator sees are
 * not: "cover" and "contain" describe what the box does, and the person
 * choosing wants to know what happens to their picture.
 */
export type MediaFit = "contain" | "cover" | "fill";

export const MEDIA_FITS: { id: MediaFit; label: string; hint: string }[] = [
  { id: "contain", label: "Contain", hint: "Whole picture on screen - bars at the sides if it is a different shape" },
  { id: "cover", label: "Fill screen", hint: "Fills the screen edge to edge - the overflowing edges are cropped off" },
  { id: "fill", label: "Stretch", hint: "Stretches to the screen exactly - fills it, but distorts the picture" },
];

export function fitLabel(fit: MediaFit): string {
  return MEDIA_FITS.find((f) => f.id === fit)?.label ?? fit;
}

/** The next option in the cycle, for a control that advances on each click. */
export function nextFit(fit: MediaFit): MediaFit {
  const i = MEDIA_FITS.findIndex((f) => f.id === fit);
  return MEDIA_FITS[(Math.max(i, 0) + 1) % MEDIA_FITS.length]!.id;
}

/**
 * Read a stored value, falling back to what suits the context.
 *
 * Content ("slide") defaults to contain and decoration ("background") to
 * cover, because the cost of being wrong differs: cropping a flyer or an
 * imported deck page throws away words someone needs to read, while cropping a
 * photo behind lyrics is invisible and letterboxing it would put black bars
 * around the whole service.
 */
export function resolveFit(stored: string | null | undefined, use: "slide" | "background"): MediaFit {
  if (stored === "contain" || stored === "cover" || stored === "fill") return stored;
  return use === "slide" ? "contain" : "cover";
}
