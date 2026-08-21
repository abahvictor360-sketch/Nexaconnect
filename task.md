# Vifug — Phase 1 Build

Offline-first church lyric presentation desktop app (Electron + React + Drizzle/SQLite).
Spec: build **Phase 1 only** end-to-end.

## Core principles (must honor)
- Store words, not slides. Slides computed at render time by paginator.
- Sections stored once; arrangements order them (repeats allowed).
- Render once, output many (Phase 1 = projector window; transports later).
- Manual override always wins.
- Offline-first, local SQLite source of truth.

## Phase 1 checklist
- [ ] Drizzle schema: songs, sections, arrangements, arrangement_items, translations, media, themes, fonts, playlists, playlist_items, settings
- [ ] API: songs CRUD, sections save, arrangements, import (txt/docx), themes, settings
- [ ] Paginator (shared TS): fixed 2/3/N, manual-break, autofit; dual-language attach
- [ ] Library page (song list + search)
- [ ] Song editor (section editor: verse/chorus/bridge labels, reorder)
- [ ] Import .txt/.docx with structure auto-detect
- [ ] Default arrangement auto-build + reorder + repeats
- [ ] Live operator view: song list -> arrangement -> slide grid -> go live (click/arrow keys)
- [ ] Live 2/3/custom lines-per-slide control
- [ ] Blank/black + clear buttons
- [ ] Render engine + projector output (second monitor via Electron BrowserWindow)
- [ ] Live sync operator <-> projector (BroadcastChannel)
- [ ] Basic theme (font, size, color, align, bg color, safe margins)
- [ ] Settings: output display, theme, lines-per-slide
- [ ] Seed: 100 public-domain hymns + curated Nigerian gospel songs

## DoD
Operator imports a song, shows it on a projector on a second screen, advances
slides by keyboard, toggles 2<->3 lines per slide live.

## Design
Dark, calm, high-contrast (ProPresenter/EasyWorship). See design.md.

## Phase 1 — COMPLETE (verified 2026-07-02)
- Routes wired: `/` operator, `/projector` (hash routing for Electron `#/projector`). ✓
- `bun run build`: passes, zero TS errors. ✓
- Live loop verified via headless Chrome (shared context = BroadcastChannel + localStorage):
  - Select song → paginator computes slides w/ repeats ✓
  - Click slide → projector shows lyrics ✓
  - Next/Prev + keyboard (→/←/Space/Esc) advance & blank ✓
  - Toggle 2↔3 lines → live re-pagination on projector ✓
  - Blank/Clear → projector blanks ✓
- Import txt parser bug FIXED: leading title block no longer leaks into a lyric section (structure.ts now title-aware). ✓
- 125 songs seeded (100 hymns + 25 Nigerian gospel), copyright populated. ✓
- Server runs on :4200 via pm2 (use `bunx pm2`). ✓

## PHASE 2 — IN PROGRESS (2026-07-02)
Provider decisions: media = upload+URL; speech = Deepgram (real-time WS); NDI = browser-source bridge (native NDI documented, not built in sandbox).
Languages: en, idoma(ido), yoruba(yo), igbo(ig), hausa(ha), twi(tw).

### Build order
1. [ ] Media backgrounds — schema `backgrounds` table already exists? verify. Upload (template file storage) + URL. Assign per theme + per song. Render on projector/stream behind lyrics. Types: image/video/color.
2. [ ] Multi-language — `song_sections.lang` already exists. Add translation sections per lang. Dual-language projector display (primary + secondary stack). Settings: songDisplayLang, dualLanguage, secondaryLang.
3. [ ] Streaming/browser-source — `/stream` route, transparent bg, mirrors live state via same live-bus. OBS-ready.
4. [ ] AI auto-follow — Deepgram WS. Mic capture in operator, transcript→token match→auto-advance. Manual override wins. Toggle on/off. Needs DEEPGRAM_API_KEY.
5. [ ] NDI — document OBS NDI bridge path from /stream URL. Provide local native build instructions.

### Gate
`bun run build` clean; preview all features working.

## PHASE 2 — COMPLETE (verified 2026-07-02)
All 5 features built + runtime-verified. Build clean, /stream SSE sync confirmed. NDI documented (docs/STREAMING_AND_NDI.md).

## PHASE 3 — IN PROGRESS (2026-07-02)
Decisions:
- Bible versions: KJV, WEB, ASV, BBE (English PD) + Yoruba, Hausa, Igbo (PD) — bundle offline.
- Preview: separate PREVIEW→LIVE stage (preview next slide before sending live, ProPresenter-style). Applies to BOTH lyrics and bible.
- Bible theme: shares lyric theme, with per-display Bible overrides (bg, font, size, align, color).
- Nav: dropdowns (book/chapter/verse) + search box ("John 3:16" or keywords). Send single verse or range.
- Mode switch: operator toggles between LYRICS and BIBLE tab; both drive same live/projector/stream output.

