/**
 * Operator keyboard shortcuts.
 *
 * Only the six controls an operator actually touches mid-service are
 * rebindable. A binding is stored as a normalised combo string - modifiers in
 * a fixed order, then the key: "ArrowRight", "Space", "Ctrl+Shift+B", "F9".
 * Fixed order matters: it makes bindings comparable with ===, so matching a
 * keypress is a set lookup rather than per-modifier comparison.
 */

export type ShortcutAction = "next" | "prev" | "goLive" | "blank" | "clear" | "projector";

export const SHORTCUT_ACTIONS: { id: ShortcutAction; label: string; hint: string }[] = [
  { id: "next", label: "Next slide", hint: "Advance the service" },
  { id: "prev", label: "Previous slide", hint: "Step back" },
  { id: "goLive", label: "Go live", hint: "Push the cued slide to the screen" },
  { id: "blank", label: "Blank screen", hint: "Hide the text, keep the background" },
  { id: "clear", label: "Clear screen", hint: "Take everything off the output" },
  { id: "projector", label: "Toggle projector", hint: "Open or close the output window" },
];

/**
 * Defaults match what the app has always used, so an upgrade changes nothing.
 * Several bindings per action because operators reach for different keys -
 * arrows on a keyboard, PageUp/PageDown on a presenter clicker.
 */
export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string[]> = {
  next: ["ArrowRight", "ArrowDown", "PageDown"],
  prev: ["ArrowLeft", "ArrowUp", "PageUp"],
  goLive: ["Enter"],
  blank: ["Space"],
  clear: ["Escape"],
  // Not bound historically; F9 avoids F5/Ctrl+R, which Electron's View menu
  // already takes for reload.
  projector: ["F9"],
};

/** Space arrives as " " - give it a name so it survives storage and display. */
function normaliseKey(key: string): string {
  if (key === " " || key === "Spacebar") return "Space";
  // Single letters differ by shift state; store the canonical uppercase form
  // and let the Shift modifier carry the distinction.
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/** Normalised combo for a keypress, or null for a bare modifier press. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (e.key === "Control" || e.key === "Shift" || e.key === "Alt" || e.key === "Meta") return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  parts.push(normaliseKey(e.key));
  return parts.join("+");
}

/** Human-facing label, e.g. "Ctrl+Shift+B" → "Ctrl ⇧ B" is overkill; keep it literal. */
export function formatCombo(combo: string): string {
  return combo
    .split("+")
    .map((p) => (p === "ArrowRight" ? "→" : p === "ArrowLeft" ? "←" : p === "ArrowUp" ? "↑" : p === "ArrowDown" ? "↓" : p))
    .join(" + ");
}

/** Saved bindings layered over the defaults (per action, not wholesale). */
export function resolveShortcuts(saved?: Record<string, string[]> | null): Record<ShortcutAction, string[]> {
  const out = { ...DEFAULT_SHORTCUTS };
  if (!saved) return out;
  for (const { id } of SHORTCUT_ACTIONS) {
    const bindings = saved[id];
    // An explicitly empty array means "unbound" and must not fall back to the
    // default, so only a missing key inherits.
    if (Array.isArray(bindings)) out[id] = bindings;
  }
  return out;
}

/** Which action a keypress triggers, if any. */
export function matchAction(
  e: KeyboardEvent,
  shortcuts: Record<ShortcutAction, string[]>,
): ShortcutAction | null {
  const combo = comboFromEvent(e);
  if (!combo) return null;
  for (const { id } of SHORTCUT_ACTIONS) {
    if (shortcuts[id]?.includes(combo)) return id;
  }
  return null;
}

/** Actions already using a combo - used to warn before saving a clash. */
export function conflictsFor(
  combo: string,
  shortcuts: Record<ShortcutAction, string[]>,
  except: ShortcutAction,
): ShortcutAction[] {
  return SHORTCUT_ACTIONS.filter((a) => a.id !== except && shortcuts[a.id]?.includes(combo)).map((a) => a.id);
}
