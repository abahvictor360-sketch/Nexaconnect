import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Plus, Trash2, GripVertical, ChevronUp, ChevronDown, Palette, Sparkles } from "lucide-react";
import { parsePastedSong } from "../lib/paste-split";
import { RichTextArea } from "./rich-text-area";
import { parseFormats, serializeFormats, type TextAlign } from "../lib/rich-text";
import { api } from "../lib/api";
import { VButton, SectionChip } from "./bits";
import { SECTION_TYPES } from "../lib/sections";
import { useThemes, type FullSongResponse } from "../hooks/use-songs";
import { MediaPicker } from "./media-picker";
import { ColorField } from "./settings-page";

type EditSection = {
  key: string;
  type: string;
  label: string;
  number: number | null;
  lyrics: string;
  /** JSON TextFormat[] over `lyrics`; null = plain text. */
  format: string | null;
  textAlign: string | null;
};

let keyCounter = 0;
const nk = () => `s${keyCounter++}`;

const blankSection = (label: string, number: number | null): EditSection => ({
  key: nk(),
  type: "verse",
  label,
  number,
  lyrics: "",
  format: null,
  textAlign: null,
});

export function SongEditor({
  song,
  onClose,
}: {
  song: FullSongResponse | null; // null = new song
  onClose: (savedId?: string) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [ccli, setCcli] = useState("");
  const [copyright, setCopyright] = useState("");
  const [sections, setSections] = useState<EditSection[]>([]);
  // Per-song look override - null = inherit the app's active theme/background/color.
  const [themeId, setThemeId] = useState<string | null>(null);
  const [backgroundId, setBackgroundId] = useState<string | null>(null);
  const [textColor, setTextColor] = useState<string | null>(null);
  /** Transient confirmation that a paste was broken into sections. */
  const [splitNote, setSplitNote] = useState<string | null>(null);

  useEffect(() => {
    if (!splitNote) return;
    const t = setTimeout(() => setSplitNote(null), 4000);
    return () => clearTimeout(t);
  }, [splitNote]);

  const themes = useThemes();

  useEffect(() => {
    if (song) {
      setTitle(song.song.title);
      setAuthors(song.song.authors ? (JSON.parse(song.song.authors) as string[]).join(", ") : "");
      setCcli(song.song.ccliNumber ?? "");
      setCopyright(song.song.copyright ?? "");
      setThemeId(song.song.themeId ?? null);
      setBackgroundId(song.song.backgroundId ?? null);
      setTextColor(song.song.textColor ?? null);
      setSections(
        song.sections.map((s) => ({
          key: nk(),
          type: s.type,
          label: s.label,
          number: s.number,
          lyrics: s.lyrics,
          format: s.format,
          textAlign: s.textAlign,
        })),
      );
    } else {
      setTitle("");
      setAuthors("");
      setCcli("");
      setCopyright("");
      setThemeId(null);
      setBackgroundId(null);
      setTextColor(null);
      setSections([blankSection("Verse 1", 1)]);
    }
  }, [song]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: title.trim() || "Untitled Song",
        authors: authors.split(",").map((a) => a.trim()).filter(Boolean),
        ccliNumber: ccli.trim() || undefined,
        copyright: copyright.trim() || undefined,
        themeId,
        backgroundId,
        textColor,
        sections: sections.map((s) => ({
          type: s.type,
          label: s.label,
          number: s.number,
          lyrics: s.lyrics,
          format: s.format,
          textAlign: s.textAlign,
        })),
      };
      if (song) {
        await api.songs[":id"].$put({ param: { id: song.song.id }, json: payload });
        return song.song.id;
      }
      const res = await api.songs.$post({ json: payload });
      const data = await res.json();
      return (data as { id: string }).id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["songs"] });
      qc.invalidateQueries({ queryKey: ["song", id] });
      onClose(id);
    },
  });

  const updateSection = (key: string, patch: Partial<EditSection>) =>
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const addSection = () =>
    setSections((prev) => [...prev, blankSection(`Verse ${prev.length + 1}`, null)]);

  const removeSection = (key: string) => setSections((prev) => prev.filter((s) => s.key !== key));

  const move = (idx: number, dir: -1 | 1) => {
    setSections((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const setType = (key: string, type: string) => {
    const def = SECTION_TYPES.find((t) => t.value === type);
    updateSection(key, { type, label: def ? def.label : "Verse" });
  };

  /**
   * Pasting a whole song into one section box is the normal way lyrics arrive,
   * so a paste holding several paragraphs becomes several sections. Headings in
   * the pasted text ("Chorus", "[Verse 2]") are honoured; without them each
   * paragraph is numbered as a verse.
   */
  const pasteAsSections = (key: string, e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text/plain");
    const parsed = parsePastedSong(text);
    if (parsed.length < 2) return; // one section - paste it normally

    e.preventDefault();
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      const target = prev[idx];
      if (idx === -1 || !target) return prev;
      // The section pasted into is only reused when it was empty; if the
      // operator had already typed there, their work stays and the pasted
      // sections follow it.
      const reuse = target.lyrics.trim() === "";
      const made: EditSection[] = parsed.map((p) => ({
        key: nk(),
        ...p,
        // Pasted text arrives plain; it inherits the alignment of the section
        // it was dropped into so a right-aligned block stays right-aligned.
        format: null,
        textAlign: target.textAlign,
      }));
      return reuse
        ? [...prev.slice(0, idx), ...made, ...prev.slice(idx + 1)]
        : [...prev.slice(0, idx + 1), ...made, ...prev.slice(idx + 1)];
    });
    setSplitNote(`Pasted lyrics split into ${parsed.length} sections.`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[var(--v-border)] bg-[var(--v-surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--v-border)] px-5 py-3">
          <h2 className="font-display text-lg font-semibold">{song ? "Edit Song" : "New Song"}</h2>
          <button onClick={() => onClose()} className="text-[var(--v-text-faint)] hover:text-[var(--v-text)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="v-scroll flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="col-span-2 block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--v-text-faint)]">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Song title"
                className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--v-accent)]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--v-text-faint)]">Authors</span>
              <input
                value={authors}
                onChange={(e) => setAuthors(e.target.value)}
                placeholder="Comma separated"
                className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--v-accent)]"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--v-text-faint)]">CCLI #</span>
                <input
                  value={ccli}
                  onChange={(e) => setCcli(e.target.value)}
                  className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--v-accent)]"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--v-text-faint)]">Copyright</span>
                <input
                  value={copyright}
                  onChange={(e) => setCopyright(e.target.value)}
                  className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--v-accent)]"
                />
              </label>
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-2)] p-3.5">
            <p className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--v-text-faint)]">
              <Palette className="h-3.5 w-3.5 text-[var(--v-accent)]" /> This song's own look
            </p>
            <p className="mb-3 text-[11px] text-[var(--v-text-faint)]">
              Optional - leave on "App default" for anything you don't want to override. Handy for a
              song that should always look different from the rest (e.g. a special anthem).
            </p>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Theme</span>
              <select
                value={themeId ?? ""}
                onChange={(e) => setThemeId(e.target.value || null)}
                className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--v-accent)]"
              >
                <option value="">App default</option>
                {(themes.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <div className="mt-3 max-w-[200px]">
              <ColorField label="Text color" value={textColor} fallback="#ffffff" onChange={setTextColor} />
            </div>
            <label className="mt-3 block">
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Background</span>
              <MediaPicker activeId={backgroundId} onSelect={setBackgroundId} />
              <span className="mt-1 block text-[11px] text-[var(--v-text-faint)]">
                Selecting "None" here still means "app default" - this song has no background of its
                own until you pick one.
              </span>
            </label>
          </div>

          <div className="mt-5 mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--v-text-faint)]">Sections</span>
            {splitNote ? (
              <span className="animate-fade-in inline-flex items-center gap-1.5 rounded-full bg-[var(--v-accent-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--v-accent)]">
                <Sparkles className="h-3 w-3" /> {splitNote}
              </span>
            ) : (
              <span className="text-[11px] text-[var(--v-text-faint)]">
                Paste a whole song to split it into sections.
              </span>
            )}
          </div>

          <div className="space-y-3">
            {sections.map((s, idx) => (
              <div key={s.key} className="rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-2)] p-3">
                <div className="mb-2 flex items-center gap-2">
                  <GripVertical className="h-4 w-4 text-[var(--v-text-faint)]" />
                  <select
                    value={s.type}
                    onChange={(e) => setType(s.key, e.target.value)}
                    className="rounded border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2 py-1 text-xs outline-none"
                  >
                    {SECTION_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={s.label}
                    onChange={(e) => updateSection(s.key, { label: e.target.value })}
                    className="w-32 rounded border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2 py-1 text-xs outline-none focus:border-[var(--v-accent)]"
                  />
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => move(idx, -1)} className="rounded p-1 text-[var(--v-text-faint)] hover:bg-[var(--v-surface-3)] hover:text-[var(--v-text)]">
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button onClick={() => move(idx, 1)} className="rounded p-1 text-[var(--v-text-faint)] hover:bg-[var(--v-surface-3)] hover:text-[var(--v-text)]">
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <button onClick={() => removeSection(s.key)} className="rounded p-1 text-[var(--v-text-faint)] hover:bg-[var(--v-live-soft)] hover:text-[var(--v-live)]">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <RichTextArea
                  value={s.lyrics}
                  onChange={(lyrics) => updateSection(s.key, { lyrics })}
                  formats={parseFormats(s.format)}
                  onFormatsChange={(f) => updateSection(s.key, { format: serializeFormats(f) })}
                  align={(s.textAlign as TextAlign | null) ?? null}
                  onAlignChange={(textAlign) => updateSection(s.key, { textAlign })}
                  onPaste={(e) => pasteAsSections(s.key, e)}
                  rows={Math.max(3, s.lyrics.split("\n").length)}
                  placeholder="Lyrics…"
                  className="rounded border border-[var(--v-border)] bg-[var(--v-bg)] focus-within:border-[var(--v-accent)]"
                  textClassName="px-3 py-2 font-lyric text-sm leading-relaxed"
                />
              </div>
            ))}
          </div>

          <VButton variant="ghost" size="sm" className="mt-3" onClick={addSection}>
            <Plus className="h-4 w-4" /> Add section
          </VButton>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--v-border)] px-5 py-3">
          <VButton variant="ghost" onClick={() => onClose()}>
            Cancel
          </VButton>
          <VButton variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save song"}
          </VButton>
        </div>
      </div>
    </div>
  );
}
