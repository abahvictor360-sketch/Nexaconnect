import { useEffect, useState } from "react";
import {
  ChevronLeft, ChevronRight, Square, Ban, SendHorizontal, Wifi, WifiOff,
} from "lucide-react";
import type { LiveState } from "../lib/live-bus";
import { IDLE_STATE, DEFAULT_THEME } from "../lib/live-bus";

/**
 * Phone / tablet remote.
 *
 * Sends fire-and-forget commands to the operator via /api/remote/command; the
 * operator (single source of truth, manual override always wins) executes them.
 * Also subscribes to the live SSE feed so the remote shows what is on screen.
 *
 * Open on a phone on the same network at:  <app-url>/#/remote
 */
const PIN_KEY = "vifug:remote-pin";

async function sendCommand(action: string, pin: string | null) {
  try {
    await fetch("/api/remote/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, pin }),
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
        {error && <p className="mt-2 text-sm text-red-400">That PIN didn’t work — try again.</p>}
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

export default function RemotePage() {
  const [state, setState] = useState<LiveState>(IDLE_STATE);
  const [online, setOnline] = useState(false);
  // null = still checking whether this install requires a PIN.
  const [locked, setLocked] = useState<boolean | null>(null);
  const [pin, setPin] = useState<string | null>(() => localStorage.getItem(PIN_KEY));

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
    let es: EventSource | null = null;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      es = new EventSource("/api/live/stream");
      es.addEventListener("live", (e) => {
        setOnline(true);
        try {
          const raw = JSON.parse((e as MessageEvent).data) as Partial<LiveState>;
          setState({ ...IDLE_STATE, ...raw, theme: { ...DEFAULT_THEME, ...(raw.theme ?? {}) } } as LiveState);
        } catch {
          /* ignore */
        }
      });
      es.onerror = () => {
        setOnline(false);
        es?.close();
        if (!stopped) setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      stopped = true;
      es?.close();
    };
  }, []);

  const send = (action: string) => sendCommand(action, pin);

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
      <div className="mb-4 rounded-2xl border border-white/10 bg-black p-4">
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
            <div className="text-white/30">—</div>
          )}
        </div>
        {state.slideCount > 0 && state.status === "live" && (
          <div className="mt-2 text-xs text-white/40">
            Slide {state.slideIndex + 1} / {state.slideCount}
          </div>
        )}
      </div>

      {/* Controls */}
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

      <p className="mt-3 text-center text-xs text-white/30">
        Prev / Next cue slides · Send pushes preview to live
      </p>
    </div>
  );
}
