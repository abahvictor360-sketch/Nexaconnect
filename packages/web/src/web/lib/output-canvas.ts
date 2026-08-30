/**
 * The fixed canvas an output is laid out on, independent of the screen.
 *
 * Without one, every projector lays out against its own pixels, so the same
 * service looks different on each: a 1280x800 projector and a 1920x1080 TV
 * disagree about how much a percentage margin is worth and how many words fit
 * a line, and an operator who set a slide up on one screen finds it re-wrapped
 * on the other. Laying out at a fixed size and scaling that whole picture to
 * whatever screen it lands on makes the output identical everywhere, at the
 * cost of bars where the screen's shape differs from the canvas's.
 *
 * "auto" opts out and uses the screen's own pixels, which is right when the
 * screen already matches the canvas, or when filling an unusually shaped
 * display matters more than matching the others.
 */
export const DEFAULT_OUTPUT_CANVAS = "1920x1080";

export type OutputCanvas = { width: number; height: number } | null;

/** The sizes offered in Settings. 1080p first: it is what a projector, a TV
 *  and a stream all expect, so it is the one that makes them agree. */
export const OUTPUT_CANVASES: { id: string; label: string; hint: string }[] = [
  { id: "1920x1080", label: "1920 × 1080", hint: "Full HD - the usual choice, and what most screens and streams expect" },
  { id: "1280x720", label: "1280 × 720", hint: "720p - same shape, lighter on an older projector PC" },
  { id: "auto", label: "Screen size", hint: "Lay out at each screen's own size - fills any shape, but screens can differ" },
];

/** null means "lay out at the screen's own size" (the `auto` setting). */
export function parseOutputCanvas(resolution: string | undefined | null): OutputCanvas {
  const raw = (resolution ?? DEFAULT_OUTPUT_CANVAS).trim();
  if (!raw || raw.toLowerCase() === "auto" || raw.toLowerCase() === "native") return null;
  const m = /^(\d{3,5})\s*[x×]\s*(\d{3,5})$/i.exec(raw);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  // A canvas of nothing would divide by zero when scaled; fall back to native.
  if (!width || !height) return null;
  return { width, height };
}

/** The uniform scale that fits `canvas` inside `screen` without cropping it. */
export function canvasScale(
  canvas: { width: number; height: number },
  screen: { width: number; height: number },
): number {
  return Math.min(screen.width / canvas.width, screen.height / canvas.height);
}
