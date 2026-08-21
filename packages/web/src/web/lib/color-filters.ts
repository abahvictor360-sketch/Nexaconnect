/**
 * LUT-style look presets for video/image backgrounds and live capture.
 *
 * A real 3D LUT (a .cube file mapping every input color to a graded output)
 * needs a WebGL pass per frame - a lot of machinery for what a look preset
 * is actually asked to do here. CSS filters combine the same handful of
 * primitives (hue, saturation, contrast, brightness) real LUTs are usually
 * built from, run on the GPU for free via the browser's own compositor, and
 * apply identically to a `<video>`, an `<img>`, or a capture canvas with one
 * `style.filter` string - so that is what a "look" is: a named filter string.
 */
export type ColorFilterPreset = { id: string; label: string; css: string };

export const COLOR_FILTER_PRESETS: ColorFilterPreset[] = [
  { id: "none", label: "None", css: "" },
  { id: "warm", label: "Warm", css: "sepia(0.25) saturate(1.35) brightness(1.05)" },
  { id: "cool", label: "Cool", css: "hue-rotate(180deg) saturate(1.2) brightness(1.02)" },
  { id: "bw", label: "Black & white", css: "grayscale(1) contrast(1.1)" },
  { id: "vintage", label: "Vintage", css: "sepia(0.5) contrast(0.9) brightness(0.95) saturate(0.8)" },
  { id: "vivid", label: "Vivid", css: "saturate(1.55) contrast(1.15)" },
  { id: "cinematic", label: "Cinematic", css: "contrast(1.2) saturate(0.88) brightness(0.95) hue-rotate(-5deg)" },
  { id: "faded", label: "Faded", css: "contrast(0.85) saturate(0.7) brightness(1.08)" },
];

/** Preset id (or a raw CSS filter string, for custom future use) -> usable CSS. */
export function colorFilterCss(idOrCss: string | null | undefined): string {
  if (!idOrCss) return "";
  const preset = COLOR_FILTER_PRESETS.find((p) => p.id === idOrCss);
  return preset ? preset.css : idOrCss;
}
