import { ChartCard } from '@/components/chart-card';
import { CHART_COLORS, STATUS_STEPS } from '@/components/chart-tokens';
import { RankedBars, type Datum } from '@/components/charts';
import { EmptyState, StatTile } from '@/components/primitives';
import SeedButton from '@/components/seed-button';
import { SystemStatus } from '@/components/system-status';
import { computeKpis } from '@/lib/analytics';
import { listTickets } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function Analytics() {
  const tickets = await listTickets({ limit: 500 });
  const kpis = computeKpis(tickets);

  if (kpis.total === 0) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
        <div className="mt-3">
          <SystemStatus />
        </div>
        <div className="mt-4">
          <EmptyState title="No cases yet">
            Every number here is computed from real tickets, so there is nothing to show until the
            assistant has handled something. Load the labelled demo set to see it populated.
            <SeedButton />
          </EmptyState>
        </div>
      </div>
    );
  }

  const ruleData: Datum[] = kpis.byRule.map((slice) => ({
    key: slice.key,
    count: slice.count,
    share: slice.share,
    description: slice.description,
  }));

  const categoryData: Datum[] = [...kpis.byCategory].sort((a, b) => b.count - a.count);
  const sentimentData: Datum[] = kpis.bySentiment;
  const urgencyData: Datum[] = kpis.byUrgency;
  const deskData: Datum[] = [...kpis.byDesk].sort((a, b) => b.count - a.count);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <header className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted">
            Across {kpis.total} case{kpis.total === 1 ? '' : 's'} handled by the assistant.
          </p>
        </div>
        <SystemStatus />
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Cases handled" value={String(kpis.total)} />
        <StatTile
          label="Auto-resolution rate"
          value={`${kpis.autoResolutionRate}%`}
          hint={`${kpis.total - kpis.escalated} answered without a human`}
        />
        <StatTile
          label="Escalation rate"
          value={`${kpis.escalationRate}%`}
          hint={`${kpis.escalated} routed to a desk`}
        />
        <StatTile
          label="Grounded answers"
          value={`${kpis.groundedRate}%`}
          hint="cited at least one policy section"
        />
        <StatTile
          label="Average latency"
          value={`${(kpis.avgLatencyMs / 1000).toFixed(1)}s`}
          hint={`p95 ${(kpis.p95LatencyMs / 1000).toFixed(1)}s`}
        />
        <StatTile label="Average confidence" value={String(kpis.avgConfidence)} />
        <StatTile
          label="Escalations closed"
          value={`${kpis.agentResolvedRate}%`}
          hint="by an agent in the console"
        />
        <StatTile
          label="Customer rating"
          value={kpis.ratedCount === 0 ? '—' : `${kpis.avgSatisfaction}/4`}
          hint={
            kpis.ratedCount === 0
              ? 'no ratings yet'
              : `${kpis.ratedCount} rated at the end of a chat`
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Escalation rate by rule"
          caption="How often each deterministic rule fired. A case can fire several."
          data={ruleData}
          unitLabel="Rule"
        >
          <RankedBars data={ruleData} colors={CHART_COLORS.alert} labelWidth={128} />
        </ChartCard>

        <ChartCard
          title="Category mix"
          caption="What customers are actually contacting us about."
          data={categoryData}
          unitLabel="Category"
        >
          <RankedBars data={categoryData} colors={CHART_COLORS.accent} labelWidth={104} />
        </ChartCard>

        <ChartCard
          title="Sentiment distribution"
          caption="Calm to hostile, on the same four steps the queue uses."
          data={sentimentData}
          unitLabel="Sentiment"
        >
          <RankedBars data={sentimentData} colors={STATUS_STEPS} labelWidth={80} />
        </ChartCard>

        <ChartCard
          title="Urgency distribution"
          caption="After the rule engine applied its urgency floors."
          data={urgencyData}
          unitLabel="Urgency"
        >
          <RankedBars data={urgencyData} colors={STATUS_STEPS} labelWidth={80} />
        </ChartCard>

        <ChartCard
          className="lg:col-span-2"
          title="Where cases went"
          caption="The desk each case was routed to, or the assistant when nothing fired."
          data={deskData}
          unitLabel="Desk"
        >
          <RankedBars data={deskData} colors={CHART_COLORS.accent} labelWidth={150} />
        </ChartCard>
      </div>
    </div>
  );
}
