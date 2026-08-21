import { cn } from "../lib/utils";
import { chipClass } from "../lib/sections";

export function SectionChip({ label, type, className }: { label: string; type: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        chipClass(type),
        className,
      )}
    >
      {label}
    </span>
  );
}

/** Horizontal audio level bar - shared by the mixer's mic and media channels. */
export function LevelMeter({ level, idle }: { level: number; idle?: boolean }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-[var(--v-surface-3)]">
      <div
        className="h-full rounded-full transition-[width] duration-75"
        style={{
          width: `${Math.round(Math.max(0, Math.min(1, level)) * 100)}%`,
          background: idle
            ? "var(--v-text-faint)"
            : level > 0.85
              ? "#ef4444"
              : level > 0.6
                ? "#f59e0b"
                : "var(--v-accent)",
        }}
      />
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
        "inline-flex items-center justify-center transition-all duration-150 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none select-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
