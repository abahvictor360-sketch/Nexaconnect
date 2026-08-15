import { useEffect, useState } from "react";
import {
  X, Music4, BookOpen, Settings2, Image as ImageIcon,
  Film, Palette, Link2, Monitor, Ear, Type, LayoutList, Languages,
  Info, Github, Mail, Heart, Megaphone, MonitorPlay, Rocket, Loader2, Radio, Lock, Keyboard,
} from "lucide-react";
import {
  SHORTCUT_ACTIONS, comboFromEvent, conflictsFor, formatCombo, resolveShortcuts,
  type ShortcutAction,
} from "../lib/shortcuts";
import { VButton } from "./bits";
import { FontPicker } from "./font-picker";
import { SlideRender } from "./slide-render";
import { hexToRgba } from "./announcement-ticker";
import { MediaPicker } from "./media-picker";
import type { AppSettings, ThemeOverride } from "../hooks/use-settings";
import { LANGS } from "../hooks/use-translations";
import type { LiveState, LiveTheme } from "../lib/live-bus";
import type { useDesktop } from "../hooks/use-desktop";
import { useNetworkOrigin } from "../hooks/use-network-origin";
import type { DisplayInfo } from "../lib/desktop";
import { teleportToObs } from "../lib/obs";
import { sendToVmix } from "../lib/vmix";

/**
 * Full app settings — side-nav layout. All display configuration lives here:
 *   Lyrics  → theme, background, font, size, alignment, lines per slide, dual language
 *   Bible   → language packs + Bible-only display overrides
 *   General → output display, auto-follow, output links
 */

type SectionId = "lyrics" | "bible" | "presentations" | "general";

const SECTIONS: { id: SectionId; label: string; icon: typeof Music4; hint: string }[] = [
  { id: "lyrics", label: "Lyrics", icon: Music4, hint: "Theme, background & fonts" },
  { id: "bible", label: "Bible", icon: BookOpen, hint: "Versions & scripture look" },
  { id: "presentations", label: "Presentations", icon: MonitorPlay, hint: "Slide look & media defaults" },
  { id: "general", label: "General", icon: Settings2, hint: "Output & app behavior" },
];

/** Languages offered for AI auto-follow transcription (Deepgram codes). */
export const AUTOFOLLOW_LANGS: { code: string; label: string }[] = [
  { code: "multi", label: "Multi (auto-detect)" },
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "pt", label: "Portuguese" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "sw", label: "Swahili" },
  { code: "hi", label: "Hindi" },
  { code: "id", label: "Indonesian" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
];

/** Human label for the auto-follow match threshold (lower threshold = keener). */
function sensitivityLabel(threshold: number): string {
  if (threshold <= 0.25) return "High";
  if (threshold >= 0.45) return "Low";
  return "Medium";
}

function sampleState(theme: LiveTheme, lines: string[], caption = ""): LiveState {
  return {
    status: "live",
    sourceLines: lines,
    translationLines: [],
    sectionLabel: caption,
    songTitle: "",
    slideId: null,
    slideIndex: 0,
    slideCount: 1,
    theme,
    rev: 0,
  };
}

