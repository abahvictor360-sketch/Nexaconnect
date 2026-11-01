import { useEffect, useRef, useState } from "react";
import { bookName, loadBook, useBibleManifest, type BibleManifest } from "./use-bible";
import { buildCorpus, type VerseCorpus } from "../lib/quoted-verse";

export type CorpusStatus = "off" | "loading" | "ready" | "error";

/**
 * The searchable form of one Bible version, held ready for auto-follow.
 *
 * Built ahead of time on purpose. Recognising a quotation has to answer in
 * the gap between one sentence and the next, and loading sixty-six files and
 * indexing thirty thousand verses is a second of work - fine before the
 * service, useless in the middle of one. So it is prepared the moment the
 * feature is switched on and simply sits there.
 */
export function useVerseCorpus(versionId: string | null, enabled: boolean) {
  const manifest = useBibleManifest();
  const [corpus, setCorpus] = useState<VerseCorpus | null>(null);
  const [status, setStatus] = useState<CorpusStatus>("off");
  const [progress, setProgress] = useState(0);
  // Read by the matcher through a ref, so a sentence arriving mid-rebuild
  // uses whatever is currently complete rather than a half-built index.
  const ref = useRef<VerseCorpus | null>(null);

  useEffect(() => {
    if (!enabled || !versionId || !manifest.data) {
      ref.current = null;
      setCorpus(null);
      setStatus("off");
      setProgress(0);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setProgress(0);

    void (async () => {
      try {
        const built = await assemble(versionId, manifest.data!, (p) => {
          if (!cancelled) setProgress(p);
        }, () => cancelled);
        if (cancelled || !built) return;
        ref.current = built;
        setCorpus(built);
        setStatus("ready");
      } catch {
        if (cancelled) return;
        ref.current = null;
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [versionId, enabled, manifest.data]);

  return { corpus, corpusRef: ref, status, progress };
}

/**
 * Fetch every book of a version and index it, yielding between books.
 *
 * The yields are the point. Done in one go this blocks the operator screen
 * for about a second - the clock stops, buttons do not press - and it runs
 * exactly when somebody is setting up. A book at a time keeps the app alive
 * throughout and costs nothing but a few more ticks of the event loop.
 */
async function assemble(
  versionId: string,
  manifest: BibleManifest,
  onProgress: (p: number) => void,
  cancelled: () => boolean,
): Promise<VerseCorpus | null> {
  const version = manifest.versions.find((v) => v.id === versionId);
  if (!version) return null;

  const rows: { code: string; name: string; chapter: number; verse: number; text: string }[] = [];
  for (let i = 0; i < version.books.length; i++) {
    if (cancelled()) return null;
    const code = version.books[i]!;
    const data = await loadBook(versionId, code);
    const name = bookName(manifest, code);
    for (const [ch, verses] of Object.entries(data.c)) {
      const chapter = Number(ch);
      for (let v = 0; v < verses.length; v++) {
        const text = verses[v];
        if (text) rows.push({ code, name, chapter, verse: v + 1, text });
      }
    }
    onProgress((i + 1) / version.books.length);
    // Hand the browser back control between books.
    await new Promise((r) => setTimeout(r, 0));
  }
  if (cancelled()) return null;
  return buildCorpus(versionId, rows);
}
