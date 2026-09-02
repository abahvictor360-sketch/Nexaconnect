import { useServerNow } from "../hooks/use-server-clock";
import {
  formatTimer,
  timerMs,
  timerPhase,
  timerVisibleOn,
  type ServiceTimer,
  type TimerScreens,
} from "../lib/timer";

/**
 * Sized against the screen it is drawn on, or against its own box when that
 * box is a scaled-down copy of a screen - the operator's Live thumbnail. The
 * same swap the slides make, and for the same reason: 7vmin inside a 300px
 * preview is the viewport's 7%, which would put a countdown across the whole
 * thumbnail and tell the operator nothing about how it will actually look.
 */
const SIZES: Record<ServiceTimer["size"], [string, string]> = {
  small: ["clamp(20px, 4vmin, 46px)", "4cqmin"],
  medium: ["clamp(28px, 7vmin, 80px)", "7cqmin"],
  large: ["clamp(38px, 11vmin, 130px)", "11cqmin"],
};

const CORNERS: Record<ServiceTimer["position"], React.CSSProperties> = {
  "top-left": { top: "4%", left: "4%" },
  "top-right": { top: "4%", right: "4%" },
  "bottom-left": { bottom: "8%", left: "4%" },
  "bottom-right": { bottom: "8%", right: "4%" },
  center: { top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center" },
};

/**
 * The timer as every screen draws it.
 *
 * One component for the projector, the stream overlay and the stage display,
 * for the same reason the announcement bar is shared: a countdown that reads
 * 0:30 on the stage monitor and 0:27 on the projector is worse than useless to
 * the person watching both.
 *
 * It ticks locally off a server-corrected clock rather than waiting to be told
 * the time - see lib/timer.ts.
 */
export function TimerOverlay({
  timer,
  screen,
  scale,
}: {
  timer: ServiceTimer | null | undefined;
  screen: keyof TimerScreens;
  /** Drawn inside a scaled preview of a screen rather than on one. */
  scale?: boolean;
}) {
  const visible = timerVisibleOn(timer, screen);
  // The hook must run every render, so the interval is gated rather than the
  // call: a hidden timer costs nothing but does not break the hook order.
  const now = useServerNow(visible);
  if (!visible || !timer) return null;

  const ms = timerMs(timer, now);
  const phase = timerPhase(timer, ms);
  const color = phase === "over" ? "#ff5a5a" : phase === "warn" ? "#f4b740" : timer.color;
  const size = SIZES[timer.size][scale ? 1 : 0];

  return (
    <div
      style={{
        position: "absolute",
        ...CORNERS[timer.position],
        zIndex: 40,
        pointerEvents: "none",
        // Readable over a photo or video without a panel behind it.
        textShadow: "0 2px 14px rgba(0,0,0,.85), 0 0 3px rgba(0,0,0,.9)",
        lineHeight: 1.05,
      }}
    >
      {timer.label ? (
        <div
          style={{
            fontSize: `calc(${size} * 0.3)`,
            fontWeight: 600,
            letterSpacing: ".04em",
            textTransform: "uppercase",
            color,
            opacity: 0.85,
            marginBottom: "0.15em",
          }}
        >
          {timer.label}
        </div>
      ) : null}
      <div
        style={{
          fontSize: size,
          fontWeight: 800,
          color,
          fontVariantNumeric: "tabular-nums",
          // Tabular figures alone are not enough at display sizes - without a
          // mono stack the digits still shuffle as the seconds change.
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        }}
      >
        {formatTimer(ms)}
      </div>
    </div>
  );
}
