import type { Datum } from './charts';

/**
 * Every chart ships with the same table underneath it, so the numbers are
 * reachable without reading colour or hovering a mark.
 */
export function ChartCard({
  title,
  caption,
  data,
  unitLabel,
  className = '',
  children,
}: {
  title: string;
  caption: string;
  data: Datum[];
  unitLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`rounded-xl border border-rule bg-card p-4 shadow-card ${className}`}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-0.5 text-xs text-muted">{caption}</p>
      <div className="mt-3">{children}</div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-muted">View as table</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="text-muted">
              <th scope="col" className="py-1 font-medium">
                {unitLabel}
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Cases
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((datum) => (
              <tr key={datum.key} className="border-t border-rule">
                <th scope="row" className="py-1 font-normal">
                  {datum.key}
                </th>
                <td className="py-1 text-right tabular-nums">{datum.count}</td>
                <td className="py-1 text-right tabular-nums text-muted">{datum.share}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
