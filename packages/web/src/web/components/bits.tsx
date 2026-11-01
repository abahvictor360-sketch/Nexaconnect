import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils";
import { chipClass } from "../lib/sections";

export function SectionChip({ label, type, className }: { label: string; type: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        chipClass(type),
        className,
      )}
    >
      {label}
    </span>
  );
}

/**
 * Peak level as decibels, the way a desk reads it.
 *
 * Silence is negative infinity, not zero, and saying "0.0 dB" when nothing
 * is coming in would read as a hot signal - the exact opposite of the truth.
 */
export function dbLabel(level: number): string {
  if (level <= 0.0005) return "-\u221E dB";
  const db = 20 * Math.log10(Math.min(1, level));
  return `${db <= -60 ? "-60.0" : db.toFixed(1)} dB`;
}

/**
 * The mixer's level meter, drawn the way every audio desk draws one.
 *
 * The whole scale is always visible - green through the working range,
 * amber as it gets close, red at the top - and the part the signal has
 * reached is lit while the rest stays dimmed. A plain single-colour bar
 * tells you there IS sound; this tells you whether it is too quiet, right,
 * or about to clip, which is the question somebody setting a mic actually
 * has.
 *
 * The peak mark holds for a moment and then falls back, because a clip is
 * over in a few milliseconds and a meter that does not hold one is a meter
 * that never shows it.
 */
export function VuMeter({ level, idle }: { level: number; idle?: boolean }) {
  const value = idle ? 0 : Math.max(0, Math.min(1, level));
  const [peak, setPeak] = useState(0);
  const peakAt = useRef(0);

  useEffect(() => {
    if (value >= peak) {
      setPeak(value);
      peakAt.current = Date.now();
      return;
    }
    // Hold for a beat, then slide down rather than snapping, so the eye can
    // follow where it went.
    const t = setInterval(() => {
      if (Date.now() - peakAt.current < 900) return;
      setPeak((p) => {
        const next = p - 0.04;
        return next <= value ? value : next;
      });
    }, 60);
    return () => clearInterval(t);
  }, [value, peak]);

  // Green to about two thirds, amber to the last sixth, red at the top -
  // the proportions a desk uses, so the colours mean what people expect.
  const scale = "linear-gradient(to right, #22c55e 0%, #22c55e 62%, #eab308 62%, #eab308 84%, #ef4444 84%)";
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-[3px] bg-[var(--v-surface-3)]">
      {/* The dimmed scale: always there, so the headroom is visible even in
          silence. */}
      <div className="absolute inset-0 opacity-25" style={{ background: scale }} />
      {/* The lit part, clipped to the level. */}
      <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${value * 100}%` }}>
        <div className="h-full" style={{ width: `${100 / Math.max(value, 0.0001)}%`, background: scale }} />
      </div>
      {peak > 0.01 && (
        <div
          className="absolute inset-y-0 w-[2px] bg-white/85"
          style={{ left: `calc(${Math.min(peak, 1) * 100}% - 1px)` }}
        />
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

export function VButton({
  variant = "subtle",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "danger" | "ghost" | "subtle" | "ok";
  size?: "sm" | "md" | "lg";
}) {
  const variants: Record<string, string> = {
    primary:
      "bg-gradient-to-b from-[var(--v-accent)] to-[var(--v-accent-2)] text-black font-semibold shadow-[0_2px_12px_var(--v-accent-glow)] hover:brightness-110",
    danger:
      "bg-gradient-to-b from-[var(--v-live)] to-[var(--v-live-2)] text-white font-semibold shadow-[0_2px_12px_var(--v-live-glow)] hover:brightness-110",
    ok: "bg-[var(--v-ok)] text-black hover:brightness-110 font-semibold shadow-[0_2px_10px_rgba(47,213,117,0.3)]",
    ghost: "bg-transparent text-[var(--v-text-dim)] hover:bg-[var(--v-surface-3)] hover:text-[var(--v-text)]",
    subtle:
      "bg-[var(--v-surface-2)] text-[var(--v-text)] hover:bg-[var(--v-surface-3)] hover:border-[var(--v-text-faint)] border border-[var(--v-border)]",
  };
  const sizes: Record<string, string> = {
    sm: "h-8 px-2.5 text-xs rounded-lg gap-1.5",
    md: "h-9 px-3.5 text-sm rounded-lg gap-2",
    lg: "h-12 px-5 text-base rounded-xl gap-2",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center transition-[transform,background-color,border-color,color,box-shadow,filter,opacity] duration-150 ease-out active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none select-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