### Build order
1. [x] Fetch + bundle PD bible data. 7 versions (kjv/web/asv/bbe/yor/hau/ibo) x 66 books = static JSON in public/bible/, lazy per book. manifest.json has canon + chapterCounts. 31MB.
2. [ ] Bible data hook (use-bible): load manifest, load book (cached), reference parse ("John 3:16"), keyword search within version.
3. [ ] API: bible search endpoint (server-side across a version's books) — OR client-side search over loaded books (offline). Decide: client-side within current version to stay offline.
4. [ ] Preview→Live: extend live-controller/state so operator PREVIEWS a slide (verse or lyric) then SENDS to live. previewSlide separate from liveState. Keyboard: Enter=send preview→live.
5. [ ] Operator: LYRICS/BIBLE tab switch at top. Bible panel = version dropdown + book/chapter/verse dropdowns + search box + verse list; click verse -> preview; send-to-live.
6. [ ] Bible theme override UI in settings (bg/font/size/align/color); merge over lyric theme when mode=bible.
7. [ ] Bible slide -> same live-bus publish -> projector + /stream. Reuse SlideRender (verse text + reference label).

### Gate
`bun run build` clean (zero TS errors); one preview showing preview→live stage + bible tab (version switch, nav, theme override) working.

### Build order — DONE
2. [x] use-bible hook — manifest, lazy book cache, parseReference, searchVersion. Built + verified.
3. [x] Client-side search within current version (offline). Verified ("love"→60 hits, "John 3:16"→ref jump).
4. [x] Preview→Live stage (lib/stage.ts + use-stage.ts). Live keyed by slideId so tab/version switch keeps same verse live. Keyboard: ←→ cue, Enter send, Space blank, Esc clear.
5. [x] Operator LYRICS/BIBLE tab; BiblePanel wired; PREVIEW panel above LIVE in right aside; both sources feed useStage.
6. [x] Bible theme override in AppSettings.bibleTheme + SettingsModal (bg/text color, align, weight, size), merged over lyric theme when mode=bible.
7. [x] tsc --noEmit clean, bun run build clean (636KB). Server :4200 via pm2. Headless verified: version switch (KJV→Yoruba live re-render), ref jump, keyword search, override UI, 125 songs lyrics tab intact, zero console errors.

## PHASE 3 — COMPLETE (verified 2026-07-02)
Preview→Live stage + Bible tab shipped. Gate met.

## PHASE 3 — COMPLETE (verified 2026-07-02)
- Preview→Live stage (ProPresenter-style): PREVIEW and LIVE panels now SIDE BY SIDE in right rail. ✓
- Cue slide (click / ←→) → "Send Preview to Live" (Enter) pushes to live output + projector. ✓
- LYRICS/BIBLE tab switch drives the same stage/output. ✓
- Bible: 7 offline versions (KJV, WEB, ASV, BBE, Yoruba, Hausa, Igbo), book/chapter/verse dropdowns + reference/keyword search (client-side). ✓
- Bible theme overrides (bg, text color, align, weight, size) in Settings, merged over lyric theme. ✓
- `bun run build`: clean, zero TS errors. Verified via headless Chrome, zero console errors. ✓

## PHASE 4 — IN PROGRESS (2026-07-02)
Scope confirmed with user:
1. [ ] Bible language toggle — inline in Bible tab. English core (KJV/WEB/ASV/BBE) always on; Yoruba/Hausa/Igbo toggle on/off. Persist in settings.bibleLangs.
2. [ ] Schedules/playlists — service plan builder: add songs + scripture + blank items, reorder, click-to-cue into stage. New PLANS tab.
3. [ ] ProPresenter import — parse .pro6 (XML) + .pro (best-effort text) → songs+sections.
4. [ ] Remote control — /remote route (phone/tablet), server command channel (POST /remote/command + SSE /remote/stream); operator executes.
5. [ ] Notes / stage display — /stage route: current + next slide + clock + notes; new /api/stage SSE (live+preview+notes).
6. [ ] Downloads — zip source (+README build guide) into public/downloads; electron-builder wired for exe/dmg/AppImage; build Linux AppImage here; GitHub Actions CI for signed installers.

NOTE: signed .exe (.dmg) can't be produced inside Linux sandbox — wire builder + CI, produce AppImage as proof.

### Build order
1. settings.bibleLangs + AppSettings type + defaultSettings + inline Bible toggle
2. Stage server channel (/api/stage) + /stage page + notes
3. Remote command channel (/api/remote) + /remote page + operator executor
4. Playlists UI (PLANS tab) — API mostly exists; extend for scripture/blank items
5. ProPresenter import (.pro6 xml)
6. Downloads: electron-builder rebrand, source zip, AppImage build, CI workflow
7. bunx tsc --noEmit + bun run build; verify headless; deliver