export function SettingsPage({
  onClose,
  settings,
  patchSettings,
  themes,
  desktop,
  lyricPreviewTheme,
  biblePreviewTheme,
  presentationPreviewTheme,
  autoFollowStatus = "off",
  autoFollowHeard = "",
}: {
  onClose: () => void;
  settings: AppSettings | undefined;
  patchSettings: (p: Partial<AppSettings>) => void;
  themes: { id: string; name: string }[];
  desktop: ReturnType<typeof useDesktop>;
  /** Fully merged lyric theme (theme + overrides + background) for previews. */
  lyricPreviewTheme: LiveTheme;
  /** Fully merged Bible theme for previews. */
  biblePreviewTheme: LiveTheme;
  /** Fully merged presentation theme for previews. */
  presentationPreviewTheme: LiveTheme;
  /** Live auto-follow status/heard-text, surfaced in the General tab. */
  autoFollowStatus?: string;
  autoFollowHeard?: string;
}) {
  const [section, setSection] = useState<SectionId>("lyrics");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-8">
      <div className="flex h-full w-full max-w-5xl overflow-hidden rounded-2xl border border-[var(--v-border)] bg-[var(--v-surface)] shadow-2xl">
        {/* Side nav */}
        <nav className="flex w-52 shrink-0 flex-col border-r border-[var(--v-border)] bg-[var(--v-surface-2)]">
          <div className="flex items-center gap-2 px-4 py-4">
            <Settings2 className="h-4 w-4 text-[var(--v-accent)]" />
            <span className="font-display text-sm font-bold tracking-tight">Settings</span>
          </div>
          <div className="flex flex-col gap-0.5 px-2">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const active = section === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    active
                      ? "bg-[var(--v-accent-soft)] text-[var(--v-accent)]"
                      : "text-[var(--v-text-dim)] hover:bg-[var(--v-surface-3)] hover:text-[var(--v-text)]"
                  }`}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{s.label}</span>
                    <span className={`block truncate text-[10px] ${active ? "text-[var(--v-accent)]/70" : "text-[var(--v-text-faint)]"}`}>
                      {s.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-auto px-4 py-3 text-[10px] text-[var(--v-text-faint)]">
            Changes apply instantly.
          </div>
        </nav>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-[var(--v-border)] px-6 py-3.5">
            <h2 className="font-display text-lg font-semibold capitalize">{section === "general" ? "General" : section}</h2>
            <button onClick={onClose} className="rounded-md p-1 text-[var(--v-text-faint)] hover:bg-[var(--v-surface-3)] hover:text-[var(--v-text)]">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="v-scroll min-h-0 flex-1 overflow-y-auto p-6">
            {section === "lyrics" && (
              <LyricsSection
                settings={settings}
                patchSettings={patchSettings}
                themes={themes}
                previewTheme={lyricPreviewTheme}
              />
            )}
            {section === "bible" && (
              <BibleSection settings={settings} patchSettings={patchSettings} previewTheme={biblePreviewTheme} />
            )}
            {section === "presentations" && (
              <PresentationsSection settings={settings} patchSettings={patchSettings} previewTheme={presentationPreviewTheme} />
            )}
            {section === "general" && (
              <GeneralSection
                settings={settings}
                patchSettings={patchSettings}
                desktop={desktop}
                autoFollowStatus={autoFollowStatus}
                autoFollowHeard={autoFollowHeard}
              />
            )}
          </div>

          <div className="flex justify-end border-t border-[var(--v-border)] px-6 py-3">
            <VButton variant="primary" onClick={onClose}>Done</VButton>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- shared bits ---------------- */

// Grouped panel styled after classic presentation-software settings: a titled
// header bar sitting on top of a bordered content panel.
function Group({ title, icon: Icon, children }: { title: string; icon?: typeof Music4; children: React.ReactNode }) {
  return (
    <section className="mb-5 overflow-hidden rounded-xl border border-[var(--v-border)] bg-[var(--v-surface-2)] shadow-sm">
      <div className="flex items-center gap-2 border-b border-[var(--v-border)] bg-[var(--v-surface-3)] px-4 py-2.5">
        {Icon && <Icon className="h-4 w-4 text-[var(--v-accent)]" />}
        <h3 className="text-sm font-semibold tracking-tight text-[var(--v-accent)]">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function PreviewStrip({ theme, lines, caption }: { theme: LiveTheme; lines: string[]; caption?: string }) {
  return (
    <div className="relative mb-6 aspect-[21/6] w-full overflow-hidden rounded-xl border border-[var(--v-border)]" style={{ background: "#000" }}>
      <SlideRender state={sampleState(theme, lines, caption)} scale />
      <span className="absolute right-2 top-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white/60">
        Live preview
      </span>
    </div>
  );
}

/**
 * Shared look-and-feel editor for a ThemeOverride (used by Lyrics and Bible).
 * undefined = inherit; null fontSize = auto-fit.
 */
function OverrideEditor({
  value,
  onChange,
  inheritLabel,
}: {
  value: ThemeOverride | null | undefined;
  onChange: (next: ThemeOverride) => void;
  inheritLabel: string;
}) {
  const o = value ?? {};
  const set = (patch: ThemeOverride) => onChange({ ...o, ...patch });
  const isLowerThird = o.displayMode === "lower_third" || o.displayMode === "lower_third_bg";

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Display mode</span>
        <div className="flex gap-1.5">
          {([
            { v: "fullscreen", l: "Fullscreen" },
            { v: "lower_third", l: "Lower third" },
            { v: "lower_third_bg", l: "Lower third + bar" },
          ] as const).map((m) => (
            <button
              key={m.v}
              onClick={() =>
                set(
                  o.displayMode === m.v
                    ? { displayMode: undefined } // back to inherit
                    : {
                        displayMode: m.v,
                        // default the classic broadcast position when entering lower third
                        ...(m.v !== "fullscreen" && !o.verticalPos ? { verticalPos: "bottom" } : {}),
                      },
                )
              }
              className={`flex-1 rounded-md border py-2 text-xs transition-colors ${
                o.displayMode === m.v
                  ? "border-[var(--v-accent)] bg-[var(--v-accent-soft)] text-[var(--v-accent)]"
                  : "border-[var(--v-border)] bg-[var(--v-surface-3)] text-[var(--v-text-dim)] hover:text-[var(--v-text)]"
              }`}
            >
              {m.l}
            </button>
          ))}
        </div>
        {!o.displayMode && (
          <span className="mt-1 block text-[10px] text-[var(--v-text-faint)]">{inheritLabel}. Pick one to override.</span>
        )}
      </label>

      {isLowerThird && (
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Lower third position</span>
          <div className="flex gap-1.5">
            {([
              { v: "top", l: "Top" },
              { v: "center", l: "Middle" },
              { v: "bottom", l: "Bottom" },
            ] as const).map((p) => (
              <button
                key={p.v}
                onClick={() => set({ verticalPos: p.v })}
                className={`flex-1 rounded-md border py-2 text-xs transition-colors ${
                  (o.verticalPos ?? "bottom") === p.v
                    ? "border-[var(--v-accent)] bg-[var(--v-accent-soft)] text-[var(--v-accent)]"
                    : "border-[var(--v-border)] bg-[var(--v-surface-3)] text-[var(--v-text-dim)] hover:text-[var(--v-text)]"
                }`}
              >
                {p.l}
              </button>
            ))}
          </div>
        </label>
      )}

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Font</span>
          <FontPicker value={o.fontFamily ?? null} onChange={(v) => set({ fontFamily: v })} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Font size (px)</span>
          <input
            type="number"
            min={0}
            placeholder="auto"
            value={o.fontSize ?? ""}
            onChange={(e) => set({ fontSize: e.target.value ? Number(e.target.value) : null })}
            className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2 py-2 text-sm outline-none focus:border-[var(--v-accent)]"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Font weight</span>
          <select
            value={o.fontWeight ?? ""}
            onChange={(e) => set({ fontWeight: e.target.value ? Number(e.target.value) : undefined })}
            className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-2 py-2 text-sm outline-none focus:border-[var(--v-accent)]"
          >
            <option value="">{inheritLabel}</option>
            {[400, 500, 600, 700, 800].map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Alignment</span>
          <div className="flex gap-1.5">
            {(["left", "center", "right"] as const).map((a) => (
              <button
                key={a}
                onClick={() => set({ textAlign: o.textAlign === a ? undefined : a })}
                className={`flex-1 rounded-md border py-2 text-xs capitalize transition-colors ${
                  o.textAlign === a
                    ? "border-[var(--v-accent)] bg-[var(--v-accent-soft)] text-[var(--v-accent)]"
                    : "border-[var(--v-border)] bg-[var(--v-surface-3)] text-[var(--v-text-dim)] hover:text-[var(--v-text)]"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ColorField
          label="Text color"
          value={o.textColor ?? null}
          fallback="#ffffff"
          onChange={(v) => set({ textColor: v })}
        />
        <ColorField
          label="Background color"
          value={o.bgColor ?? null}
          fallback="#0a0a0c"
          onChange={(v) => set({ bgColor: v })}
        />
      </div>

      {/* Text shadow — a soft drop shadow for legibility over busy backgrounds */}
      <div className="border-t border-[var(--v-border)] pt-4">
        <label className="flex items-center justify-between">
          <span className="text-sm">Text shadow</span>
          <Toggle
            checked={!!o.textShadow}
            onChange={(on) => set({ textShadow: on ? { color: "#000000", blur: 6, x: 2, y: 2 } : null })}
          />
        </label>
        <p className="mt-1 text-[11px] text-[var(--v-text-faint)]">
          A soft drop shadow behind the text — helps readability over photo / video backgrounds.
        </p>
        {o.textShadow && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Shadow color</span>
                <input
                  type="color"
                  value={o.textShadow.color}
                  onChange={(e) => set({ textShadow: { ...o.textShadow!, color: e.target.value } })}
                  className="h-9 w-full cursor-pointer rounded-md border border-[var(--v-border)] bg-transparent"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Blur · {o.textShadow.blur}px</span>
                <input
                  type="range" min={0} max={40} value={o.textShadow.blur}
                  onChange={(e) => set({ textShadow: { ...o.textShadow!, blur: Number(e.target.value) } })}
                  className="mt-2.5 w-full accent-[var(--v-accent)]"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Offset X · {o.textShadow.x}px</span>
                <input
                  type="range" min={-30} max={30} value={o.textShadow.x}
                  onChange={(e) => set({ textShadow: { ...o.textShadow!, x: Number(e.target.value) } })}
                  className="mt-2.5 w-full accent-[var(--v-accent)]"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Offset Y · {o.textShadow.y}px</span>
                <input
                  type="range" min={-30} max={30} value={o.textShadow.y}
                  onChange={(e) => set({ textShadow: { ...o.textShadow!, y: Number(e.target.value) } })}
                  className="mt-2.5 w-full accent-[var(--v-accent)]"
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ColorField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string | null;
  fallback: string;
  onChange: (v: string | null) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value ?? fallback}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded-md border border-[var(--v-border)] bg-transparent"
        />
        <span className="text-xs text-[var(--v-text-dim)]">{value ?? "inherit"}</span>
        {value && (
          <button onClick={() => onChange(null)} className="ml-auto text-[10px] text-[var(--v-text-faint)] underline-offset-2 hover:text-[var(--v-text)] hover:underline">
            reset
          </button>
        )}
      </div>
    </label>
  );
}

