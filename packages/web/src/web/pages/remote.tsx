import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft, ChevronRight, Square, Ban, SendHorizontal, Wifi, WifiOff,
  Music, BookOpen, MonitorPlay, Camera, SlidersHorizontal, Loader2, Film, Check, Upload,
} from "lucide-react";
import type { LiveState } from "../lib/live-bus";
import { IDLE_STATE, DEFAULT_THEME } from "../lib/live-bus";
import { subscribeSnapshot } from "../lib/realtime";
import { uploadMediaFile } from "../hooks/use-media";

/**
 * Phone / tablet remote.
 *
 * Sends fire-and-forget commands to the operator via /api/remote/command; the
 * operator (single source of truth, manual override always wins) executes them.
 * Also subscribes to the live SSE feed so the remote shows what is on screen.
 *
 * Beyond next/prev/blank/clear, the remote can also SELECT a song, a
 * scripture reference, a presentation deck, or a photo just taken/picked on
 * the phone - every one of those only cues it into the operator's Preview,
 * exactly like clicking it in the app itself. GO LIVE on either the remote or
 * the operator's own screen is still the only thing that reaches the
 * congregation, so a phone in an usher's pocket can't broadcast by accident.
 *
 * Open on a phone on the same network at:  <app-url>/#/remote
 */
const PIN_KEY = "vifug:remote-pin";

type RemoteCommandBody = {
  action: string;
  pin: string | null;
  index?: number;
  songId?: string;
  ref?: string;
  versionId?: string;
  presentationId?: string;
  mediaId?: string;
};

