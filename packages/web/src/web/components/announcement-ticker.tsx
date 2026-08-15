import { Megaphone } from "lucide-react";

/** "#rrggbb" + alpha → "rgba(r,g,b,a)"; passes through non-hex values as-is. */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Scrolling announcement bar pinned to the bottom of the screen. Independent
 * of the live slide state - shows (or stays hidden) regardless of what's
 * live, so it can carry things like "Potluck after service" through the
 * whole gathering. Used on the projector and the /stream overlay; the
 * operator's own small preview thumbnails intentionally skip it.
 */
export function AnnouncementTicker({
  text,
  speed = 22,
  bgColor,
  textColor,
}: {
  text: string;
  /** Seconds for one full loop - lower is faster. */
  speed?: number;
  /** Bar background; null/undefined = near-black. */
  bgColor?: string | null;
  /** Scrolling message color; null/undefined = white. */
  textColor?: string | null;
}) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex items-stretch overflow-hidden backdrop-blur-sm"
      style={{
        height: "clamp(2.4rem, 5.5vh, 4rem)",
        borderTop: "2px solid var(--v-accent)",
        backgroundColor: hexToRgba(bgColor || "#000000", 0.78),
      }}
      role="status"
      aria-live="polite"
    >
      <span className="flex shrink-0 items-center gap-1.5 bg-[var(--v-accent)] px-4 text-[clamp(0.7rem,1.6vh,0.95rem)] font-bold uppercase tracking-wide text-black">
        <Megaphone className="h-[1.1em] w-[1.1em]" /> Announcement
      </span>
      <div className="flex min-w-0 flex-1 items-center overflow-hidden">
        <div className="v-ticker-track" style={{ animationDuration: `${Math.max(6, speed)}s` }}>
          <span
            className="v-ticker-item font-lyric text-[clamp(0.85rem,2.2vh,1.4rem)] font-semibold"
            style={{ color: textColor || "#ffffff" }}
          >
            {trimmed}
          </span>
          <span
            className="v-ticker-item font-lyric text-[clamp(0.85rem,2.2vh,1.4rem)] font-semibold"
            style={{ color: textColor || "#ffffff" }}
            aria-hidden="true"
          >
            {trimmed}
          </span>
        </div>
      </div>
    </div>
  );
}
