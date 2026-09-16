import { useEffect, useRef } from "react";

/**
 * Modal behaviour for the app's overlay panels.
 *
 * The operator screen listens on window for its live shortcuts - Escape
 * clears the output, Space blanks it, the arrows move the live slide - and a
 * panel drawn over the top of it did nothing to stop them. With a deck editor
 * open and focus on one of its buttons, Escape wiped the projector while the
 * editor stayed exactly where it was. The live handler now stands down while
 * any element marked aria-modal is on the page, so the marker this hook puts
 * on a panel is what keeps the room's screen safe, not just a label for
 * screen readers.
 *
 * Beyond that it does what a dialog is expected to: focus moves into the panel
 * when it opens (to the panel itself, not its first control - the first
 * control is usually the close button, and Enter on it would discard an edit),
 * Tab stays inside while it is the topmost one, and focus goes back to
 * whatever opened it on close. Escape is left to each panel, because for an
 * editor holding unsaved words, closing on a stray keypress is the wrong
 * default.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Open dialogs, innermost last - only the top one traps Tab. */
const stack: HTMLElement[] = [];

export function isModalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

export function useDialog<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push(el);

    // A field marked autoFocus has already taken focus by the time this runs.
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || stack[stack.length - 1] !== el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener("keydown", onKey);

    return () => {
      el.removeEventListener("keydown", onKey);
      const i = stack.lastIndexOf(el);
      if (i !== -1) stack.splice(i, 1);
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return {
    ref,
    dialogProps: { role: "dialog", "aria-modal": true, tabIndex: -1 } as const,
  };
}
