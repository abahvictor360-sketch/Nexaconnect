import { useEffect, useMemo, useState } from "react";
import type { StageDisplayPayload } from "../lib/stage-display";
import { subscribeSnapshot } from "../lib/realtime";
import { useSettings } from "../hooks/use-settings";
import { TimerOverlay } from "../components/timer-overlay";

/**
 * Stage / confidence display for the worship team.
 *
 * Shows the CURRENT slide big, the NEXT slide small, a live clock and any
 * service notes. Runs on a separate device (tablet at the front, monitor
 * facing the platform) and syncs over the server SSE feed at /api/stage/stream.
 *
 * Open at:  <app-url>/#/stage
 */
const IDLE: StageDisplayPayload = {
  status: "idle",
  current: null,
  next: null,
  notes: "",
  mode: "lyrics",
  rev: 0,
};

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function StagePage() {
  const [state, setState] = useState<StageDisplayPayload>(IDLE);
  const now = useClock();
  const settings = useSettings({ refetchInterval: 4000 }).data;

  useEffect(() => {
    document.title = "Vifug Stage Display";
    document.body.style.background = "#000";
    return subscribeSnapshot("stage", (raw) => {
      setState({ ...IDLE, ...(raw as Partial<StageDisplayPayload>) } as StageDisplayPayload);
    });
  }, []);

  const clock = useMemo(
    () => now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    [now],
  );

  const live = state.status === "live" && state.current;
  const blanked = state.status === "blank";

  return (
    <div className="fixed inset-0 flex flex-col bg-black text-white">
      <TimerOverlay timer={settings?.timer} screen="stage" />
      {/* Top bar: reference/title + clock */}
      <header className="flex items-center justify-between gap-4 px-4 py-4 sm:px-8">
        <div className="min-w-0">
          <div className="truncate text-2xl font-semibold text-white/80">
            {state.current?.title || (state.mode === "bible" ? "Scripture" : "Vifug")}
          </div>
          <div className="truncate text-lg text-[color:#ffc233]">
            {state.current?.caption || "-"}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-3xl font-bold tabular-nums sm:text-4xl">{clock}</div>
          <div className="text-sm uppercase tracking-widest text-white/55">
            {live
              ? `Slide ${(state.current!.index ?? 0) + 1} / ${state.current!.count || 1}`
              : blanked
                ? "Blanked"
                : "Standby"}
          </div>
        </div>
      </header>

      {/* CURRENT slide - big */}
      <main className="flex min-h-0 flex-1 items-center justify-center px-4 sm:px-12">
        {blanked ? (
          <div className="text-3xl font-medium text-white/50">● Screen blanked</div>
        ) : live ? (
          // Capped by height as well as width: with more lines per slide, 5vw
          // alone can push the words past the footer on a wide, short screen.
          <div className="w-full text-center">
            {state.current!.lines.map((l, i) => (
              <div key={i} className="font-lyric text-[min(5vw,8vh)] font-bold leading-tight">
                {l}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-3xl font-medium text-white/45 sm:text-4xl">Waiting for live slide…</div>
        )}
      </main>

      {/* NEXT slide + notes */}
      <footer className="grid grid-cols-1 gap-4 border-t border-white/10 px-4 py-4 sm:grid-cols-2 sm:gap-6 sm:px-8 sm:py-5">
        <div className="min-w-0">
          <div className="mb-1 text-sm font-semibold uppercase tracking-widest text-white/55">
            Next
          </div>
          {state.next ? (
            <div className="min-w-0">
              <div className="truncate text-sm text-[color:#ffc233]">{state.next.caption}</div>
              <div className="line-clamp-2 text-2xl font-medium text-white/70">
                {state.next.lines.join(" / ")}
              </div>
            </div>
          ) : (
            <div className="text-2xl text-white/45">End of list</div>
          )}
        </div>
        <div className="min-w-0">
          <div className="mb-1 text-sm font-semibold uppercase tracking-widest text-white/55">
            Notes
          </div>
          <div className="line-clamp-3 whitespace-pre-wrap text-xl text-white/70">
            {state.notes?.trim() ? state.notes : "-"}
          </div>
        </div>
      </footer>
    </div>
  );
}
