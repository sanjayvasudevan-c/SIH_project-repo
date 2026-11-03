import { Bar, BarChart, CartesianGrid, Legend, LabelList, Tooltip, XAxis, YAxis } from 'recharts';
import type { WorkflowVolumePoint } from '../../../api/types';
import { formatDate } from '../../../lib/format';
import tokens from '../../../lib/chartTokens';
import { ChartFrame } from './ChartFrame';
import { fmtInt } from './format';

const AXIS = { fontSize: 12, fill: tokens.axis };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "21 May" for an ISO day, for a crowded axis. */
export const shortDay = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''}`;

/** Breaks a label into lines of at most `max` characters, on spaces. */
export function wrapLabel(text: string, max = 16): string[] {
  const lines: string[] = [];
  for (const word of text.split(' ')) {
    const last = lines[lines.length - 1];
    if (last !== undefined && `${last} ${word}`.length <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** A category-axis label of several short lines, right-aligned against the bars. */
function LinesTick({ x, y, lines }: { x?: number; y?: number; lines: string[] }) {
  const lh = 13;
  const top = (y ?? 0) - ((lines.length - 1) * lh) / 2;
  return (
    <text x={(x ?? 0) - 6} y={top} textAnchor="end" dominantBaseline="middle" fontSize={12} fill={tokens.axis}>
      {lines.map((l, i) => (
        <tspan key={i} x={(x ?? 0) - 6} dy={i === 0 ? 0 : lh} fontWeight={i === 0 ? 600 : 400}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

type TickProps = { x?: number; y?: number; index?: number };

export interface BarRow {
  [k: string]: unknown;
}

/** Horizontal bars, one row per category; each category label may span several lines. */
export function HorizontalBars({ label, rows, categoryKey, valueKey, valueHeader, categoryHeader, lines, extraColumns = [], rowHeight }: {
  label: string;
  rows: BarRow[];
  categoryKey: string;
  valueKey: string;
  valueHeader: string;
  categoryHeader: string;
  lines: (row: BarRow) => string[];
  extraColumns?: { key: string; header: string; format?: (v: unknown) => string }[];
  rowHeight: number;
}) {
  return (
    <ChartFrame
      label={label}
      height={rows.length * rowHeight + 24}
      columns={[{ key: categoryKey, header: categoryHeader }, { key: valueKey, header: valueHeader, format: (v) => fmtInt(v as number) }, ...extraColumns]}
      rows={rows}
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 0 }} barCategoryGap="22%">
        <CartesianGrid stroke={tokens.grid} horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={AXIS} stroke={tokens.grid} />
        <YAxis type="category" dataKey={categoryKey} width={148} interval={0} tickLine={false} axisLine={{ stroke: tokens.grid }} tick={(p: TickProps) => <LinesTick x={p.x} y={p.y} lines={lines(rows[p.index ?? 0] ?? {})} />} />
        <Tooltip cursor={{ fill: tokens.cursor }} />
        <Bar dataKey={valueKey} name={valueHeader} fill={tokens.accent} isAnimationActive={false}>
          <LabelList dataKey={valueKey} position="right" fontSize={12} fill={tokens.axis} />
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

const SERIES = {
  submitted: { name: 'Submitted', fill: tokens.accent },
  decided: { name: 'Decided', fill: tokens.neutral },
  overdue: { name: 'Overdue (by due date)', fill: tokens.danger },
} as const;

/** Per-day bars. Days with no events are absent from the rows and so from the axis. */
export function VolumeBars({ label, points, series }: { label: string; points: WorkflowVolumePoint[]; series: (keyof typeof SERIES)[] }) {
  return (
    <ChartFrame
      label={label}
      height={280}
      columns={[{ key: 'day', header: 'Day', format: (v) => formatDate(String(v)) }, ...series.map((k) => ({ key: k, header: SERIES[k].name, format: (v: unknown) => fmtInt(v as number) }))]}
      rows={points as unknown as BarRow[]}
    >
      <BarChart data={points} margin={{ top: 4, right: 8, bottom: 4, left: 0 }} barGap={0}>
        <CartesianGrid stroke={tokens.grid} vertical={false} />
        <XAxis dataKey="day" tickFormatter={shortDay} interval="preserveStartEnd" minTickGap={28} tick={AXIS} stroke={tokens.grid} />
        <YAxis allowDecimals={false} width={32} tick={AXIS} stroke={tokens.grid} />
        <Tooltip cursor={{ fill: tokens.cursor }} labelFormatter={(d) => formatDate(String(d))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((k) => (
          <Bar key={k} dataKey={k} name={SERIES[k].name} fill={SERIES[k].fill} isAnimationActive={false} />
        ))}
      </BarChart>
    </ChartFrame>
  );
}

/** "21 May 2026 to 3 Jun 2026" for the first and last plotted day. */
export const daySpan = (points: WorkflowVolumePoint[]) => `${formatDate(points[0]?.day)} to ${formatDate(points[points.length - 1]?.day)}`;
