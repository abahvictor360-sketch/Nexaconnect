import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Monitor, Search, Type } from "lucide-react";

/**
 * Searchable font picker.
 * Sources, in order:
 *  1. Curated app fonts (bundled web fonts + fonts on virtually every machine)
 *  2. Every font installed on the user's system, via the Local Font Access
 *     API (window.queryLocalFonts - Chromium/Electron). Loaded lazily on the
 *     first open because the API needs a user gesture; browsers may also show
 *     a one-time permission prompt. Falls back silently to the curated list.
 *
 * Value is a CSS font-family string ("" = inherit / theme default).
 */

type FontOption = { label: string; value: string; system?: boolean };

export const CURATED_FONTS: FontOption[] = [
  { label: "Archivo (default)", value: "" },
  { label: "Sora", value: '"Sora", system-ui, sans-serif' },
  { label: "IBM Plex Sans", value: '"IBM Plex Sans", system-ui, sans-serif' },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Arial Black", value: '"Arial Black", Arial, sans-serif' },
  { label: "Bahnschrift", value: "Bahnschrift, 'DIN Alternate', sans-serif" },
  { label: "Book Antiqua", value: '"Book Antiqua", Palatino, serif' },
  { label: "Calibri", value: "Calibri, 'Segoe UI', sans-serif" },
  { label: "Cambria", value: "Cambria, Georgia, serif" },
  { label: "Candara", value: "Candara, 'Segoe UI', sans-serif" },
  { label: "Century Gothic", value: '"Century Gothic", "Apple Gothic", sans-serif' },
  { label: "Comic Sans MS", value: '"Comic Sans MS", cursive' },
  { label: "Consolas", value: "Consolas, Monaco, monospace" },
  { label: "Constantia", value: "Constantia, Georgia, serif" },
  { label: "Corbel", value: "Corbel, 'Segoe UI', sans-serif" },
  { label: "Courier New", value: '"Courier New", Courier, monospace' },
  { label: "Franklin Gothic", value: '"Franklin Gothic Medium", "Arial Narrow", sans-serif' },
  { label: "Garamond", value: "Garamond, 'Times New Roman', serif" },
  { label: "Georgia", value: 'Georgia, "Times New Roman", serif' },
  { label: "Gill Sans", value: '"Gill Sans", "Gill Sans MT", sans-serif' },
  { label: "Impact", value: 'Impact, "Arial Black", sans-serif' },
  { label: "Lucida Console", value: '"Lucida Console", Monaco, monospace' },
  { label: "Lucida Sans", value: '"Lucida Sans", "Lucida Grande", sans-serif' },
  { label: "Palatino Linotype", value: '"Palatino Linotype", Palatino, serif' },
  { label: "Rockwell", value: "Rockwell, 'Courier Bold', serif" },
  { label: "Segoe UI", value: '"Segoe UI", system-ui, sans-serif' },
  { label: "Segoe UI Black", value: '"Segoe UI Black", "Segoe UI", sans-serif' },
  { label: "Sitka Heading", value: '"Sitka Heading", Georgia, serif' },
  { label: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
  { label: "Times New Roman", value: '"Times New Roman", Times, serif' },
  { label: "Trebuchet MS", value: '"Trebuchet MS", "Lucida Grande", sans-serif' },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
];

/** Cached across pickers so the (possibly permission-gated) query runs once. */
let systemFontsCache: FontOption[] | null = null;

async function loadSystemFonts(): Promise<FontOption[]> {
  if (systemFontsCache) return systemFontsCache;
  try {
    const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
    if (!query) return (systemFontsCache = []);
    const fonts = await query.call(window);
    const families = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
    const curatedLabels = new Set(CURATED_FONTS.map((f) => f.label.toLowerCase()));
    systemFontsCache = families
      .filter((f) => !curatedLabels.has(f.toLowerCase()))
      .map((f) => ({ label: f, value: `"${f}", sans-serif`, system: true }));
    return systemFontsCache;
  } catch {
    // Permission denied or API unavailable - the curated list still works.
    return (systemFontsCache = []);
  }
}

export function FontPicker({
  value,
  onChange,
}: {
  /** CSS font-family string; "" or null = theme default. */
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [systemFonts, setSystemFonts] = useState<FontOption[]>(systemFontsCache ?? []);
  const [loadingSystem, setLoadingSystem] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const all = useMemo(() => [...CURATED_FONTS, ...systemFonts], [systemFonts]);
  const current = all.find((f) => (f.value || "") === (value ?? "")) ?? null;
  // A saved system font may not be in the list yet (fonts not loaded this session).
  const currentLabel = current?.label ?? (value ? value.split(",")[0].replace(/"/g, "") : "Theme default");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((f) => f.label.toLowerCase().includes(needle));
  }, [all, q]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    // Fetch system fonts on first open - the click that opened us satisfies
    // the user-gesture requirement of queryLocalFonts.
    if (systemFontsCache === null) {
      setLoadingSystem(true);
      loadSystemFonts().then((f) => {
        setSystemFonts(f);
        setLoadingSystem(false);
      });
    }
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const pick = (f: FontOption) => {
    onChange(f.value || null);
    setOpen(false);
    setQ("");
  };

  const curatedMatches = filtered.filter((f) => !f.system);
  const systemMatches = filtered.filter((f) => f.system);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2 py-2 text-left text-sm outline-none focus:border-[var(--v-accent)]"
      >
        <span className="truncate" style={{ fontFamily: value || undefined }}>{currentLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--v-text-faint)]" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 overflow-hidden rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-2)] shadow-2xl">
          <div className="relative border-b border-[var(--v-border)] p-1.5">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--v-text-faint)]" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search fonts…"
              className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] py-1.5 pl-8 pr-2 text-sm outline-none focus:border-[var(--v-accent)]"
            />
          </div>
          <div className="v-scroll max-h-64 overflow-y-auto p-1">
            {curatedMatches.length > 0 && (
              <p className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-[9px] uppercase tracking-wider text-[var(--v-text-faint)]">
                <Type className="h-3 w-3" /> App fonts
              </p>
            )}
            {curatedMatches.map((f) => (
              <FontRow key={f.label} font={f} selected={(f.value || "") === (value ?? "")} onPick={pick} />
            ))}
            {(systemMatches.length > 0 || loadingSystem) && (
              <p className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[9px] uppercase tracking-wider text-[var(--v-text-faint)]">
                <Monitor className="h-3 w-3" /> Your system fonts
                {loadingSystem && <span className="normal-case tracking-normal">· loading…</span>}
              </p>
            )}
            {systemMatches.map((f) => (
              <FontRow key={f.label} font={f} selected={(f.value || "") === (value ?? "")} onPick={pick} />
            ))}
            {!loadingSystem && filtered.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-[var(--v-text-faint)]">No fonts match “{q}”.</p>
            )}
            {!loadingSystem && systemFontsCache !== null && systemFontsCache.length === 0 && !q && (
              <p className="px-2 py-2 text-[10px] text-[var(--v-text-faint)]">
                System fonts unavailable here - the desktop app lists every font installed on this computer.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FontRow({
  font,
  selected,
  onPick,
}: {
  font: FontOption;
  selected: boolean;
  onPick: (f: FontOption) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(font)}
      className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
        selected ? "bg-[var(--v-accent-soft)] text-[var(--v-accent)]" : "text-[var(--v-text)] hover:bg-[var(--v-surface-3)]"
      }`}
    >
      <span className="truncate" style={{ fontFamily: font.value || undefined }}>{font.label}</span>
      {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
    </button>
  );
}
