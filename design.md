# Vifug — Design System

Calm, fast, hard-to-break live control surface. Inspired by ProPresenter / EasyWorship.
Volunteer-friendly: large targets, obvious go-live / blank / clear, minimal chrome in live view.

## Principles
- **Dark, high-contrast operator UI** — reduces glare in a dark AV booth, keeps focus on lyrics.
- **The projector output is separate and pristine** — pure lyric render, no chrome.
- **Big, unmissable live controls** — GO LIVE, BLANK, CLEAR are always reachable, color-coded.
- **Keyboard-first live view** — arrow keys advance, space blanks, esc clears.
- **Nothing surprises the operator** — no modal traps, no destructive actions without confirm.

## Color
Zinc/slate dark base with a fresh lime accent and clear status colors.

- `--bg`            #0a0a0c  (app background, near-black)
- `--surface`       #141418  (panels, cards)
- `--surface-2`     #1c1c22  (raised: toolbars, headers)
- `--surface-3`     #26262e  (hover, active rows)
- `--border`        #2e2e38
- `--text`          #f4f4f5  (primary)
- `--text-dim`      #a1a1aa  (secondary)
- `--text-faint`    #71717a  (labels, meta)
- `--accent`        #a3e635  (lime — primary action, active state)
- `--accent-2`      #65a30d  (lime deep — gradient end)
- `--accent-soft`   rgba(163,230,53,0.14)
- `--accent-glow`   rgba(163,230,53,0.35)
- `--live`          #ef4444  (currently live indicator / GO LIVE)
- `--live-soft`     rgba(239,68,68,0.15)
- `--blank`         #3b82f6  (blank/black state)
- `--ok`            #22c55e

## Typography
- **UI font:** Inter-alternative avoided per guidelines → use **"Sora"** for headings/labels and **"IBM Plex Sans"** for body/controls. Load via Google Fonts.
- **Lyric render font (default theme):** clean, high-legibility sans — **"Archivo"** semibold, large, generous line height. Themes can override.
- Hierarchy: section labels uppercase 11px tracked; song titles 15–18px; lyric slide text huge (auto/clamp).

## Layout
Three-pane operator workspace (ProPresenter-like):
1. **Left rail** — library / playlist navigation, search, import.
2. **Center** — selected song's arrangement as an ordered slide grid (the "sung sequence").
3. **Right/Bottom** — live output preview + big transport controls + lines-per-slide slider + theme/output settings.

Top bar: app name, current playlist, output status pill (projector connected / lines N / theme), open-projector button.

## Slide grid
- Each slide = a card showing its lines exactly as they'll render.
- Section label chip (Verse 1, Chorus...) on each card, color-tinted per section type.
- Live slide: red ring + LIVE badge. Next/preview: gold ring.
- Click a slide → sends to projector. Arrow keys move live pointer.

## Motion
- Slide transitions on projector: fade (theme-controlled, default 300ms).
- Operator UI: minimal, fast; subtle 120ms hover/active. No decorative animation in live view.

## Components
- `Button` (variants: primary/gold, danger/live, ghost, subtle)
- `SlideCard`, `SectionChip`, `LinesControl` (2 / 3 / custom stepper + slider)
- `TransportBar` (prev, next, go-live, blank, clear)
- `OutputPreview` (mini render of current projector state)
- `SongListItem`, `SearchBar`, `ImportButton`

## Projector render (the engine)
- Full-bleed, background color/gradient from theme, safe-margin padding.
- Text centered (theme align), auto-fit within safe area, outline/scrim optional.
- Dual-language: original stacked over translation (translation dimmer/smaller).
- Blank state: solid black. Clear: empty (background only).
