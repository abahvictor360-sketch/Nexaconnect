import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Pencil, Check, Highlighter, Eraser, SendHorizontal, Loader2 } from "lucide-react";
import {
  useSermons, useCreateSermon, useUpdateSermon, useDeleteSermon,
  parseHighlights, type Sermon, type SermonHighlight,
} from "../hooks/use-sermons";

/** Highlighter colours. Kept few and distinct so they stay meaningful. */
const COLORS: { id: string; label: string; hex: string }[] = [
  { id: "yellow", label: "Key point", hex: "#facc15" },
  { id: "green", label: "Scripture", hex: "#4ade80" },
  { id: "blue", label: "Illustration", hex: "#60a5fa" },
  { id: "pink", label: "Application", hex: "#f472b6" },
];

/**
 * Splits the body into runs so highlighted spans can be painted without
 * putting markup in the stored text. Overlaps are resolved last-wins by
 * walking sorted ranges and clipping each to where the previous one ended -
 * simpler than merging, and matches what re-highlighting over an existing
 * mark visually implies.
 */
function toRuns(body: string, highlights: SermonHighlight[]) {
  const runs: { text: string; color: string | null; start: number }[] = [];
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const h of sorted) {
    const start = Math.max(cursor, Math.min(h.start, body.length));
    const end = Math.max(start, Math.min(h.end, body.length));
    if (end <= start) continue;
    if (start > cursor) runs.push({ text: body.slice(cursor, start), color: null, start: cursor });
    runs.push({ text: body.slice(start, end), color: h.color, start });
    cursor = end;
  }
  if (cursor < body.length) runs.push({ text: body.slice(cursor), color: null, start: cursor });
  return runs;
}

