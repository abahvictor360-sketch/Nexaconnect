/**
 * Real 3D LUT (.cube) support - a genuine color-grading table, as opposed to
 * the built-in CSS-filter "looks" in color-filters.ts.
 *
 * A .cube file lists LUT_3D_SIZE^3 output RGB triplets, one per quantized
 * input color, in a fixed order (red index moves fastest, then green, then
 * blue - per the Adobe/Resolve .cube spec every tool that exports one
 * follows). Applying it to a frame means, per pixel, quantizing its input
 * RGB into that grid and reading back the graded color.
 */

export type Lut3D = { size: number; data: Float32Array };

/** Parses .cube text. Returns null if it doesn't look like a real LUT. */
export function parseCubeFile(text: string): Lut3D | null {
  let size = 0;
  const values: number[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^(TITLE|DOMAIN_MIN|DOMAIN_MAX|LUT_1D_SIZE)\b/i.test(line)) continue; // domain assumed 0-1, the near-universal case

    const sizeMatch = /^LUT_3D_SIZE\s+(\d+)/i.exec(line);
    if (sizeMatch) {
      size = Number(sizeMatch[1]);
      continue;
    }

    const nums = line.split(/\s+/).map(Number);
    if (nums.length === 3 && nums.every((n) => Number.isFinite(n))) values.push(...nums);
  }

  if (!size || values.length !== size * size * size * 3) return null;
  return { size, data: Float32Array.from(values) };
}

/**
 * Nearest-neighbor sample rather than trilinear interpolation - deliberately.
 * A live capture feed is processed on the CPU (see capture.tsx), one full
 * frame at a time, every animation frame; trilinear needs 8 lookups and 7
 * lerps per pixel where nearest needs 1, and at typical LUT sizes (17-33)
 * the quantization is fine enough that the difference is not visible on a
 * projector, while the speed difference is the gap between smooth and not.
 */
export function applyLutToImageData(frame: ImageData, lut: Lut3D) {
  const d = frame.data;
  const n = lut.size;
  const scale = (n - 1) / 255;
  const data = lut.data;
  for (let i = 0; i < d.length; i += 4) {
    const ri = Math.min(n - 1, Math.round(d[i] * scale));
    const gi = Math.min(n - 1, Math.round(d[i + 1] * scale));
    const bi = Math.min(n - 1, Math.round(d[i + 2] * scale));
    const idx = (ri + gi * n + bi * n * n) * 3;
    d[i] = Math.max(0, Math.min(255, Math.round(data[idx] * 255)));
    d[i + 1] = Math.max(0, Math.min(255, Math.round(data[idx + 1] * 255)));
    d[i + 2] = Math.max(0, Math.min(255, Math.round(data[idx + 2] * 255)));
  }
}

/** Parsed-LUT cache, keyed by id - parsing a 33^3 table is real work worth doing once. */
const parsedCache = new Map<string, Lut3D>();

export function getCachedLut(id: string): Lut3D | undefined {
  return parsedCache.get(id);
}

export function cacheLut(id: string, lut: Lut3D) {
  parsedCache.set(id, lut);
}
