import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { uploadMediaFile } from "./use-media";
import {
  renderPdfToPages, sortByNaturalName, isSlideImage,
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
    async (files: File[], title: string): Promise<string | null> => {
      if (!files.length) return null;
      setState({ busy: true, step: "Reading the file…", done: 0, total: 0, error: null });

      try {
        // 1. Get one image per slide, either by rendering a PDF or by taking
        //    the exported images as they are.
        let images: { blob: Blob; name: string }[] = [];
        const pdf = files.find((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));

        if (pdf) {
          setState((s) => ({ ...s, step: "Rendering slides…" }));
          const pages = await renderPdfToPages(pdf, (done, total) =>
            setState((s) => ({ ...s, step: "Rendering slides…", done, total })),
          );
          images = pages.map((p) => ({
            blob: p.blob,
            name: `${title || "slide"}-${String(p.index).padStart(3, "0")}.png`,
          }));
        } else {
          const picked = sortByNaturalName(files.filter(isSlideImage));
          if (!picked.length) throw new Error("Those files are not slide images or a PDF.");
          images = picked.map((f) => ({ blob: f, name: f.name }));
        }

        if (!images.length) throw new Error("No slides were found in that file.");

        // 2. Store each picture in the media library, one at a time. Uploading
        //    a 40-slide deck in parallel floods the server and makes progress
        //    impossible to report honestly.
        const slides: SlidePayload[] = [];
        setState((s) => ({ ...s, step: "Saving slides…", done: 0, total: images.length }));

        for (let i = 0; i < images.length; i++) {
          const img = images[i]!;
          const file = new File([img.blob], img.name, { type: img.blob.type || "image/png" });
          const media = await uploadMediaFile(file);
          slides.push({
            heading: "",
            body: "",
            backgroundId: media.id,
            bgColor: null,
            textColor: null,
            format: null,
            textAlign: null,
          });
          setState((s) => ({ ...s, done: i + 1 }));
        }

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
