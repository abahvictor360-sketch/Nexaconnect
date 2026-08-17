import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { uploadMediaFile } from "./use-media";
import {
  renderPdfToPages, sortByNaturalName, isSlideImage, type RenderQuality,
} from "../lib/deck-render";

/**
 * Importing a deck exactly as it was designed.
 *
 * Each page becomes one slide whose entire background is the rendered picture,
 * with no text of its own. That is deliberate: the words are already drawn
 * into the image, in the deck's own font and position, so adding the app's
 * text on top would print everything twice.
 */

export type DeckImportState = {
  busy: boolean;
  /** What is happening, in words the operator can act on. */
  step: string;
  done: number;
  total: number;
  error: string | null;
};

const IDLE: DeckImportState = { busy: false, step: "", done: 0, total: 0, error: null };

/** Slide bodies are empty, so the picture is what shows. */
type SlidePayload = {
  heading: string;
  body: string;
  backgroundId: string | null;
  bgColor: null;
  textColor: null;
  format: null;
  textAlign: null;
};

export function useDeckImport() {
  const qc = useQueryClient();
  const [state, setState] = useState<DeckImportState>(IDLE);

  const reset = useCallback(() => setState(IDLE), []);

  /**
   * Build a presentation from a PDF exported by PowerPoint/Keynote, or from a
   * set of exported slide images. Returns the new presentation's id.
   */
  const importDeck = useCallback(
    async (files: File[], title: string, quality: RenderQuality = "sharp"): Promise<string | null> => {
      if (!files.length) return null;
      setState({ busy: true, step: "Reading the file…", done: 0, total: 0, error: null });

      const slideFor = (backgroundId: string): SlidePayload => ({
        heading: "",
        body: "",
        backgroundId,
        bgColor: null,
        textColor: null,
        format: null,
        textAlign: null,
      });

      /**
       * Store a picture, keeping its page number so order survives.
       *
       * Uploads run a few at a time rather than strictly one after another.
       * Each one is mostly waiting - a round trip to the local server, a disk
       * write, a row inserted - so running them one at a time leaves the
       * machine idle between pages for no benefit. The cap keeps that from
       * turning into forty simultaneous writes.
       */
      const UPLOAD_CONCURRENCY = 3;
      let active = 0;
      const waiting: (() => void)[] = [];
      const uploadSlot = async <T>(job: () => Promise<T>): Promise<T> => {
        if (active >= UPLOAD_CONCURRENCY) await new Promise<void>((r) => waiting.push(r));
        active++;
        try {
          return await job();
        } finally {
          active--;
          waiting.shift()?.();
        }
      };

      let saved = 0;
      const uploads: Promise<{ index: number; id: string }>[] = [];
      const queueUpload = (blob: Blob, name: string, index: number) => {
        uploads.push(
          uploadSlot(async () => {
            const f = new File([blob], name, { type: blob.type || "image/jpeg" });
            const media = await uploadMediaFile(f);
            saved++;
            setState((s) => ({ ...s, done: saved }));
            return { index, id: media.id };
          }),
        );
      };

      try {
        // Render and store at the same time. Waiting for the whole deck to
        // rasterise before saving anything meant the two slowest parts of an
        // import ran back to back instead of overlapping, and every page's
        // bitmap sat in memory until the last one was drawn.
        const pdf = files.find((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));

        if (pdf) {
          setState((s) => ({ ...s, step: "Rendering slides…" }));
          await renderPdfToPages(
            pdf,
            (done, total) =>
              setState((s) => ({ ...s, step: "Rendering slides…", done: s.done, total })),
            quality,
            (page) =>
              // Extension has to match what was actually encoded, or the server
              // stores a .png containing JPEG bytes and some players refuse it.
              queueUpload(page.blob, `${title || "slide"}-${String(page.index).padStart(3, "0")}.jpg`, page.index),
          );
        } else {
          const picked = sortByNaturalName(files.filter(isSlideImage));
          if (!picked.length) throw new Error("Those files are not slide images or a PDF.");
          picked.forEach((f, i) => queueUpload(f, f.name, i + 1));
        }

        if (!uploads.length) throw new Error("No slides were found in that file.");

        setState((s) => ({ ...s, step: "Saving slides…", total: uploads.length }));
        const stored = await Promise.all(uploads);
        // Uploads finish out of order; the deck must not.
        stored.sort((a, b) => a.index - b.index);
        const slides: SlidePayload[] = stored.map((r) => slideFor(r.id));

        // 3. One presentation, in page order.
        setState((s) => ({ ...s, step: "Building the presentation…" }));
        const res = await fetch("/api/presentations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title || "Imported presentation", slides }),
        });
        if (!res.ok) throw new Error("The presentation could not be saved.");
        const { id } = (await res.json()) as { id: string };

        await qc.invalidateQueries({ queryKey: ["presentations"] });
        await qc.invalidateQueries({ queryKey: ["media"] });
        setState(IDLE);
        return id;
      } catch (e) {
        setState({ busy: false, step: "", done: 0, total: 0, error: (e as Error).message });
        return null;
      }
    },
    [qc],
  );

  return { ...state, importDeck, reset };
}
