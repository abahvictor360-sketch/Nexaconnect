'use client';

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { CHART_INK as INK, CHART_MUTED as MUTED, CHART_RULE as RULE } from './chart-tokens';

export interface Datum {
  key: string;
  count: number;
  share: number;
  description?: string;
}

function ChartTooltip({
  active,
  payload,
  unit,
}: {
  active?: boolean;
  payload?: { payload: Datum }[];
  unit: string;
}) {
  if (!active || !payload?.length) return null;
  const datum = payload[0].payload;
  return (
    <div className="max-w-xs rounded border border-rule bg-card px-2.5 py-1.5 text-xs shadow-card">
      <p className="font-medium">{datum.key}</p>
      <p className="text-muted">
        {datum.count} {unit}
        {datum.count === 1 ? '' : 's'} · {datum.share}% of all cases
      </p>
      {datum.description ? <p className="mt-1 text-muted">{datum.description}</p> : null}
    </div>
  );
}

/**
 * Horizontal bars: magnitude against identity. One measure, one axis, counts
 * labelled directly on every bar so the amber step never has to carry meaning
 * on colour alone.
 */
export function RankedBars({
  data,
  unit = 'case',
  colors,
  labelWidth = 116,
}: {
  data: Datum[];
  unit?: string;
  /** One hue for a single series, or one colour per bar for a status scale. */
  colors: string | readonly string[];
  labelWidth?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <ResponsiveContainer width="100%" height={data.length * 26 + 14}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 34, bottom: 4, left: 0 }}>
        <XAxis type="number" domain={[0, max]} hide />
        <YAxis
          type="category"
          dataKey="key"
          width={labelWidth}
          tickLine={false}
          axisLine={{ stroke: RULE }}
          tick={{ fill: MUTED, fontSize: 11 }}
        />
        <Tooltip
          cursor={{ fill: 'rgba(20,24,26,0.04)' }}
          content={<ChartTooltip unit={unit} />}
        />
        <Bar
          dataKey="count"
          barSize={12}
          radius={[0, 4, 4, 0]}
          isAnimationActive={false}
          label={{ position: 'right', fill: INK, fontSize: 11, fontWeight: 600 }}
        >
          {data.map((datum, index) => (
            <Cell
              key={datum.key}
              fill={typeof colors === 'string' ? colors : colors[index % colors.length]}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
