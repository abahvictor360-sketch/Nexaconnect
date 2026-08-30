/**
 * The fixed canvas an output is laid out on, independent of the screen.
 *
 * Off by default. Filling the screen you actually have is the right default,
 * and a fixed canvas costs real picture to do it: anything whose shape differs
 * from the canvas gets black bars, and the screens where that bites are the
 * ones already short of pixels - an analog VGA projector, an older 4:3 or
 * 16:10 panel. Those setups need MORE of their screen, not a letterboxed 16:9
 * inside it.
 *
 * It earns its place when several screens must agree: laying out once and
 * scaling that whole picture means a slide wraps identically on a 1280x800
 * projector and a 1920x1080 TV, instead of each laying out against its own
 * pixels. That is worth bars - but only to someone who wants the trade.
 */
export const DEFAULT_OUTPUT_CANVAS = "auto";

export type OutputCanvas = { width: number; height: number } | null;

/** The sizes offered in Settings, the default first. */
export const OUTPUT_CANVASES: { id: string; label: string; hint: string }[] = [
  { id: "auto", label: "Screen size", hint: "Fills whatever screen it is on, whatever shape - no bars, and no two screens have to match" },
  { id: "1920x1080", label: "1920 × 1080", hint: "Lay out at Full HD and scale it - every screen shows the same thing, with bars where the shape differs" },
  { id: "1280x720", label: "1280 × 720", hint: "The same, at 720p - lighter on an older projector PC" },
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
