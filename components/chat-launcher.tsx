'use client';

import { ChatCircleDots, X } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Chat from '@/components/chat';

/**
 * The assistant, reachable from the landing page without leaving it. A launcher
 * that opens a real panel rather than a link away, because the product is the
 * conversation and making someone navigate to try it loses most of them.
 */
export default function ChatLauncher() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Return focus where it came from, or the keyboard user is stranded.
    launcherRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        close();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      // Keep Tab inside the panel while it is open.
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.querySelector<HTMLElement>('button, input')?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  return (
    <>
      {/* While the sheet is open on a phone it covers the screen and carries its
          own close control, so the floating launcher would sit on the composer. */}
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="assistant-panel"
        className={`fixed bottom-5 right-5 z-40 min-h-14 items-center gap-2.5 rounded-full bg-brand-900 pl-4 pr-5 text-sm font-medium text-white shadow-lift hover:bg-brand-800 active:scale-[0.98] dark:bg-brand-300 dark:text-brand-950 dark:hover:bg-brand-200 ${
          open ? 'hidden sm:flex' : 'flex'
        }`}
      >
        {open ? <X size={20} weight="bold" /> : <ChatCircleDots size={22} weight="fill" />}
        {open ? 'Close' : 'Ask the assistant'}
      </button>

      {/* The panel sits above the launcher rather than padding around it: its
          last element is a footnote, so bottom padding did not stop the
          launcher covering the composer. */}
      {open ? (
        <div
          id="assistant-panel"
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="NexaConnect assistant"
          className="fixed inset-0 z-30 overflow-y-auto bg-white px-3 pb-4 dark:bg-brand-950 sm:inset-auto sm:bottom-[5.25rem] sm:right-5 sm:max-h-[calc(100dvh-7rem)] sm:w-[26.5rem] sm:bg-transparent sm:px-0 sm:pb-0 sm:dark:bg-transparent"
        >
          <div className="flex items-center justify-between py-3 sm:hidden">
            <span className="text-sm font-semibold">NexaConnect assistant</span>
            <button
              type="button"
              onClick={close}
              className="grid h-11 w-11 place-items-center rounded-full text-muted hover:bg-paper dark:hover:bg-white/10"
              aria-label="Close the assistant"
            >
              <X size={20} weight="bold" />
            </button>
          </div>
          <Chat />
        </div>
      ) : null}
    </>
  );
}