async function sendCommand(body: RemoteCommandBody) {
  try {
    await fetch("/api/remote/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* ignore */
  }
}

/**
 * PIN entry. The operator app shows the current PIN next to the Remote URL;
 * once accepted it is remembered on the device so a phone taped to the desk
 * doesn't have to be unlocked again every service.
 */
function PinGate({ onUnlock }: { onUnlock: (pin: string) => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  const submit = async () => {
    setChecking(true);
    setError(false);
    try {
      const res = await fetch("/api/remote/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = (await res.json()) as { ok: boolean };
      if (data.ok) {
        localStorage.setItem(PIN_KEY, pin);
        onUnlock(pin);
      } else {
        setError(true);
        setPin("");
      }
    } catch {
      setError(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="fixed inset-0 grid place-items-center p-6 text-white" style={{ background: "#0b0c12" }}>
      <div className="w-full max-w-xs text-center">
        <h1 className="mb-1 text-xl font-bold">Vifug Remote</h1>
        <p className="mb-5 text-sm text-white/50">
          Enter the PIN shown in the app under Settings › Outputs &amp; companion screens.
        </p>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          onKeyDown={(e) => e.key === "Enter" && pin && submit()}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="••••"
          aria-label="Remote PIN"
          className={`w-full rounded-2xl border-2 bg-white/5 py-4 text-center text-3xl tracking-[0.4em] outline-none ${
            error ? "border-red-500" : "border-white/15 focus:border-emerald-500"
          }`}
        />
        {error && <p className="mt-2 text-sm text-red-400">That PIN didn’t work - try again.</p>}
        <button
          onClick={submit}
          disabled={!pin || checking}
          className="mt-4 w-full rounded-2xl bg-gradient-to-b from-emerald-500 to-emerald-700 py-4 text-lg font-bold disabled:opacity-40"
        >
          {checking ? "Checking…" : "Unlock"}
        </button>
      </div>
    </div>
  );
}

type SongListItem = { id: string; title: string; authors?: string[] | null };
type PresentationListItem = { id: string; title: string; slideCount: number };

/** Search + tap a song to cue it into the operator's Lyrics preview. */
function SongsTab({ onSelect }: { onSelect: (songId: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SongListItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/songs?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { songs: SongListItem[] };
        if (!cancelled) setResults(data.songs ?? []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search songs…"
        className="mb-3 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-base outline-none focus:border-emerald-500"
      />
      <div className="v-scroll min-h-0 flex-1 space-y-2 overflow-y-auto">
        {loading && <p className="py-6 text-center text-sm text-white/40">Searching…</p>}
        {!loading && results?.length === 0 && <p className="py-6 text-center text-sm text-white/40">No songs found.</p>}
        {results?.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left active:scale-[0.98]"
          >
            <span className="font-medium">{s.title}</span>
            {s.authors && s.authors.length > 0 && <span className="text-xs text-white/40">{s.authors[0]}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Free-text scripture reference, cued into the operator's Bible preview. */
function BibleTab({ onSelect }: { onSelect: (ref: string) => void }) {
  const [ref, setRef] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <input
        value={ref}
        onChange={(e) => setRef(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && ref.trim() && onSelect(ref.trim())}
        placeholder="e.g. John 3:16"
        className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-base outline-none focus:border-emerald-500"
      />
      <button
        onClick={() => ref.trim() && onSelect(ref.trim())}
        disabled={!ref.trim()}
        className="rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-700 py-3 text-base font-semibold disabled:opacity-40"
      >
        Select passage
      </button>
      <p className="text-center text-xs text-white/30">Cues it into the operator's Bible preview - same as typing it in the app.</p>
    </div>
  );
}

/** Tap a deck to cue it into the operator's Presentations preview. */
function DecksTab({ onSelect }: { onSelect: (presentationId: string) => void }) {
  const [decks, setDecks] = useState<PresentationListItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/presentations");
        const data = (await res.json()) as { presentations: PresentationListItem[] };
        if (!cancelled) setDecks(data.presentations ?? []);
      } catch {
        if (!cancelled) setDecks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="v-scroll min-h-0 flex-1 space-y-2 overflow-y-auto">
      {decks === null && <p className="py-6 text-center text-sm text-white/40">Loading…</p>}
      {decks?.length === 0 && <p className="py-6 text-center text-sm text-white/40">No presentations yet.</p>}
      {decks?.map((d) => (
        <button
          key={d.id}
          onClick={() => onSelect(d.id)}
          className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left active:scale-[0.98]"
        >
          <span className="font-medium">{d.title}</span>
          <span className="text-xs text-white/40">{d.slideCount} slides</span>
        </button>
      ))}
    </div>
  );
}

type RemoteMedia = { id: string; type: string; url: string };

/**
 * The media library, and a way to add to it from the phone.
 *
 * Taking a photo was already possible, but everything already in the library
 * was only reachable at the operator's machine - so anyone holding the remote
 * could add a picture and not cue the one they wanted. Both belong here: the
 * library first, since choosing something that exists is the common case.
 *
 * Deck pages imported from a PDF are absent because the server keeps them out
 * of the library listing; they belong to their presentation, and a remote
 * showing forty slide images would be unusable.
 */
function PhotoTab({ onUploaded }: { onUploaded: (mediaId: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<RemoteMedia[] | null>(null);
  const [cued, setCued] = useState<string | null>(null);

  // Loaded once when the tab opens, and again after an upload so the new
  // picture appears alongside the rest.
  const loadLibrary = useCallback(async () => {
    try {
      const res = await fetch("/api/media");
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { media: RemoteMedia[] };
      setLibrary((data.media ?? []).filter((m) => m.type === "image" || m.type === "video"));
    } catch {
      setLibrary([]);
    }
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      /**
       * The same path the operator's own uploads take.
       *
       * This used to POST to /api/media/upload directly, which skipped the
       * presigned route entirely - so a phone sent every file through the
       * server even where the bucket would have taken it straight, and hit the
       * request body limit on anything large for no reason.
       */
      const media = await uploadMediaFile(file);
      onUploaded(media.id);
      void loadLibrary();
    } catch (err) {
      /**
       * Say what actually failed.
       *
       * The old message blamed the Wi-Fi, which was fair when the remote only
       * worked on the LAN and is now simply wrong - the phone may be on mobile
       * data on the other side of the country. It also threw the server's
       * explanation away, so a bucket that refused the upload, a file too
       * large, and a genuinely dropped connection all read identically.
       */
      setError((err as Error)?.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const cue = (id: string) => {
    setCued(id);
    onUploaded(id);
    // A tick of confirmation, since the result appears on a screen the person
    // holding the phone may not be looking at.
    setTimeout(() => setCued((c) => (c === id ? null : c)), 1500);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Two separate buttons, not one: an input carrying `capture` opens the
          camera and ONLY the camera on a phone, with no way through to the
          gallery - so uploading a picture already on the phone (the common
          case) was impossible. The camera stays available as its own button. */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-700 py-3 text-base font-semibold disabled:opacity-40"
        >
          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
          {uploading ? "Uploading…" : "Gallery / Files"}
        </button>
        {/* Labelled, not icon-only: an unlabelled camera button next to an
            upload button is easy to hit by mistake and then read as "it only
            ever opens the camera". */}
        <button
          onClick={() => cameraRef.current?.click()}
          disabled={uploading}
          className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 py-3 text-base font-semibold disabled:opacity-40"
        >
          <Camera className="h-5 w-5" /> Camera
        </button>
      </div>
      {/* No `accept` at all on this one. Some Android file pickers narrow
          themselves to the camera-backed providers as soon as an image/video
          filter is present, which is the very thing being avoided here; the
          server decides what it will store anyway. */}
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
      {error && <p className="mb-2 text-center text-sm text-red-400">{error}</p>}

      <p className="mb-2 text-xs uppercase tracking-wide text-white/30">In the media library</p>
      <div className="v-scroll min-h-0 flex-1 overflow-y-auto">
        {library === null && <p className="py-6 text-center text-sm text-white/40">Loading…</p>}
        {library?.length === 0 && (
          <p className="py-6 text-center text-sm text-white/40">
            Nothing in the library yet - add a picture or video on the operator's machine, or take
            a photo above.
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          {library?.map((m) => (
            <button
              key={m.id}
              onClick={() => cue(m.id)}
              className={`relative aspect-video overflow-hidden rounded-lg border-2 bg-black active:scale-[0.97] ${
                cued === m.id ? "border-emerald-500" : "border-white/10"
              }`}
            >
              {m.type === "video" ? (
                <>
                  <video src={m.url} muted playsInline className="h-full w-full object-cover" />
                  <Film className="absolute right-1 top-1 h-3.5 w-3.5 text-white/80" />
                </>
              ) : (
                <img src={m.url} alt="" loading="lazy" className="h-full w-full object-cover" />
              )}
              {cued === m.id && (
                <span className="absolute inset-0 grid place-items-center bg-emerald-600/70">
                  <Check className="h-6 w-6" />
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <p className="pt-2 text-center text-xs text-white/30">
        Tapping one cues it into the operator's Preview - GO LIVE still puts it on screen.
      </p>
    </div>
  );
}

type PickerTab = "control" | "songs" | "bible" | "decks" | "photo";

export default function RemotePage() {
  const [state, setState] = useState<LiveState>(IDLE_STATE);
  const [online, setOnline] = useState(false);
  // null = still checking whether this install requires a PIN.
  const [locked, setLocked] = useState<boolean | null>(null);
  const [pin, setPin] = useState<string | null>(() => localStorage.getItem(PIN_KEY));
  const [tab, setTab] = useState<PickerTab>("control");
  const [justSent, setJustSent] = useState<string | null>(null);

  // Re-validate any stored PIN on load: it may have been changed in the app
  // since this phone last connected, and a silently-dead remote is worse than
  // one that asks again.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/remote/auth");
        const { requirePin } = (await res.json()) as { requirePin: boolean };
        if (cancelled) return;
        if (!requirePin) {
          setLocked(false);
          return;
        }
        const stored = localStorage.getItem(PIN_KEY);
        if (!stored) {
          setLocked(true);
          return;
        }
        const check = await fetch("/api/remote/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: stored }),
        });
        const ok = ((await check.json()) as { ok: boolean }).ok;
        if (cancelled) return;
        if (ok) {
          setPin(stored);
          setLocked(false);
        } else {
          localStorage.removeItem(PIN_KEY);
          setLocked(true);
        }
      } catch {
        if (!cancelled) setLocked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.title = "Vifug Remote";
    // Any delivered frame proves the round trip, on either transport; the
    // helper retries internally, so an error is never surfaced as offline
    // until a frame stops arriving.
    const unsubscribe = subscribeSnapshot("live", (frame) => {
      setOnline(true);
      const raw = frame as Partial<LiveState>;
      setState({ ...IDLE_STATE, ...raw, theme: { ...DEFAULT_THEME, ...(raw.theme ?? {}) } } as LiveState);
    });
    return unsubscribe;
  }, []);

  const send = (action: string) => sendCommand({ action, pin });

  const flashSent = (label: string) => {
    setJustSent(label);
    setTab("control");
    setTimeout(() => setJustSent(null), 2500);
  };

  const Btn = ({
    onClick,
    children,
    className = "",
  }: {
    onClick: () => void;
    children: React.ReactNode;
    className?: string;
  }) => (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-2xl font-semibold text-white transition-transform active:scale-95 ${className}`}
    >
      {children}
    </button>
  );

  if (locked === null) {
    return (
      <div className="fixed inset-0 grid place-items-center text-white/40" style={{ background: "#0b0c12" }}>
        Connecting…
      </div>
    );
  }
  if (locked) {
    return (
      <PinGate
        onUnlock={(p) => {
          setPin(p);
          setLocked(false);
        }}
      />
    );
  }

  const TABS: { id: PickerTab; label: string; icon: typeof Music }[] = [
    { id: "control", label: "Control", icon: SlidersHorizontal },
    { id: "songs", label: "Songs", icon: Music },
    { id: "bible", label: "Bible", icon: BookOpen },
    { id: "decks", label: "Decks", icon: MonitorPlay },
    { id: "photo", label: "Media", icon: Camera },
  ];

  return (
    <div
      className="fixed inset-0 flex flex-col p-4 text-white"
      style={{
        background:
          "radial-gradient(800px 400px at 50% -10%, rgba(99,102,241,0.12), transparent 60%), #0b0c12",
      }}
    >
      {/* Status */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-lg font-bold">Vifug Remote</span>
        <span
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
            online ? "bg-emerald-500/15 text-emerald-400" : "bg-white/10 text-white/40"
          }`}
        >
          {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {online ? "Connected" : "Offline"}
        </span>
      </div>

      {/* Live preview */}
      <div className="mb-3 rounded-2xl border border-white/10 bg-black p-4">
        <div className="mb-1 text-xs uppercase tracking-widest text-[color:#ffc233]">
          {state.status === "live"
            ? state.sectionLabel || "Live"
            : state.status === "blank"
              ? "Blanked"
              : "Nothing live"}
        </div>
        <div className="min-h-[4.5rem]">
          {state.status === "live" ? (
            state.sourceLines.map((l, i) => (
              <div key={i} className="font-lyric text-xl font-semibold leading-snug">
                {l}
              </div>
            ))
          ) : (
            <div className="text-white/30"> - </div>
          )}
        </div>
        {state.slideCount > 0 && state.status === "live" && (
          <div className="mt-2 text-xs text-white/40">
            Slide {state.slideIndex + 1} / {state.slideCount}
          </div>
        )}
      </div>

      {justSent && (
        <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-center text-sm text-emerald-300">
          {justSent} sent to Preview - press GO LIVE when ready.
        </div>
      )}

      {/* Body: control pad or a picker */}
      <div className="v-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
        {tab === "control" ? (
          <div className="grid flex-1 grid-cols-2 gap-3">
            <Btn onClick={() => send("prev")} className="bg-white/10 text-2xl">
              <ChevronLeft className="h-7 w-7" /> Prev
            </Btn>
            <Btn onClick={() => send("next")} className="bg-white/10 text-2xl">
              Next <ChevronRight className="h-7 w-7" />
            </Btn>
            <Btn
              onClick={() => send("sendLive")}
              className="col-span-2 bg-gradient-to-b from-emerald-500 to-emerald-700 py-6 text-2xl font-bold shadow-[0_4px_20px_rgba(16,185,129,0.35)]"
            >
              <SendHorizontal className="h-7 w-7" /> GO LIVE
            </Btn>
            <Btn onClick={() => send("blank")} className="bg-gradient-to-b from-blue-500 to-blue-700 py-6 text-xl shadow-[0_4px_16px_rgba(59,130,246,0.3)]">
              <Square className="h-6 w-6" /> Blank
            </Btn>
            <Btn onClick={() => send("clear")} className="bg-gradient-to-b from-red-500 to-red-700 py-6 text-xl shadow-[0_4px_16px_rgba(239,68,68,0.3)]">
              <Ban className="h-6 w-6" /> Clear
            </Btn>
          </div>
        ) : tab === "songs" ? (
          <SongsTab
            onSelect={(songId) => {
              sendCommand({ action: "selectSong", pin, songId });
              flashSent("Song");
            }}
          />
        ) : tab === "bible" ? (
          <BibleTab
            onSelect={(ref) => {
              sendCommand({ action: "selectScripture", pin, ref });
              flashSent("Passage");
            }}
          />
        ) : tab === "decks" ? (
          <DecksTab
            onSelect={(presentationId) => {
              sendCommand({ action: "selectPresentation", pin, presentationId });
              flashSent("Presentation");
            }}
          />
        ) : (
          <PhotoTab
            onUploaded={(mediaId) => {
              sendCommand({ action: "cueMedia", pin, mediaId });
              flashSent("Photo");
            }}
          />
        )}
      </div>

      {/* Tab bar */}
      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex flex-col items-center gap-1 rounded-xl py-2 text-[12px] ${
                active ? "bg-white/15 text-white" : "text-white/40"
              }`}
            >
              <Icon className="h-5 w-5" />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
