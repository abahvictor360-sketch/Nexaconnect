/**
 * Turning an exported deck into slides that look exactly like the original.
 *
 * Reading a .pptx gives you its words, not its design. Reproducing the design
 * would mean reimplementing PowerPoint's layout engine - positioned shapes,
 * curves, gradients, z-order, the deck's own fonts - and anything short of
 * that lands the text in the wrong place on the wrong background, which is
 * worse than not trying.
 *
 * So the rendering is left to the program that already does it correctly.
 * PowerPoint exports the deck (Save as PDF, or Export as PNG), and each page
 * becomes one full-bleed slide picture here. The result is pixel-identical to
 * what was designed, because PowerPoint drew it.
 *
 * Rendering happens in the renderer process, against a real browser canvas.
 * That matters: the same job attempted in Node needs a canvas polyfill, and
 * the ones available do not implement Path2D the way pdf.js needs for glyph
 * filling - text silently fails to draw while shapes come out fine.
 */
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Long edge of a rendered page, in pixels. 1920 matches the projector's own
 * canvas: enough that a slide is sharp on a 1080p output without producing
 * files so large that a 40-slide deck fills the media folder.
 */
const TARGET_LONG_EDGE = 1920;

export type RenderedPage = { blob: Blob; index: number; width: number; height: number };

/** How far along a multi-page render is, so the UI can show real progress. */
export type RenderProgress = (done: number, total: number) => void;

/**
 * Render every page of a PDF to a PNG blob.
 *
 * Pages are done one at a time and the canvas is released as it goes: a large
 * deck rendered all at once holds every page's bitmap in memory, which on a
 * modest church laptop is how the tab dies partway through an import.
 */
export async function renderPdfToPages(file: File, onProgress?: RenderProgress): Promise<RenderedPage[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const out: RenderedPage[] = [];

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = TARGET_LONG_EDGE / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not create a canvas to draw the slides on.");

      await page.render({ canvas, canvasContext: ctx, viewport }).promise;

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error(`Page ${i} could not be converted to an image.`);
      out.push({ blob, index: i, width: canvas.width, height: canvas.height });

      // Let the bitmap go before the next page is drawn.
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      onProgress?.(i, doc.numPages);
    }
  } finally {
    // Releases the worker and the parsed document. Named cleanup() in pdf.js 6.
    await doc.cleanup();
  }

  return out;
}

/**
 * Order exported images the way a person means them to be ordered.
 *
 * PowerPoint names them "Slide1.PNG", "Slide2.PNG" … "Slide10.PNG", and plain
 * alphabetical sorting puts slide 10 immediately after slide 1. Comparing the
 * numbers inside the names instead keeps the service in the right order.
 */
export function sortByNaturalName(files: File[]): File[] {
  const key = (name: string) =>
    name.replace(/\d+/g, (n) => n.padStart(10, "0")).toLowerCase();
  return [...files].sort((a, b) => key(a.name).localeCompare(key(b.name)));
}

/** True for the image types PowerPoint and Keynote export slides as. */
export function isSlideImage(file: File): boolean {
  return /^image\/(png|jpeg|webp)$/.test(file.type);
}