/* ---------------- Lyrics ---------------- */

function LyricsSection({
  settings,
  patchSettings,
  themes,
  previewTheme,
}: {
  settings: AppSettings | undefined;
  patchSettings: (p: Partial<AppSettings>) => void;
  themes: { id: string; name: string }[];
  previewTheme: LiveTheme;
}) {
  const linesPerSlide = settings?.linesPerSlide ?? 2;
  return (
    <div>
      <PreviewStrip theme={previewTheme} lines={["Amazing grace, how sweet the sound", "That saved a wretch like me"]} />

      <Group title="Theme" icon={Palette}>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Base theme</span>
          <select
            value={settings?.activeThemeId ?? ""}
            onChange={(e) => patchSettings({ activeThemeId: e.target.value || null })}
            className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--v-accent)]"
          >
            {themes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
      </Group>

      <Group title="Look & feel" icon={Type}>
        <OverrideEditor
          value={settings?.lyricTheme}
          onChange={(next) => patchSettings({ lyricTheme: next })}
          inheritLabel="Theme default"
        />
      </Group>

      <Group title="Background" icon={ImageIcon}>
        <MediaPicker
          activeId={settings?.activeBackgroundId ?? null}
          onSelect={(id) => patchSettings({ activeBackgroundId: id })}
          defaultFit={settings?.mediaDefaults?.fit ?? "cover"}
          defaultMuted={!(settings?.mediaDefaults?.videoSound ?? false)}
        />
      </Group>

      <Group title="Slides" icon={LayoutList}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm">Lines per slide</span>
          <span className="rounded bg-[var(--v-accent-soft)] px-1.5 py-0.5 text-xs font-semibold text-[var(--v-accent)]">
            {linesPerSlide}
          </span>
        </div>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              onClick={() => patchSettings({ linesPerSlide: n })}
              className={`flex-1 rounded-md border py-1.5 text-sm font-medium transition-colors ${
                linesPerSlide === n
                  ? "border-[var(--v-accent)] bg-[var(--v-accent-soft)] text-[var(--v-accent)]"
                  : "border-[var(--v-border)] bg-[var(--v-surface-3)] text-[var(--v-text-dim)] hover:text-[var(--v-text)]"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </Group>

      <Group title="Dual language" icon={Languages}>
        <label className="flex items-center justify-between">
          <span className="text-sm">Show a translation line under the lyrics</span>
          <Toggle
            checked={settings?.dualLanguage ?? false}
            onChange={(v) => patchSettings({ dualLanguage: v })}
          />
        </label>
        {settings?.dualLanguage && (
          <label className="mt-3 block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Secondary language</span>
            <select
              value={settings?.secondaryLang ?? ""}
              onChange={(e) => patchSettings({ secondaryLang: e.target.value || null })}
              className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--v-accent)]"
            >
              <option value="">— none —</option>
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-[var(--v-text-faint)]">
              Add translations per section from the song's <b>Translate</b> panel.
            </span>
            <div className="mt-3 max-w-[180px]">
              <ColorField
                label="Translation text color"
                value={settings?.lyricTheme?.translationColor ?? null}
                fallback="#ffffff"
                onChange={(v) => patchSettings({ lyricTheme: { ...(settings?.lyricTheme ?? {}), translationColor: v } })}
              />
            </div>
          </label>
        )}
      </Group>
    </div>
  );
}

/* ---------------- Bible ---------------- */

const BIBLE_LANG_PACKS: { key: "yor" | "hau" | "ibo"; label: string }[] = [
  { key: "yor", label: "Yoruba" },
  { key: "hau", label: "Hausa" },
  { key: "ibo", label: "Igbo" },
];

function BibleSection({
  settings,
  patchSettings,
  previewTheme,
}: {
  settings: AppSettings | undefined;
  patchSettings: (p: Partial<AppSettings>) => void;
  previewTheme: LiveTheme;
}) {
  const langs = settings?.bibleLangs ?? { yor: true, hau: true, ibo: true };
  const bt = settings?.bibleTheme ?? null;
  const overridesOn = !!bt;

  return (
    <div>
      <PreviewStrip
        theme={{ ...previewTheme, showCaption: true }}
        lines={["For God so loved the world, that he gave his only begotten Son"]}
        caption="John 3:16 · KJV"
      />

      <Group title="Bible versions" icon={BookOpen}>
        <p className="mb-3 text-[11px] text-[var(--v-text-faint)]">
          30 English versions (KJV, NIV, NKJV, ESV, NLT, NASB, Amplified and more) are always available — switch between them from the version dropdown in the Bible tab. Toggle the extra language packs below.
        </p>
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm">English (30 versions)</span>
            <span className="rounded-md bg-[var(--v-surface-3)] px-2 py-0.5 text-[10px] font-medium uppercase text-[var(--v-text-faint)]">
              Always on
            </span>
          </div>
          {BIBLE_LANG_PACKS.map((p) => (
            <label key={p.key} className="flex items-center justify-between">
              <span className="text-sm">{p.label}</span>
              <Toggle
                checked={langs[p.key] !== false}
                onChange={(v) => patchSettings({ bibleLangs: { ...langs, [p.key]: v } })}
              />
            </label>
          ))}
        </div>
      </Group>

      <Group title="Reference & verse colors" icon={Palette}>
        <p className="mb-3 text-[11px] text-[var(--v-text-faint)]">
          The scripture reference (e.g. "John 3:16") is shown above the verse on the projector and stream.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <ColorField
            label="Reference color"
            value={bt?.referenceColor ?? null}
            fallback="#a3e635"
            onChange={(v) => patchSettings({ bibleTheme: { ...(bt ?? {}), referenceColor: v } })}
          />
          <ColorField
            label="Verse text color"
            value={bt?.textColor ?? null}
            fallback="#ffffff"
            onChange={(v) => patchSettings({ bibleTheme: { ...(bt ?? {}), textColor: v } })}
          />
        </div>
      </Group>

      <Group title="Scripture look" icon={Type}>
        <label className="flex items-center justify-between">
          <span className="text-sm">Override the lyric look for Bible verses</span>
          <Toggle
            checked={overridesOn}
            onChange={(v) => patchSettings({ bibleTheme: v ? { textAlign: "center" } : null })}
          />
        </label>
        <p className="mt-1 text-[11px] text-[var(--v-text-faint)]">
          Off = scripture uses the same theme, background and font as lyrics.
        </p>
        {overridesOn && (
          <div className="mt-4 border-t border-[var(--v-border)] pt-4">
            <OverrideEditor
              value={bt}
              onChange={(next) => patchSettings({ bibleTheme: next })}
              inheritLabel="Same as lyrics"
            />
          </div>
        )}
      </Group>

      <Group title="Scripture background" icon={ImageIcon}>
        <label className="flex items-center justify-between">
          <span className="text-sm">Use a different background for Bible verses</span>
          <Toggle
            checked={settings?.bibleBackgroundId !== undefined}
            onChange={(v) => patchSettings({ bibleBackgroundId: v ? null : undefined })}
          />
        </label>
        <p className="mt-1 text-[11px] text-[var(--v-text-faint)]">
          Off = scripture shares the lyric background. On = pick a scripture-only background below ("None" = plain theme color).
        </p>
        {settings?.bibleBackgroundId !== undefined && (
          <div className="mt-4 border-t border-[var(--v-border)] pt-4">
            <MediaPicker
              activeId={settings?.bibleBackgroundId ?? null}
              onSelect={(id) => patchSettings({ bibleBackgroundId: id })}
              defaultFit={settings?.mediaDefaults?.fit ?? "cover"}
              defaultMuted={!(settings?.mediaDefaults?.videoSound ?? false)}
            />
          </div>
        )}
      </Group>
    </div>
  );
}

/* ---------------- Presentations ---------------- */

function PresentationsSection({
  settings,
  patchSettings,
  previewTheme,
}: {
  settings: AppSettings | undefined;
  patchSettings: (p: Partial<AppSettings>) => void;
  previewTheme: LiveTheme;
}) {
  const pt = settings?.presentationTheme ?? null;
  const overridesOn = !!pt;
  const md = settings?.mediaDefaults ?? { fit: "cover" as const, videoSound: false };

  return (
    <div>
      <PreviewStrip theme={previewTheme} lines={["Welcome to Sunday Service", "All are welcome"]} />

      <Group title="About Presentations" icon={MonitorPlay}>
        <p className="text-sm text-[var(--v-text-dim)]">
          Build slide decks in-app or import a PowerPoint (.pptx) — each slide can show a heading,
          body text, or just a full-screen image or video. Open the <b>Presentations</b> tab on the
          operator screen to create, import and cue them live.
        </p>
      </Group>

      <Group title="Slide look" icon={Type}>
        <label className="flex items-center justify-between">
          <span className="text-sm">Override the lyric look for presentation slides</span>
          <Toggle
            checked={overridesOn}
            onChange={(v) => patchSettings({ presentationTheme: v ? { textAlign: "center" } : null })}
          />
        </label>
        <p className="mt-1 text-[11px] text-[var(--v-text-faint)]">
          Off = presentation text uses the same theme, font and colors as lyrics. Each slide's own
          background/image always shows regardless of this setting.
        </p>
        {overridesOn && (
          <div className="mt-4 border-t border-[var(--v-border)] pt-4">
            <OverrideEditor
              value={pt}
              onChange={(next) => patchSettings({ presentationTheme: next })}
              inheritLabel="Same as lyrics"
            />
          </div>
        )}
      </Group>

      <Group title="Image & video defaults" icon={Film}>
        <p className="mb-3 text-[11px] text-[var(--v-text-faint)]">
          Applied when you add a new background, image or video anywhere in the app — existing
          items keep their own setting (toggle sound per item from its thumbnail).
        </p>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">
            How images/video fill the screen
          </span>
          <div className="flex gap-1.5">
            {(["cover", "contain", "fill"] as const).map((f) => (
              <button
                key={f}
                onClick={() => patchSettings({ mediaDefaults: { ...md, fit: f } })}
                className={`flex-1 rounded-md border py-2 text-xs capitalize transition-colors ${
                  md.fit === f
                    ? "border-[var(--v-accent)] bg-[var(--v-accent-soft)] text-[var(--v-accent)]"
                    : "border-[var(--v-border)] bg-[var(--v-surface-3)] text-[var(--v-text-dim)] hover:text-[var(--v-text)]"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <span className="mt-1 block text-[11px] text-[var(--v-text-faint)]">
            Cover = fills the screen (may crop edges) · Contain = shows the whole image/video · Fill = stretches to fit.
          </span>
        </label>

        <label className="mt-4 flex items-center justify-between">
          <span className="text-sm">New videos play with sound</span>
          <Toggle
            checked={md.videoSound}
            onChange={(v) => patchSettings({ mediaDefaults: { ...md, videoSound: v } })}
          />
        </label>
        <p className="mt-1 text-[11px] text-[var(--v-text-faint)]">
          Off = new videos are silent by default (good for backgrounds behind lyrics). On = new
          videos play with audio (good for a standalone announcement or testimony video).
        </p>
      </Group>
    </div>
  );
}

/* ---------------- General ---------------- */

function GeneralSection({
  settings,
  patchSettings,
  desktop,
  autoFollowStatus,
  autoFollowHeard,
}: {
  settings: AppSettings | undefined;
  patchSettings: (p: Partial<AppSettings>) => void;
  desktop: ReturnType<typeof useDesktop>;
  autoFollowStatus: string;
  autoFollowHeard: string;
}) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  useEffect(() => {
    if (!desktop) return;
    desktop.listDisplays().then(setDisplays).catch(() => {});
  }, [desktop]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const { lanIps, port } = useNetworkOrigin(desktop);

  return (
    <div>
      <Group title="Projector output" icon={Monitor}>
        {desktop ? (
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Output display</span>
            <select
              value={settings?.output.displayId ?? ""}
              onChange={(e) =>
                patchSettings({
                  output: {
                    ...(settings?.output ?? { resolution: "auto" }),
                    displayId: e.target.value ? Number(e.target.value) : null,
                  },
                })
              }
              className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--v-accent)]"
            >
              <option value="">Auto (second monitor)</option>
              {displays.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} {d.isPrimary ? "(primary)" : ""} · {d.size.width}×{d.size.height}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-sm text-[var(--v-text-dim)]">
            Running in the browser — the projector opens as a window. The desktop app can send it fullscreen to a second monitor.
          </p>
        )}
        <p className="mt-2 text-[11px] text-[var(--v-text-faint)]">
          Open / close the projector from the panel at the bottom-right of the operator screen.
        </p>
      </Group>

      <Group title="Live behavior" icon={LayoutList}>
        <label className="flex items-center justify-between">
          <span className="text-sm">Next / Prev sends the slide live immediately</span>
          <Toggle
            checked={settings?.advanceGoesLive ?? true}
            onChange={(v) => patchSettings({ advanceGoesLive: v })}
          />
        </label>
        <p className="mt-1 text-[11px] text-[var(--v-text-faint)]">
          On = arrows, Next/Prev buttons and the phone remote change the live output directly.
          Off = they cue the preview and Enter sends it live (ProPresenter style).
        </p>
      </Group>

      <AnnouncementGroup settings={settings} patchSettings={patchSettings} />

      <Group title="AI auto-follow" icon={Ear}>
        <label className="flex items-center justify-between">
          <span className="text-sm">Advance slides automatically by listening to the room</span>
          <Toggle
            checked={settings?.autoFollow ?? false}
            onChange={(v) => patchSettings({ autoFollow: v })}
          />
        </label>

        <AutoFollowStatus
          status={autoFollowStatus}
          heard={autoFollowHeard}
          enabled={settings?.autoFollow ?? false}
        />

        <label className="mt-3 block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Deepgram API key</span>
          <input
            type="password"
            placeholder="dg_..."
            value={settings?.deepgramApiKey ?? ""}
            onChange={(e) => patchSettings({ deepgramApiKey: e.target.value || null })}
            className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--v-accent)]"
          />
        </label>
        <p className="mt-1 text-[11px] text-[var(--v-text-faint)]">
          Powers the live speech recognition. New to this?{" "}
          <a href="https://abahvictor360-sketch.github.io/vifug-lyrics/deepgram-api-key.html" target="_blank" rel="noreferrer" className="text-[var(--v-accent)] hover:underline">
            How to get a Deepgram key
          </a>{" "}
          — a free key from <a href="https://deepgram.com" target="_blank" rel="noreferrer" className="text-[var(--v-accent)] hover:underline">deepgram.com</a> takes a few minutes.
          Manual next/prev always overrides.
        </p>

        <label className="mt-4 block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Spoken language</span>
          <select
            value={settings?.autoFollowLang ?? "en"}
            onChange={(e) => patchSettings({ autoFollowLang: e.target.value })}
            className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--v-accent)]"
          >
            {AUTOFOLLOW_LANGS.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-[var(--v-text-faint)]">
            Match the language your congregation sings in. "Multi (auto-detect)" follows code-switching between languages.
          </span>
        </label>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <label className="block">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Sensitivity</span>
              <span className="text-[10px] font-medium text-[var(--v-accent)]">
                {sensitivityLabel(settings?.autoFollowThreshold ?? 0.34)}
              </span>
            </div>
            {/* Slider is inverted: left = more eager (lower threshold). */}
            <input
              type="range"
              min={0.15}
              max={0.6}
              step={0.01}
              value={0.75 - (settings?.autoFollowThreshold ?? 0.34)}
              onChange={(e) => patchSettings({ autoFollowThreshold: Number((0.75 - Number(e.target.value)).toFixed(2)) })}
              className="w-full accent-[var(--v-accent)]"
            />
            <span className="mt-1 block text-[11px] text-[var(--v-text-faint)]">
              Higher = advances sooner but may jump early.
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Look-ahead (slides)</span>
            <select
              value={settings?.autoFollowLookahead ?? 3}
              onChange={(e) => patchSettings({ autoFollowLookahead: Number(e.target.value) })}
              className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--v-accent)]"
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-[var(--v-text-faint)]">
              How far ahead it scans for the next matching slide.
            </span>
          </label>
        </div>
      </Group>

      <Group title="NDI output" icon={Film}>
        <NdiPanel settings={settings} patchSettings={patchSettings} desktop={desktop} origin={origin} />
      </Group>

      <Group title="Teleport to OBS / vMix" icon={Rocket}>
        <TeleportPanel settings={settings} patchSettings={patchSettings} origin={origin} />
      </Group>

      <Group title="Keyboard shortcuts" icon={Keyboard}>
        <ShortcutsPanel settings={settings} patchSettings={patchSettings} />
      </Group>

      <Group title="Outputs & companion screens" icon={Monitor}>
        <RemotePinPanel settings={settings} patchSettings={patchSettings} />
        <ul className="space-y-1.5 text-sm">
          {[
            { label: "Stage display (band / confidence monitor)", url: `${origin}/#/stage` },
            { label: "Phone remote", url: `${origin}/#/remote` },
            { label: "Stream overlay (OBS browser source)", url: `${origin}/#/stream` },
          ].map((l) => (
            <li key={l.url} className="flex items-center justify-between gap-3">
              <span className="text-[var(--v-text-dim)]">{l.label}</span>
              <a href={l.url} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-medium text-[var(--v-accent)] hover:underline">
                Open ↗
              </a>
            </li>
          ))}
        </ul>

        {desktop && (
          <div className="mt-4 border-t border-[var(--v-border)] pt-4">
            <p className="mb-2 text-[11px] uppercase tracking-wide text-[var(--v-text-faint)]">
              On another device (same Wi-Fi)
            </p>
            {lanIps.length === 0 ? (
              <p className="text-[11px] text-[var(--v-text-faint)]">
                Detecting this machine's network address… make sure it's connected to Wi-Fi or Ethernet.
              </p>
            ) : (
              <div className="space-y-2.5">
                {lanIps.map((ip) => {
                  const netOrigin = `http://${ip}:${port}`;
                  return (
                    <div key={ip} className="rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] p-2.5">
                      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[var(--v-text)]">
                        <Radio className="h-3 w-3 text-[var(--v-accent)]" /> {ip}
                      </p>
                      <ul className="space-y-1">
                        {[
                          { label: "Stage", path: "/#/stage" },
                          { label: "Remote", path: "/#/remote" },
                          { label: "Stream", path: "/#/stream" },
                        ].map((l) => (
                          <li key={l.path} className="flex items-center justify-between gap-2">
                            <code className="min-w-0 flex-1 truncate text-[11px] text-[var(--v-text-dim)]">{netOrigin}{l.path}</code>
                            <button
                              onClick={() => navigator.clipboard?.writeText(`${netOrigin}${l.path}`)}
                              className="shrink-0 text-[10px] font-medium text-[var(--v-accent)] hover:underline"
                            >
                              Copy {l.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-2 text-[11px] text-[var(--v-text-faint)]">
              Type one of these into a phone or another computer's browser on the same network — the
              links above only work on this machine.
            </p>
          </div>
        )}
      </Group>

      <AboutGroup desktop={desktop} />
    </div>
  );
}

/* ---------------- Announcement ticker ---------------- */

function AnnouncementGroup({
  settings,
  patchSettings,
}: {
  settings: AppSettings | undefined;
  patchSettings: (p: Partial<AppSettings>) => void;
}) {
  const a = settings?.announcement ?? { enabled: false, text: "", speed: 22, bgColor: null, textColor: null };
  const set = (patch: Partial<NonNullable<AppSettings["announcement"]>>) =>
    patchSettings({ announcement: { ...a, ...patch } });

  return (
    <Group title="Announcement ticker" icon={Megaphone}>
      <label className="flex items-center justify-between">
        <span className="text-sm">Scroll a message across the bottom of the screen</span>
        <Toggle checked={a.enabled} onChange={(v) => set({ enabled: v })} />
      </label>
      <p className="mt-1 text-[11px] text-[var(--v-text-faint)]">
        Shows on the projector and stream overlay — independent of whatever's live, so it keeps
        scrolling even when the screen is blank.
      </p>

      <label className="mt-3 block">
        <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Message</span>
        <textarea
          value={a.text}
          onChange={(e) => set({ text: e.target.value })}
          placeholder="e.g. Potluck lunch after service in the hall — everyone welcome!"
          rows={2}
          className="w-full resize-none rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--v-accent)]"
        />
      </label>

      <label className="mt-3 block">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Scroll speed</span>
          <span className="text-[10px] font-medium text-[var(--v-accent)]">{a.speed}s per loop</span>
        </div>
        <input
          type="range"
          min={8}
          max={50}
          value={a.speed}
          onChange={(e) => set({ speed: Number(e.target.value) })}
          className="w-full accent-[var(--v-accent)]"
        />
        <span className="mt-1 block text-[11px] text-[var(--v-text-faint)]">Lower = faster scroll.</span>
      </label>

      <div className="mt-3 grid grid-cols-2 gap-4">
        <ColorField
          label="Bar background"
          value={a.bgColor ?? null}
          fallback="#000000"
          onChange={(v) => set({ bgColor: v })}
        />
        <ColorField
          label="Text color"
          value={a.textColor ?? null}
          fallback="#ffffff"
          onChange={(v) => set({ textColor: v })}
        />
      </div>

      {a.enabled && a.text.trim() && (
        <div className="relative mt-4 h-12 overflow-hidden rounded-lg border border-[var(--v-border)] bg-black">
          <div
            className="flex h-full items-stretch"
            style={{ borderTop: "2px solid var(--v-accent)", backgroundColor: hexToRgba(a.bgColor || "#000000", 0.78) }}
          >
            <span className="flex shrink-0 items-center bg-[var(--v-accent)] px-3 text-[10px] font-bold uppercase tracking-wide text-black">
              Announcement
            </span>
            <div className="flex min-w-0 flex-1 items-center overflow-hidden">
              <div className="v-ticker-track" style={{ animationDuration: `${Math.max(6, a.speed)}s` }}>
                <span className="v-ticker-item font-lyric text-sm font-semibold" style={{ color: a.textColor || "#ffffff" }}>{a.text}</span>
                <span className="v-ticker-item font-lyric text-sm font-semibold" style={{ color: a.textColor || "#ffffff" }} aria-hidden="true">{a.text}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </Group>
  );
}

/* ---------------- About / credits ---------------- */

function AboutGroup({ desktop }: { desktop: ReturnType<typeof useDesktop> }) {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    desktop?.getAppVersion?.().then(setVersion).catch(() => {});
  }, [desktop]);

  return (
    <Group title="About" icon={Info}>
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[var(--v-accent)] to-[var(--v-accent-2)] text-black shadow-[0_2px_10px_var(--v-accent-glow)]">
          <Music4 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold">
            Vifug Lyrics{version ? <span className="ml-1.5 font-normal text-[var(--v-text-faint)]">v{version}</span> : null}
          </p>
          <p className="text-[11px] text-[var(--v-text-faint)]">Free, offline-first worship presentation software.</p>
        </div>
      </div>
      <p className="mt-3.5 flex items-center gap-1.5 text-[12.5px] text-[var(--v-text-dim)]">
        <Heart className="h-3.5 w-3.5 text-[var(--v-live)]" /> Made by{" "}
        <a
          href="https://github.com/abahvictor360-sketch"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-[var(--v-accent)] hover:underline"
        >
          Victor Abah
        </a>
      </p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-[var(--v-text-faint)]">
        <a
          href="https://github.com/abahvictor360-sketch/vifug-lyrics"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-[var(--v-text)]"
        >
          <Github className="h-3.5 w-3.5" /> Source on GitHub
        </a>
        <a
          href="mailto:abahvictor360@gmail.com?subject=Vifug%20Lyrics"
          className="inline-flex items-center gap-1.5 hover:text-[var(--v-text)]"
        >
          <Mail className="h-3.5 w-3.5" /> abahvictor360@gmail.com
        </a>
      </div>
    </Group>
  );
}

/* ---------------- AI auto-follow live status ---------------- */

function AutoFollowStatus({
  status,
  heard,
  enabled,
}: {
  status: string;
  heard: string;
  enabled: boolean;
}) {
  const label =
    status === "listening"
      ? "Listening to the room…"
      : status === "connecting"
        ? "Connecting to speech service…"
        : status === "unavailable"
          ? "No Deepgram key set"
          : status === "error"
            ? "Microphone / connection error"
            : enabled
              ? "Ready — starts when a slide goes live"
              : "Off";

  const dot =
    status === "listening"
      ? "animate-pulse bg-[var(--v-ok)]"
      : status === "error" || status === "unavailable"
        ? "bg-[var(--v-live)]"
        : status === "connecting"
          ? "animate-pulse bg-amber-400"
          : "bg-[var(--v-text-faint)]";

  return (
    <div className="mt-3 rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-3)] px-3 py-2">
      <p className="flex items-center gap-2 text-[12px] text-[var(--v-text-dim)]">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        {label}
      </p>
      {status === "listening" && heard && (
        <p className="mt-1.5 truncate rounded bg-[var(--v-surface-2)] px-2 py-1 text-[11px] italic text-[var(--v-text-dim)]">
          “…{heard}”
        </p>
      )}
    </div>
  );
}

/* ---------------- NDI output ---------------- */

type NdiRuntimeStatus = {
  available: boolean;   // native NDI addon + runtime present
  running: boolean;     // sender currently emitting
  sourceName?: string;
  reason?: string;      // why unavailable (e.g. "addon_missing")
};

function NdiPanel({
  settings,
  patchSettings,
  desktop,
  origin,
}: {
  settings: AppSettings | undefined;
  patchSettings: (p: Partial<AppSettings>) => void;
  desktop: ReturnType<typeof useDesktop>;
  origin: string;
}) {
  const ndi = settings?.ndi ?? { enabled: false, sourceName: "Vifug Lyrics", frameRate: 30 };
  const setNdi = (patch: Partial<NonNullable<AppSettings["ndi"]>>) =>
    patchSettings({ ndi: { ...ndi, ...patch } });

  const [status, setStatus] = useState<NdiRuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    desktop?.ndiStatus?.().then(setStatus).catch(() => setStatus(null));
  };
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop]);

  const toggleNative = async (on: boolean) => {
    setNdi({ enabled: on });
    if (!desktop?.ndiStart) return;
    setBusy(true);
    try {
      if (on) {
        const s = await desktop.ndiStart({ sourceName: ndi.sourceName, frameRate: ndi.frameRate });
        setStatus(s);
      } else {
        const s = await desktop.ndiStop();
        setStatus(s);
      }
    } catch {
      /* leave last status */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {desktop ? (
        <div className="space-y-4">
          <label className="flex items-center justify-between">
            <span className="min-w-0">
              <span className="block text-sm">Publish the projector as an NDI source</span>
              <span className="block text-[11px] text-[var(--v-text-faint)]">
                Sends live lyrics/scripture directly to the network — no OBS needed.
              </span>
            </span>
            <Toggle checked={ndi.enabled} onChange={toggleNative} />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Source name</span>
              <input
                value={ndi.sourceName}
                onChange={(e) => setNdi({ sourceName: e.target.value })}
                placeholder="Vifug Lyrics"
                className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--v-accent)]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Frame rate</span>
              <select
                value={ndi.frameRate}
                onChange={(e) => setNdi({ frameRate: Number(e.target.value) })}
                className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--v-accent)]"
              >
                {[24, 25, 30, 50, 60].map((f) => (
                  <option key={f} value={f}>{f} fps</option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-center gap-2 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] px-3 py-2 text-[12px]">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                status?.running ? "bg-[var(--v-ok)]" : status?.available ? "bg-amber-400" : "bg-[var(--v-text-faint)]"
              }`}
            />
            <span className="min-w-0 flex-1 text-[var(--v-text-dim)]">
              {busy
                ? "Working…"
                : status?.running
                  ? `On air as "${status.sourceName ?? ndi.sourceName}"`
                  : status?.available
                    ? "NDI runtime ready — open the projector, then enable."
                    : "Native NDI runtime not found on this machine."}
            </span>
            <button onClick={refresh} className="shrink-0 text-xs font-medium text-[var(--v-accent)] hover:underline">
              Refresh
            </button>
          </div>

          {status && !status.available && (
            <p className="text-[11px] text-[var(--v-text-faint)]">
              To enable native NDI, install the <a href="https://ndi.video/tools/" target="_blank" rel="noreferrer" className="text-[var(--v-accent)] hover:underline">NDI Runtime</a> and rebuild
              the desktop app with the <code>grandiose</code> addon. Until then, use the OBS bridge below.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-[var(--v-text-dim)]">
          Native NDI output runs in the desktop app. In the browser, use the OBS bridge below.
        </p>
      )}

      {/* OBS → NDI bridge (works everywhere, no native code) */}
      <details className="mt-4 rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-3)] p-3" open={!desktop}>
        <summary className="cursor-pointer text-sm font-medium text-[var(--v-text-dim)]">
          Alternative: OBS → NDI bridge
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12px] text-[var(--v-text-dim)]">
          <li>In OBS, add a <b>Browser</b> source with the stream overlay URL below (1920×1080).</li>
          <li>Install the free <a href="https://github.com/DistroAV/DistroAV" target="_blank" rel="noreferrer" className="text-[var(--v-accent)] hover:underline">DistroAV</a> OBS plugin.</li>
          <li>OBS → Tools → <b>NDI Output Settings</b> → enable Main Output.</li>
          <li>vMix, TriCaster, Resolume or any NDI receiver on the network now sees the lyrics.</li>
        </ol>
        <div className="mt-3 flex items-center gap-2 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-3 py-2">
          <Link2 className="h-3.5 w-3.5 shrink-0 text-[var(--v-text-faint)]" />
          <code className="min-w-0 flex-1 truncate text-xs text-[var(--v-text-dim)]">{origin}/#/stream</code>
          <button
            onClick={() => navigator.clipboard?.writeText(`${origin}/#/stream`)}
            className="shrink-0 text-xs font-medium text-[var(--v-accent)] hover:underline"
          >
            Copy
          </button>
        </div>
      </details>
    </div>
  );
}

/* ---------------- Teleport (OBS / vMix one-click) ---------------- */

type TeleportResult = { ok: boolean; message: string } | null;

/**
 * Rebindable live controls. Recording listens for one keypress rather than
 * offering a key dropdown: the operator presses the key they will actually
 * reach for, which also captures modifiers without extra checkboxes.
 */
function ShortcutsPanel({
  settings,
  patchSettings,
}: {
  settings: AppSettings | undefined;
  patchSettings: (p: Partial<AppSettings>) => void;
}) {
  const map = resolveShortcuts(settings?.shortcuts);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [clash, setClash] = useState<string | null>(null);

  // While recording, swallow the whole keyboard so the captured key can't also
  // fire the action it is being bound to.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return; // bare modifier — keep listening for the real key
      const taken = conflictsFor(combo, map, recording);
      if (taken.length) {
        const label = SHORTCUT_ACTIONS.find((a) => a.id === taken[0])?.label ?? taken[0];
        setClash(`${formatCombo(combo)} is already ${label}`);
        setRecording(null);
        return;
      }
      setClash(null);
      patchSettings({ shortcuts: { ...map, [recording]: [combo] } });
      setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, map, patchSettings]);

  return (
    <div>
      <ul className="space-y-1.5">
        {SHORTCUT_ACTIONS.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="block truncate">{a.label}</span>
              <span className="block text-[11px] text-[var(--v-text-faint)]">{a.hint}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {recording === a.id ? (
                <span className="rounded-md border border-[var(--v-accent)] px-2.5 py-1 text-[11px] text-[var(--v-accent)]">
                  Press a key… (Esc cancels)
                </span>
              ) : (
                <>
                  {map[a.id].length ? (
                    map[a.id].map((c) => (
                      <kbd
                        key={c}
                        className="rounded border border-[var(--v-border)] bg-[var(--v-surface-3)] px-1.5 py-0.5 text-[11px]"
                      >
                        {formatCombo(c)}
                      </kbd>
                    ))
                  ) : (
                    <span className="text-[11px] text-[var(--v-text-faint)]">Not set</span>
                  )}
                  <button
                    onClick={() => {
                      setClash(null);
                      setRecording(a.id);
                    }}
                    className="rounded-md border border-[var(--v-border)] px-2 py-1 text-[11px] hover:bg-[var(--v-surface)]"
                  >
                    Change
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      {clash && <p className="mt-2 text-[11px] text-amber-500">{clash} — pick another key.</p>}

      <button
        onClick={() => {
          setClash(null);
          patchSettings({ shortcuts: {} });
        }}
        className="mt-3 rounded-md border border-[var(--v-border)] px-2.5 py-1.5 text-[11px] hover:bg-[var(--v-surface)]"
      >
        Reset to defaults
      </button>
      <p className="mt-2 text-[11px] text-[var(--v-text-faint)]">
        Shortcuts are ignored while typing in a text box or when a dialog is open.
      </p>
    </div>
  );
}

/**
 * Phone-remote lock. The remote can blank the screen or jump slides mid-
 * service, and the server is reachable by every device on the Wi-Fi, so this
 * is on by default. The PIN is shown here because this panel is exactly where
 * the operator comes to fetch the Remote URL.
 */
function RemotePinPanel({
  settings,
  patchSettings,
}: {
  settings: AppSettings | undefined;
  patchSettings: (p: Partial<AppSettings>) => void;
}) {
  const remote = settings?.remote ?? { requirePin: true, pin: null };
  const [revealed, setRevealed] = useState(false);

  const randomPin = () => String(Math.floor(1000 + Math.random() * 9000));

  return (
    <div className="mb-4 rounded-md border border-[var(--v-border)] bg-[var(--v-surface-3)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Lock className="h-3.5 w-3.5 text-[var(--v-accent)]" /> Remote PIN
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--v-text-faint)]">
            Anyone on this Wi-Fi can open the Remote. The PIN stops them driving your service.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--v-text-dim)]">
          <input
            type="checkbox"
            checked={remote.requirePin !== false}
            onChange={(e) =>
              patchSettings({
                remote: {
                  requirePin: e.target.checked,
                  pin: e.target.checked ? (remote.pin ?? randomPin()) : remote.pin,
                },
              })
            }
          />
          Require
        </label>
      </div>

      {remote.requirePin !== false && (
        <div className="mt-2.5 flex items-center gap-2">
          <code className="rounded bg-[var(--v-surface)] px-3 py-1.5 text-lg font-semibold tracking-[0.3em] text-[var(--v-accent)]">
            {revealed ? (remote.pin ?? "….") : "••••"}
          </code>
          <button
            onClick={() => setRevealed((v) => !v)}
            className="rounded-md border border-[var(--v-border)] px-2 py-1.5 text-[11px] hover:bg-[var(--v-surface)]"
          >
            {revealed ? "Hide" : "Show"}
          </button>
          <button
            onClick={() => patchSettings({ remote: { requirePin: true, pin: randomPin() } })}
            className="rounded-md border border-[var(--v-border)] px-2 py-1.5 text-[11px] hover:bg-[var(--v-surface)]"
            title="Any phone already unlocked will have to enter the new PIN"
          >
            New PIN
          </button>
        </div>
      )}
      {remote.requirePin === false && (
        <p className="mt-2 text-[11px] text-amber-500">
          Unlocked — any device on this network can control the service.
        </p>
      )}
    </div>
  );
}

function TeleportPanel({
  settings,
  patchSettings,
  origin,
}: {
  settings: AppSettings | undefined;
  patchSettings: (p: Partial<AppSettings>) => void;
  origin: string;
}) {
  const obs = settings?.obs ?? { host: "127.0.0.1", port: 4455, password: "" };
  const vmix = settings?.vmix ?? { host: "127.0.0.1", port: 8088 };
  const setObs = (patch: Partial<NonNullable<AppSettings["obs"]>>) => patchSettings({ obs: { ...obs, ...patch } });
  const setVmix = (patch: Partial<NonNullable<AppSettings["vmix"]>>) => patchSettings({ vmix: { ...vmix, ...patch } });

  const streamUrl = `${origin}/#/stream`;

  const [obsBusy, setObsBusy] = useState(false);
  const [obsResult, setObsResult] = useState<TeleportResult>(null);
  const [vmixBusy, setVmixBusy] = useState(false);
  const [vmixResult, setVmixResult] = useState<TeleportResult>(null);

  const doTeleportObs = async () => {
    setObsBusy(true);
    setObsResult(null);
    try {
      const { sceneName, created } = await teleportToObs({
        host: obs.host,
        port: obs.port,
        password: obs.password || null,
        url: streamUrl,
        inputName: "Vifug Lyrics",
      });
      setObsResult({ ok: true, message: `${created ? "Added to" : "Updated in"} scene "${sceneName}".` });
    } catch (e) {
      setObsResult({ ok: false, message: (e as Error).message });
    } finally {
      setObsBusy(false);
    }
  };

  const doTeleportVmix = async () => {
    setVmixBusy(true);
    setVmixResult(null);
    try {
      await sendToVmix({ host: vmix.host, port: vmix.port, url: streamUrl });
      setVmixResult({ ok: true, message: "Sent — check vMix's input list to see it land." });
    } catch (e) {
      setVmixResult({ ok: false, message: (e as Error).message });
    } finally {
      setVmixBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-[var(--v-text-faint)]">
        One click drops the live overlay straight into OBS or vMix as a source — no copy-pasting a
        URL into a dialog. Once it's in, it stays live-synced automatically, same as the manual
        bridge in the NDI panel above.
      </p>

      <div className="rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-3)] p-3.5">
        <p className="mb-3 text-sm font-medium">OBS Studio</p>
        <div className="grid grid-cols-[1fr_92px] gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Host</span>
            <input
              value={obs.host}
              onChange={(e) => setObs({ host: e.target.value })}
              className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--v-accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Port</span>
            <input
              type="number"
              value={obs.port}
              onChange={(e) => setObs({ port: Number(e.target.value) || 4455 })}
              className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--v-accent)]"
            />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">
            WebSocket password (Tools → WebSocket Server Settings in OBS)
          </span>
          <input
            type="password"
            value={obs.password ?? ""}
            onChange={(e) => setObs({ password: e.target.value })}
            placeholder="leave blank if auth is disabled"
            className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--v-accent)]"
          />
        </label>
        <button
          onClick={doTeleportObs}
          disabled={obsBusy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-[var(--v-accent)] py-2 text-sm font-semibold text-black transition-colors hover:bg-[var(--v-accent-2)] disabled:opacity-50"
        >
          {obsBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
          {obsBusy ? "Teleporting…" : "Teleport to OBS"}
        </button>
        {obsResult && (
          <p className={`mt-2 text-[12px] ${obsResult.ok ? "text-[var(--v-ok)]" : "text-[var(--v-live)]"}`}>
            {obsResult.message}
          </p>
        )}
        <p className="mt-2 text-[10px] text-[var(--v-text-faint)]">
          Requires OBS 28+. Enable it once: Tools → WebSocket Server Settings → Enable WebSocket server.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-3)] p-3.5">
        <p className="mb-3 text-sm font-medium">vMix</p>
        <div className="grid grid-cols-[1fr_92px] gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Host</span>
            <input
              value={vmix.host}
              onChange={(e) => setVmix({ host: e.target.value })}
              className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--v-accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--v-text-faint)]">Port</span>
            <input
              type="number"
              value={vmix.port}
              onChange={(e) => setVmix({ port: Number(e.target.value) || 8088 })}
              className="w-full rounded-md border border-[var(--v-border)] bg-[var(--v-surface-2)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--v-accent)]"
            />
          </label>
        </div>
        <button
          onClick={doTeleportVmix}
          disabled={vmixBusy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-[var(--v-accent)] py-2 text-sm font-semibold text-black transition-colors hover:bg-[var(--v-accent-2)] disabled:opacity-50"
        >
          {vmixBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
          {vmixBusy ? "Teleporting…" : "Teleport to vMix"}
        </button>
        {vmixResult && (
          <p className={`mt-2 text-[12px] ${vmixResult.ok ? "text-[var(--v-ok)]" : "text-[var(--v-live)]"}`}>
            {vmixResult.message}
          </p>
        )}
        <p className="mt-2 text-[10px] text-[var(--v-text-faint)]">
          vMix's API can't confirm success back to a browser — a message here just means it was
          sent. Check vMix's input list. Uses vMix's Web Controller (on by default, port 8088).
        </p>
      </div>
    </div>
  );
}

/* ---------------- tiny toggle ---------------- */

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-[var(--v-accent)]" : "bg-[var(--v-surface-3)]"}`}
      role="switch"
      aria-checked={checked}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? "left-4" : "left-0.5"}`} />
    </button>
  );
}
