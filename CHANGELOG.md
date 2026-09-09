# Changelog

All notable changes to Vifug are documented here.
Versioning follows [Semantic Versioning](https://semver.org). Releases are cut by
pushing a `v*` tag, which triggers the desktop installer build and publishes a
GitHub Release with Windows, macOS and Linux artifacts.

## [1.19.1] — 2026-09-09

A pass over every control in the app, looking for the ones that were too small
to hit, invisible until a mouse found them, or silent to a screen reader.

- FIX: **the delete button on a song, a deck and a Bible verse only existed if you had a mouse.** It was hidden until the row was hovered, which on a phone or tablet - where Vifug now runs - never happens, so the action was simply unreachable. It is now visible on a touch screen, appears when tabbed to on a keyboard, and has a hit area a finger can land on instead of a 14-pixel icon. Each one also says what it deletes ("Delete Amazing Grace") rather than announcing itself as "button".
- FIX: **the microphone and video mute buttons in the Audio Mixer were 22 pixels square** and unnamed. Both are now comfortably tappable, say which sound they mute, and report whether they are currently muted.
- FIX: **the AI Auto-Follow switch was invisible to a screen reader** - no name, and no way to tell on from off. It is now a real switch with both. Its hit area reaches past the track, so the toggle no longer has to be hit exactly.
- FIX: **move, repeat and remove in the service order were about 14 pixels tall.** Grown to a real target, named, and given a visible focus ring.
- FIX: **on a phone, the microphone and speaker pickers collapsed to about 18 pixels wide** - too narrow to read the device name or open the list - because the Test button beside them took the whole row. The row now wraps.
- FIX: keyboard focus is visible on the controls above; several of them previously took focus with nothing on screen to show it.
- FIX: the timer's On/Off chip, the stream-address copy button, the "Find my screens" and "Project" buttons and the "Open stream output" link were all under the size a touch screen needs, and the copy button had no name at all.

## [1.19.0] — 2026-09-08

- **Videos play with sound.** A video added to the app was stored silent, whatever the "new videos play with sound" setting said - so a testimony or announcement clip played to a room that heard nothing. New videos now carry their audio, and Settings → Presentations can turn sound on (or off) for every video already in your library in one click. A background loop meant to be silent is still one click away on its thumbnail.
- **Choose which speakers the app plays through.** Settings → General → Sound output picks the speakers, sound card or HDMI output - the fix for a laptop plugged into the desk that keeps sending video sound to its own speakers instead of the PA. A Test button plays a tone through it, so the route can be checked before the room fills rather than during the notices. Works on the desktop app and in Chrome/Edge; Firefox and iPhone say so instead of offering a control that does nothing.
- **A mute for the sound going out, and one for the microphone.** The Audio Mixer on the operator screen gained a master mute that silences everything the app plays, on every screen at once, without touching any clip's own setting - for the moment a video starts talking over the preacher. Both mutes are also in Settings, beside the device they belong to.
- **The sound comes out of one place, not three.** The projector window, a full-screen output and the operator's own live thumbnail each played the same clip a few frames apart, which in a room is an echo. Whichever screen is the real output now has the sound; the rest stay silent.
- **The app works on a phone or a tablet in a browser.** The three columns stacked for a narrow screen, the top bar's tabs scroll instead of being pushed off the edge, and Settings puts its section list across the top. Before this, Presentations, Media, Plans and History could not be reached at all on a phone - the tabs were off the right of the screen - so the New button people were tapping belonged to the song library.
- **The Media tab works the way OBS does.** One list of everything (images and videos together, or filtered to either), and a properties panel beside it for whatever you pick: how it sits on the screen, sound and looping for a video, its look, and Preview / Go live. All of it used to be chips that only appeared while a mouse hovered a thumbnail - unreachable on a touch screen, and unfindable unless you already knew they were there.
- **Set any picture or video as the background for lyrics, scripture or a deck** from that panel, in one click. Presentations can now carry a background of their own at all: decks used to be stuck with whatever the lyrics were using, and a slide with its own background still wins over it.
- **Set the margin the words keep from the edge of the screen**, per display, under Lyrics, Bible and Presentations. One number for all four edges, or one per edge for a projector that overshoots the top of the wall or a TV cutting off one side, with a diagram of what you are about to get. Type that sizes itself to the slide grows as the margin comes down.
- FIX: in a browser, a projector plugged in after the app was open went unnoticed - the status line kept saying "no second screen detected" until the page was reloaded. It now watches for screens being connected, says which one it found, and offers the one-click permission a browser needs before it can open the output on that screen (previously buried in a right-click menu, and unreachable on a touch screen).
- FIX: changing the microphone from the Audio Mixer quietly forgot the chosen sound output device.

## [1.16.0] — 2026-09-02

- **A theme editor.** Themes could be picked from a list but never made or changed. Now you can create, duplicate, rename and delete them, and edit every part - display mode, text and background colour, font size and weight, alignment, vertical position, lines per slide, safe margin, background dimming, text outline and transition - with the preview updating as you go. Deleting a theme that songs still use, or the one currently on air, is refused with a sentence saying which, rather than silently leaving those songs pointing at nothing.
- **A service timer, on whichever screens you choose.** A countdown or count-up you start from the sidebar, shown on the stage monitor, the congregation screen, the OBS/vMix source, or any combination - so the worship team can watch a countdown the congregation never sees. Pause, resume and reset; an optional label; corner or centre placement; three sizes; amber for the last thirty seconds; and it keeps counting past zero, because a speaker running over is exactly when the number matters. Every screen derives the time from a shared anchor and corrects against the server's clock, so they cannot drift apart.
- **Vifug runs in a browser.** The same operator screen, projector, stage display and phone remote are now hosted at app.vifug.com, with no install and no requirement that the devices share a Wi-Fi network. The desktop app is still the one for Sunday: it needs no internet at all and sends NDI straight onto your network.
- **The phone remote and stage display no longer need the same Wi-Fi** on a hosted deployment. On the desktop app nothing changes.
- **Fetching lyrics from a web page brings back the words, not the page.** The extractor now finds the lyric body on ordinary HTML, WordPress, React and PHP pages instead of dragging in menus, share buttons and cookie notices.
- **Media uploads say what went wrong.** A refused upload now names the cause - no bucket configured, the bucket rejected it, the browser could not reach it - instead of blaming the Wi-Fi.
- **Full screen on this device**, for a laptop plugged into the projector with no second monitor, or a tablet used as a screen.

## [1.13.1] — 2026-08-17

- **Import a PowerPoint deck and keep its design.** Export it from PowerPoint as a PDF (`File → Save as → PDF`) and import that: every slide comes in looking exactly as you designed it, because PowerPoint did the drawing. Exported slide images (PNG) work the same way. Importing the `.pptx` itself still works but can only bring across the words - the app now says so at the moment of import instead of leaving you to find out on a Sunday.
- **New guide chapter on letting phones connect.** Windows blocks incoming connections to new programs silently, so a stage display that will not load looks like a broken feature rather than a permission that was never granted.
- **Right-click a preview to choose where it goes** now works. The menu was being closed by the very click that opened it, so it never appeared.
- Licence terms are now written down and shown in Settings → About: free to use on any number of machines, everything you create is yours, and copying or modifying the software needs permission.
- Every build now carries its own version number, so the update prompt and the About panel always tell you which one you are running.

## [1.12.0] — 2026-08-17

- **Projection now starts by itself.** Connect a projector or TV and the output goes to it full screen, without being asked - including when you plug it in mid-service. Your own screen is never taken over, and closing the output yourself keeps it closed until you project again or the screens change. The old "Open projector" panel is gone; a single status line under the Live preview says where the output is.
- **Right-click either preview to choose where it goes.** Every connected screen is listed by name and resolution, the one on air is marked, and picking one remembers it for next time. The same menu carries "Add to OBS" and "Copy browser source link".
- **Full projection controls in Settings → General**, including turning projection off entirely, sending the output to a specific screen, and forgetting a preferred screen.
- **Colour and emphasis on selected text.** Select words in lyrics, a presentation slide or a Bible verse and a toolbar appears with bold, italic, underline, colour and alignment. The formatting reaches the projector and the stream, not just the editor.
- **Pasting text splits it into slides.** Paste something with blank lines between paragraphs and each paragraph becomes its own slide - or, in Lyrics, its own section, honouring "Chorus" and "[Verse 2]" headings where the pasted text has them.
- **Updates explain themselves.** The update prompt now shows the release notes so you can judge whether to install before or after a service, and Help → Check for Updates asks on demand.
- **Companion screens are reachable again.** Windows Firewall was silently refusing connections from phones and tablets; the app now detects that and offers to add the rule. The address offered is also ranked properly - a disconnected adapter's 169.254 address or a WSL/VirtualBox adapter no longer outranks live Wi-Fi - and the port is stable between launches, so a bookmarked remote keeps working.
- **About moved out of General** into its own Settings entry, with a proper description of what the app does and where your data lives.
- FIX: saving an edit to a presentation imported from PowerPoint discarded the deck's own background and text colours.

## [1.0.9] — 2026-07-06

- New History tab (after Plans): every song and Bible passage that goes live is recorded — newest first, de-duplicated, persisted across restarts (up to 200 items). Click an entry to cue that song or passage again; Clear history wipes the list.

## [1.0.8] — 2026-07-06

- Bible reference jump now accepts flexible formats: "john 3 16" (spaces), "ps 23.1", "john 3v16", and ranges like "1 john 2 3-5" — in addition to the classic "John 3:16".

## [1.0.7] — 2026-07-06

- Fullscreen auto-fit now measures the real rendered text width (per font family/weight) instead of estimating, so lyrics fill the usable width edge-to-edge within the safe margin — roughly 18% larger than v1.0.6 on typical verses.

## [1.0.6] — 2026-07-06

- Fullscreen slides now auto-size the text to FILL the display (bounded by the safe margin at the edges) instead of capping at 96px. Lower-third modes keep their broadcast-style sizing. Switch between Fullscreen and Lower third in Settings → Lyrics → Look & feel → Display mode (and Settings → Bible for scripture).

## [1.0.5] — 2026-07-06

- FIX: the projector window fullscreened onto the primary monitor even when targeting the secondary display. Cause: fullscreening a still-hidden window on Windows snaps it to the primary display. The window is now positioned on the target display, shown, and only then fullscreened — same for moving an already-open projector between displays.

## [1.0.4] — 2026-07-05

- FIX: on small screens (1366×768 laptops) the Projector panel was pushed below the window edge and unreachable — this is why "Open projector" seemed missing. The panel now sits right under the transport controls and the whole right rail scrolls.
- Removed the leftover analytics debug overlay that could appear over the operator UI in the packaged app.

## [1.0.3] — 2026-07-05

- Next / Prev (arrow keys, transport buttons, phone remote) now sends the slide live immediately — no separate GO LIVE click. Toggle in Settings → General → Live behavior to return to cue-then-Enter.
- Bible slides now show the scripture reference on the projector/stream, with a new Reference color and Verse text color in Settings → Bible.
- Settings → General gains an AI auto-follow section with in-app Deepgram API key (no server env needed) and an NDI output section with setup steps and the stream URL.
- Projector: extra safety net so the output window always appears on the chosen display.

## [1.0.2] — 2026-07-05

- All installers (Windows, macOS, Linux) now carry the Vifug app icon — the lime music-note tile — instead of the default Electron icon.

## [1.0.1] — 2026-07-05

- Projector window now reliably opens fullscreen on the selected (secondary) display on Windows; moving an open projector between displays also works.
- Library grows from 125 to 325 seeded songs (all 300 public-domain hymns + 25 Nigerian gospel).
- Removed the "Made with Runable" badge from the app.

## [1.0.0] — 2026-07-05

First public release.

### Lyrics & presentation
- Song library with search, section-based song editor (verse/chorus/bridge), arrangements with repeats.
- Import from `.txt` / `.docx` with structure auto-detect, plus ProPresenter (`.pro6` / `.pro`) import.
- Paginator: fixed 2/3/N lines per slide, manual breaks, autofit — slides computed at render time.
- Preview → Live stage (ProPresenter-style): cue with ←/→, send with Enter, blank with Space, clear with Esc.
- Fullscreen / lower-third display mode with position control.
- Themes: font, size, color, alignment, backgrounds (image / video / color), safe margins.
- 125 seeded songs (100 public-domain hymns + 25 Nigerian gospel).

### Bible
- 7 offline versions bundled: KJV, WEB, ASV, BBE, Yoruba, Hausa, Igbo.
- Book/chapter/verse navigation, reference jump ("John 3:16") and keyword search — fully offline.
- Per-display Bible theme overrides merged over the lyric theme.

### Outputs
- Projector output on a second monitor (Electron window, BroadcastChannel sync).
- `/stream` browser-source page with transparent background, synced over Server-Sent Events — OBS / vMix ready, NDI via OBS + DistroAV bridge (see `docs/STREAMING_AND_NDI.md`).
- Stage display (`/stage`): current + next slide, clock and notes for the worship team.
- Remote control (`/remote`) from phone or tablet.

### Platform
- Offline-first: local SQLite (libsql) source of truth, fully offline Windows installer.
- Multi-language UI content: English, Idoma, Yoruba, Igbo, Hausa, Twi.
- Service plans (playlists) mixing songs, scripture and blank items.
- Settings page with side navigation.
- CI: GitHub Actions builds NSIS `.exe`, `.dmg` and `.AppImage` on every `v*` tag and attaches them to the GitHub Release.
