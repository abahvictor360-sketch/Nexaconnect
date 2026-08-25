import Link from 'next/link';

/** One line at every width, 64px tall. */
export default function LandingNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-rule/70 bg-white/85 backdrop-blur dark:border-white/10 dark:bg-brand-950/85">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-lg bg-brand-700 text-sm font-bold text-white dark:bg-brand-300 dark:text-brand-950"
          >
            N
          </span>
          NexaConnect
        </Link>

        <nav aria-label="Sections" className="ml-auto hidden items-center gap-6 text-sm md:flex">
          <a href="#how" className="text-muted hover:text-ink dark:text-brand-200 dark:hover:text-white">
            How it works
          </a>
          <a href="#grounding" className="text-muted hover:text-ink dark:text-brand-200 dark:hover:text-white">
            Grounding
          </a>
          <a href="#desks" className="text-muted hover:text-ink dark:text-brand-200 dark:hover:text-white">
            Escalation
          </a>
        </nav>

        <Link
          href="/agent"
          className="ml-auto flex min-h-11 items-center rounded-full border border-rule px-4 text-sm font-medium hover:bg-accent-soft md:ml-0 dark:border-white/15 dark:hover:bg-white/10"
        >
          Agent console
        </Link>
      </div>
    </header>
  );
}
