import { useEffect, useState } from "react";
import { X, Plus, Trash2, ChevronUp, ChevronDown, ImageIcon, Film, Sparkles } from "lucide-react";
import { VButton } from "./bits";
import { splitParagraphs } from "../lib/paste-split";
import { MediaPicker } from "./media-picker";
import { useMedia } from "../hooks/use-media";
import { useSettings } from "../hooks/use-settings";
import {
  useCreatePresentation, useSavePresentation,
  type FullPresentation, type SlideDraft,
} from "../hooks/use-presentations";

type EditSlide = SlideDraft & { key: string };

let keyCounter = 0;
const nk = () => `p${keyCounter++}`;

/**
 * Create / edit a presentation: title + an ordered list of slides, each with
 * an optional heading, body text, and background (image / video / color -
 * the same picker used for Lyrics/Bible backgrounds in Settings).
 */
export function PresentationEditor({
  presentation,
  onClose,
}: {
  presentation: FullPresentation | null; // null = new presentation
  onClose: (savedId?: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [slides, setSlides] = useState<EditSlide[]>([]);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  /** Transient confirmation that a paste was broken into slides. */
  const [splitNote, setSplitNote] = useState<string | null>(null);
  const media = useMedia();
  const settings = useSettings().data;

  useEffect(() => {
    if (presentation) {
      setTitle(presentation.presentation.title);
      setSlides(
        presentation.slides.map((s) => ({
          key: nk(),
          heading: s.heading ?? "",
          body: s.body ?? "",
          backgroundId: s.backgroundId,
          bgColor: s.bgColor,
          textColor: s.textColor,
        })),
      );
    } else {
      setTitle("");
      setSlides([{ key: nk(), heading: "", body: "", backgroundId: null, bgColor: null, textColor: null }]);
    }
  }, [presentation]);

  // The note is confirmation, not a warning: show it briefly and let it go.
  useEffect(() => {
    if (!splitNote) return;
    const t = setTimeout(() => setSplitNote(null), 4000);
    return () => clearTimeout(t);
  }, [splitNote]);

  const create = useCreatePresentation();
  const update = useSavePresentation();
  const saving = create.isPending || update.isPending;

  const save = () => {
    const payload = {
      title: title.trim() || "Untitled Presentation",
      slides: slides.map(({ heading, body, backgroundId, bgColor, textColor }) => ({
        heading, body, backgroundId, bgColor, textColor,
      })),
    };
    if (presentation) {
      update.mutate({ id: presentation.presentation.id, ...payload }, { onSuccess: () => onClose(presentation.presentation.id) });
    } else {
      create.mutate(payload, { onSuccess: (d) => onClose(d.id) });
    }
  };

  const addSlide = () =>
    setSlides((prev) => [...prev, { key: nk(), heading: "", body: "", backgroundId: null, bgColor: null, textColor: null }]);
  const removeSlide = (key: string) => setSlides((prev) => prev.filter((s) => s.key !== key));
  const moveSlide = (idx: number, dir: -1 | 1) => {
    setSlides((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };
  const patchSlide = (key: string, patch: Partial<EditSlide>) =>
    setSlides((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  /**
   * Paste a multi-paragraph block and get a slide per paragraph. The first
   * paragraph lands where the cursor already was; the rest are inserted
   * directly after this slide, inheriting its background and colours so a
   * pasted section stays visually of a piece with the slide it came from.
   */
  const pasteAsSlides = (key: string, e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text/plain");
    const paragraphs = splitParagraphs(text);
    if (paragraphs.length < 2) return; // single paragraph - let the browser paste it

    e.preventDefault();
    const el = e.currentTarget;
    const before = el.value.slice(0, el.selectionStart);
    const after = el.value.slice(el.selectionEnd);
    const [first, ...rest] = paragraphs;

    setSlides((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      const target = prev[idx];
      if (idx === -1 || !target) return prev;
      const head: EditSlide = { ...target, body: `${before}${first ?? ""}${after}` };
      const made: EditSlide[] = rest.map((body) => ({
        key: nk(),
        heading: "",
        body,
        backgroundId: target.backgroundId,
        bgColor: target.bgColor,
        textColor: target.textColor,
      }));
      return [...prev.slice(0, idx), head, ...made, ...prev.slice(idx + 1)];
    });
    setSplitNote(`Pasted text split into ${paragraphs.length} slides.`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[var(--v-border)] bg-[var(--v-surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--v-border)] px-5 py-3">
          <h2 className="font-display text-lg font-semibold">{presentation ? "Edit presentation" : "New presentation"}</h2>
          <button onClick={() => onClose()} className="text-[var(--v-text-faint)] hover:text-[var(--v-text)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="v-scroll min-h-0 flex-1 overflow-y-auto p-5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Presentation title"
            className="mb-4 w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-3 py-2 text-sm font-medium outline-none focus:border-[var(--v-accent)]"
          />

          <div className="space-y-3">
            {slides.map((s, i) => {
              const bg = s.backgroundId ? media.data?.find((m) => m.id === s.backgroundId) : null;
              return (
                <div key={s.key} className="rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-2)] p-3">
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => setPickerFor(pickerFor === s.key ? null : s.key)}
                      title="Choose background"
                      className={`relative aspect-video w-24 shrink-0 overflow-hidden rounded-md border-2 bg-black transition-colors ${
                        pickerFor === s.key ? "border-[var(--v-accent)]" : "border-[var(--v-border)] hover:border-[var(--v-text-faint)]"
                      }`}
                    >
                      {bg?.type === "color" ? (
                        <span className="block h-full w-full" style={{ background: bg.url }} />
                      ) : bg?.type === "video" ? (
                        <>
                          <video src={bg.url} muted className="h-full w-full object-cover" />
                          <Film className="absolute right-1 top-1 h-3 w-3 text-white/80" />
                        </>
                      ) : bg?.type === "image" ? (
                        <img src={bg.url} alt="" className="h-full w-full object-cover" />
                      ) : s.bgColor ? (
                        // Design imported from the deck - show its own color,
                        // with a text sample so the pairing is visible.
                        <span
                          className="grid h-full w-full place-items-center text-[9px] font-semibold"
                          style={{ background: s.bgColor, color: s.textColor ?? "#fff" }}
                        >
                          Aa
                        </span>
                      ) : (
                        <span className="grid h-full w-full place-items-center text-[var(--v-text-faint)]">
                          <ImageIcon className="h-4 w-4" />
                        </span>
                      )}
                    </button>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <input
                        value={s.heading}
                        onChange={(e) => patchSlide(s.key, { heading: e.target.value })}
                        placeholder="Heading (optional)"
                        className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2.5 py-1.5 text-sm font-medium outline-none focus:border-[var(--v-accent)]"
                      />
                      <textarea
                        value={s.body}
                        onChange={(e) => patchSlide(s.key, { body: e.target.value })}
                        onPaste={(e) => pasteAsSlides(s.key, e)}
                        placeholder="Body text (optional) - leave both blank for a full-screen image/video slide"
                        rows={2}
                        className="w-full resize-none rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--v-accent)]"
                      />
                    </div>

                    <div className="flex shrink-0 flex-col items-center gap-1">
                      <span className="mb-0.5 text-[10px] text-[var(--v-text-faint)]">{i + 1}</span>
                      <button title="Move up" onClick={() => moveSlide(i, -1)} disabled={i === 0} className="rounded p-1 text-[var(--v-text-faint)] hover:bg-[var(--v-surface-3)] hover:text-[var(--v-text)] disabled:opacity-30">
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button title="Move down" onClick={() => moveSlide(i, 1)} disabled={i === slides.length - 1} className="rounded p-1 text-[var(--v-text-faint)] hover:bg-[var(--v-surface-3)] hover:text-[var(--v-text)] disabled:opacity-30">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <button title="Remove slide" onClick={() => removeSlide(s.key)} disabled={slides.length <= 1} className="rounded p-1 text-[var(--v-text-faint)] hover:bg-[var(--v-live-soft)] hover:text-[var(--v-live)] disabled:opacity-30">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {pickerFor === s.key && (
                    <div className="mt-3 border-t border-[var(--v-border)] pt-3">
                      <MediaPicker
                        activeId={s.backgroundId}
                        onSelect={(id) => patchSlide(s.key, { backgroundId: id })}
                        defaultFit={settings?.mediaDefaults?.fit ?? "cover"}
                        defaultMuted={!(settings?.mediaDefaults?.videoSound ?? false)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <VButton variant="subtle" size="sm" onClick={addSlide}>
              <Plus className="h-4 w-4" /> Add slide
            </VButton>
            {splitNote ? (
              <span className="animate-fade-in inline-flex items-center gap-1.5 rounded-full bg-[var(--v-accent-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--v-accent)]">
                <Sparkles className="h-3 w-3" /> {splitNote}
              </span>
            ) : (
              <span className="text-[11px] text-[var(--v-text-faint)]">
                Paste text with blank lines between paragraphs to get a slide each.
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--v-border)] px-5 py-3">
          <VButton variant="ghost" onClick={() => onClose()}>Cancel</VButton>
          <VButton variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save presentation"}
          </VButton>
        </div>
      </div>
    </div>
  );
}