export function SermonPanel({ onSendLive }: { onSendLive?: (lines: string[], label: string) => void }) {
  const sermons = useSermons();
  const create = useCreateSermon();
  const update = useUpdateSermon();
  const del = useDeleteSermon();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", speaker: "", preachedOn: "", body: "" });
  const [color, setColor] = useState(COLORS[0]!.id);
  const bodyRef = useRef<HTMLDivElement>(null);

  const list = sermons.data ?? [];
  const selected: Sermon | undefined = list.find((s) => s.id === selectedId) ?? list[0];
  const highlights = useMemo(() => parseHighlights(selected?.highlights), [selected?.highlights]);
  const runs = useMemo(
    () => (selected ? toRuns(selected.body, highlights) : []),
    [selected, highlights],
  );

  useEffect(() => {
    if (selected && !selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  const startEdit = () => {
    if (!selected) return;
    setDraft({
      title: selected.title,
      speaker: selected.speaker ?? "",
      preachedOn: selected.preachedOn ?? "",
      body: selected.body,
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!selected) return;
    // Editing the text moves every offset after the edit, so highlights are
    // only safe to keep when the body is untouched. Silently keeping stale
    // offsets would paint colour over the wrong words.
    const bodyChanged = draft.body !== selected.body;
    await update.mutateAsync({
      id: selected.id,
      title: draft.title,
      speaker: draft.speaker,
      preachedOn: draft.preachedOn,
      body: draft.body,
      ...(bodyChanged ? { highlights: [] } : {}),
    });
    setEditing(false);
  };

  /** Turn the current DOM selection into a stored offset range. */
  const highlightSelection = () => {
    if (!selected || !bodyRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!bodyRef.current.contains(range.commonAncestorContainer)) return;

    // Offsets are measured against the container's text, not the clicked node,
    // because the body is split into multiple run elements.
    const pre = range.cloneRange();
    pre.selectNodeContents(bodyRef.current);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    const end = start + range.toString().length;
    if (end <= start) return;

    const hex = COLORS.find((c) => c.id === color)?.hex ?? COLORS[0]!.hex;
    // Drop anything fully covered by the new range so repeated highlighting
    // doesn't accumulate dead entries.
    const kept = highlights.filter((h) => h.end <= start || h.start >= end);
    update.mutate({ id: selected.id, highlights: [...kept, { start, end, color: hex }] });
    sel.removeAllRanges();
  };

  const clearHighlights = () => {
    if (!selected) return;
    update.mutate({ id: selected.id, highlights: [] });
  };

  const sendRun = (text: string) => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length && onSendLive) onSendLive(lines, selected?.title ?? "Sermon");
  };

  return (
    <div className="flex h-full min-h-0">
      {/* List */}
      <div className="flex w-56 shrink-0 flex-col border-r border-[var(--v-border)]">
        <div className="border-b border-[var(--v-border)] p-2">
          <button
            onClick={() =>
              create.mutate(
                { title: "New Sermon" },
                { onSuccess: (s) => { setSelectedId(s.id); setEditing(false); } },
              )
            }
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] py-1.5 text-xs hover:bg-[var(--v-surface)]"
          >
            {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            New sermon
          </button>
        </div>
        <ul className="v-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
          {sermons.isLoading && <li className="p-2 text-[11px] text-[var(--v-text-faint)]">Loading…</li>}
          {!sermons.isLoading && !list.length && (
            <li className="p-2 text-[11px] text-[var(--v-text-faint)]">
              No sermons yet. Add one and paste in the message.
            </li>
          )}
          {list.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => { setSelectedId(s.id); setEditing(false); }}
                className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                  selected?.id === s.id ? "bg-[var(--v-accent-soft)] text-[var(--v-accent)]" : "hover:bg-[var(--v-surface-3)]"
                }`}
              >
                <span className="block truncate font-medium">{s.title}</span>
                <span className="block truncate text-[10px] text-[var(--v-text-faint)]">
                  {[s.speaker, s.preachedOn].filter(Boolean).join(" · ") || "-"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Detail */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <div className="grid flex-1 place-items-center text-sm text-[var(--v-text-faint)]">
            Select or create a sermon
          </div>
        ) : editing ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
            <div className="flex gap-2">
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Sermon title"
                className="min-w-0 flex-1 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--v-accent)]"
              />
              <input
                value={draft.speaker}
                onChange={(e) => setDraft({ ...draft, speaker: e.target.value })}
                placeholder="Speaker"
                className="w-40 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--v-accent)]"
              />
              <input
                value={draft.preachedOn}
                onChange={(e) => setDraft({ ...draft, preachedOn: e.target.value })}
                placeholder="Date / series"
                className="w-36 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--v-accent)]"
              />
            </div>
            <textarea
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              placeholder="Paste or type the sermon here…"
              className="v-scroll min-h-0 flex-1 resize-none rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] p-3 font-mono text-[13px] leading-relaxed outline-none focus:border-[var(--v-accent)]"
            />
            {draft.body !== selected.body && highlights.length > 0 && (
              <p className="text-[11px] text-amber-500">
                Editing the text clears its {highlights.length} highlight{highlights.length === 1 ? "" : "s"} -
                colours are tied to character positions, which shift as you type.
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={saveEdit}
                disabled={update.isPending}
                className="flex items-center gap-1.5 rounded-md border border-[var(--v-accent)] bg-[var(--v-accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--v-accent)] disabled:opacity-50"
              >
                {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Save
              </button>
              <button
                onClick={() => setEditing(false)}
                className="rounded-md border border-[var(--v-border)] px-3 py-1.5 text-xs hover:bg-[var(--v-surface-3)]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-[var(--v-border)] p-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">{selected.title}</h2>
                <p className="truncate text-[11px] text-[var(--v-text-faint)]">
                  {[selected.speaker, selected.preachedOn].filter(Boolean).join(" · ") || "No speaker or date set"}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  onClick={startEdit}
                  className="flex items-center gap-1.5 rounded-md border border-[var(--v-border)] px-2.5 py-1.5 text-[11px] hover:bg-[var(--v-surface-3)]"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button
                  onClick={() => {
                    del.mutate(selected.id);
                    setSelectedId(null);
                  }}
                  aria-label={`Delete ${selected.title}`}
                  className="rounded-md border border-[var(--v-border)] px-2 py-1.5 text-[var(--v-text-faint)] hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Highlighter toolbar */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--v-border)] px-3 py-2">
              {COLORS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setColor(c.id)}
                  title={c.label}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                    color === c.id ? "border-[var(--v-accent)]" : "border-[var(--v-border)] hover:bg-[var(--v-surface-3)]"
                  }`}
                >
                  <span className="h-3 w-3 rounded-sm" style={{ background: c.hex }} />
                  {c.label}
                </button>
              ))}
              <button
                onClick={highlightSelection}
                className="ml-auto flex items-center gap-1.5 rounded-md border border-[var(--v-border)] px-2.5 py-1 text-[11px] hover:bg-[var(--v-surface-3)]"
              >
                <Highlighter className="h-3.5 w-3.5" /> Highlight selection
              </button>
              <button
                onClick={clearHighlights}
                disabled={!highlights.length}
                className="flex items-center gap-1.5 rounded-md border border-[var(--v-border)] px-2.5 py-1 text-[11px] hover:bg-[var(--v-surface-3)] disabled:opacity-40"
              >
                <Eraser className="h-3.5 w-3.5" /> Clear
              </button>
            </div>

            {/* Body */}
            {!selected.body.trim() ? (
              <div className="grid flex-1 place-items-center p-6 text-center text-sm text-[var(--v-text-faint)]">
                This sermon is empty - press Edit and paste the message in.
              </div>
            ) : (
              <div
                ref={bodyRef}
                className="v-scroll min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap p-4 text-[13px] leading-relaxed"
              >
                {runs.map((r, i) =>
                  r.color ? (
                    <mark
                      key={`${r.start}-${i}`}
                      onDoubleClick={() => sendRun(r.text)}
                      title="Double-click to send this to the screen"
                      style={{ background: r.color, color: "#111", borderRadius: 3, padding: "0 2px", cursor: onSendLive ? "pointer" : "text" }}
                    >
                      {r.text}
                    </mark>
                  ) : (
                    <span key={`${r.start}-${i}`}>{r.text}</span>
                  ),
                )}
              </div>
            )}

            <p className="flex items-center gap-1.5 border-t border-[var(--v-border)] px-3 py-1.5 text-[10px] text-[var(--v-text-faint)]">
              <SendHorizontal className="h-3 w-3" />
              Select text and press Highlight. Double-click a highlight to put it on the screen.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
