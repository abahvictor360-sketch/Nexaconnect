/** Shown the instant a rail link is clicked, so navigation never looks dead. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="space-y-2">
        <div className="h-5 w-28 animate-pulse rounded bg-rule" />
        <div className="h-3 w-64 animate-pulse rounded bg-rule" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-2xl border border-rule bg-card" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-64 animate-pulse rounded-2xl border border-rule bg-card" />
        ))}
      </div>
      <p className="sr-only" role="status">
        Loading analytics
      </p>
    </div>
  );
}
