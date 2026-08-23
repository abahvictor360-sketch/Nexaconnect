/** Shown the instant a rail link is clicked, so navigation never looks dead. */
export default function Loading() {
  return (
    <div className="flex flex-col lg:h-dvh">
      <div className="space-y-2.5 border-b border-rule bg-card px-4 py-3">
        <div className="h-4 w-32 animate-pulse rounded bg-rule" />
        <div className="h-3 w-56 animate-pulse rounded bg-rule" />
      </div>
      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)_21rem]">
        <div className="space-y-3 border-r border-rule bg-card p-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex gap-2.5">
              <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-rule" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-24 animate-pulse rounded bg-rule" />
                <div className="h-3 w-full animate-pulse rounded bg-rule" />
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-3 p-4">
          <div className="h-14 animate-pulse rounded-2xl bg-rule/70" />
          <div className="ml-auto h-20 w-3/4 animate-pulse rounded-bubble bg-rule/70" />
          <div className="h-28 w-4/5 animate-pulse rounded-bubble bg-rule/70" />
        </div>
      </div>
      <p className="sr-only" role="status">
        Loading the triage queue
      </p>
    </div>
  );
}
