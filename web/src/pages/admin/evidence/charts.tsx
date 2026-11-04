import { Bar, BarChart, CartesianGrid, Cell, Legend, LabelList, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import type { AssignmentOfficer, EngineRunDetailRow, WorkflowVolumePoint } from '../../../api/types';
import { formatDate, formatDateTime } from '../../../lib/format';
import tokens from '../../../lib/chartTokens';
import { ChartFrame } from './ChartFrame';
import { fmtInt, fmtMs, fmtPct, RUN_STATUS_WORDS } from './format';

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
export function LinesTick({ x, y, lines }: { x?: number; y?: number; lines: string[] }) {
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

/** Points to at most two decimals ("3.2", "13", "4.25"); never rounded to a whole number. */
export const fmtPts = (v: number | null | undefined): string => (v === null || v === undefined || !Number.isFinite(v) ? 'Unavailable' : String(Number(v.toFixed(2))));

function OfficerTick({ x, y, payload }: { x?: number; y?: number; payload?: { value?: string } }) {
  return (
    <text x={x} y={(y ?? 0) + 6} transform={`rotate(-60 ${x ?? 0} ${(y ?? 0) + 6})`} textAnchor="end" fontSize={11} fill={tokens.axis}>
      {payload?.value}
    </text>
  );
}

const PX_PER_OFFICER = 26;

/**
 * One vertical bar per officer, highest utilisation first, with the normal cap as a reference line. Wider than its card when
 * there are many officers: it scrolls sideways inside the card, and the data table lists every officer.
 */
export function UtilisationBars({ label, officers }: { label: string; officers: AssignmentOfficer[] }) {
  const caps = [...new Set(officers.map((o) => o.maxUtil))];
  const cap = caps.length === 1 ? caps[0]! : null; // officers share one cap in practice; if they ever differ, no single line is honest
  const top = Math.max(1, ...officers.map((o) => o.utilisation), ...officers.map((o) => o.maxUtil));
  const ceil = Math.ceil(top * 4) / 4; // quarter steps: 0%, 25% ... never an uneven axis
  const ticks = Array.from({ length: Math.round(ceil * 4) + 1 }, (_, i) => i / 4);
  return (
    <ChartFrame
      label={label}
      height={380}
      minWidth={Math.max(520, officers.length * PX_PER_OFFICER + 60)}
      columns={[
        { key: 'name', header: 'Officer' },
        { key: 'openPoints', header: 'Open points', format: (v) => fmtPts(v as number) },
        { key: 'capacityPoints', header: 'Capacity', format: (v) => fmtPts(v as number) },
        { key: 'utilisation', header: 'Utilisation', format: (v) => fmtPct(v as number) },
        { key: 'maxUtil', header: 'Normal cap', format: (v) => fmtPct(v as number) },
      ]}
      rows={officers as unknown as BarRow[]}
    >
      <BarChart data={officers} margin={{ top: 8, right: 12, bottom: 4, left: 0 }} barCategoryGap="18%">
        <CartesianGrid stroke={tokens.grid} vertical={false} />
        <XAxis dataKey="name" interval={0} height={120} tick={<OfficerTick />} stroke={tokens.grid} />
        <YAxis domain={[0, ceil]} ticks={ticks} tickFormatter={(v: number) => fmtPct(v)} width={48} tick={AXIS} stroke={tokens.grid} />
        <Tooltip
          cursor={{ fill: tokens.cursor }}
          content={({ active, payload }) => {
            const o = active ? (payload?.[0]?.payload as AssignmentOfficer | undefined) : undefined;
            if (!o) return null;
            return (
              <div className="rounded border bg-surface p-2 text-sm shadow">
                <p className="font-semibold">{o.name}</p>
                <p>Open points: {fmtPts(o.openPoints)}</p>
                <p>Capacity: {fmtPts(o.capacityPoints)}</p>
                <p>Utilisation: {fmtPct(o.utilisation)}</p>
              </div>
            );
          }}
        />
        {cap !== null ? <ReferenceLine y={cap} stroke={tokens.warning} strokeDasharray="6 4" strokeWidth={2} label={{ value: `Normal cap ${fmtPct(cap)}`, position: 'insideTopRight', fontSize: 12, fill: tokens.axis }} /> : null}
        <Bar dataKey="utilisation" name="Utilisation" isAnimationActive={false}>
          {officers.map((o) => (
            <Cell key={o.officerId} fill={o.utilisation > o.maxUtil + 1e-9 ? tokens.danger : tokens.accent} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

export interface StateSegment {
  key: string;
  word: string;
  count: number;
  fill: string;
}

/** One bar split into states. The segments are drawn from `segments` (which must add up to `total`); the table lists the same four rows. */
export function SegmentedBar({ label, total, segments }: { label: string; total: number; segments: StateSegment[] }) {
  const datum = Object.fromEntries(segments.map((g) => [g.key, g.count]));
  return (
    <ChartFrame
      label={label}
      height={96}
      columns={[
        { key: 'word', header: 'State' },
        { key: 'count', header: 'Items', format: (v) => fmtInt(v as number) },
        { key: 'share', header: 'Share of open items', format: (v) => fmtPct(v as number) },
      ]}
      rows={segments.map((g) => ({ word: g.word, count: g.count, share: total > 0 ? g.count / total : null }))}
    >
      <BarChart data={[datum]} layout="vertical" margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <XAxis type="number" domain={[0, total]} allowDecimals={false} tick={AXIS} stroke={tokens.grid} />
        <YAxis type="category" hide />
        <Tooltip cursor={false} />
        {segments.map((g) => (
          <Bar key={g.key} dataKey={g.key} name={g.word} stackId="open" fill={g.fill} stroke="#fff" isAnimationActive={false} />
        ))}
      </BarChart>
    </ChartFrame>
  );
}

/**
 * One bar per engine run, in run order (oldest left, as the rows come newest first). Not a time axis: the runs of a demo share one real day.
 * A failed run is red and is also named "Failed" in the tooltip, the data table and the caption under the chart.
 */
export function RunDurationBars({ label, rows }: { label: string; rows: EngineRunDetailRow[] }) {
  const tableRows = rows.map((r) => ({ ...r, statusWord: RUN_STATUS_WORDS[r.status] ?? r.status }));
  return (
    <ChartFrame
      label={label}
      height={260}
      columns={[
        { key: 'id', header: 'Run' },
        { key: 'startedAt', header: 'Started (real time)', format: (v) => formatDateTime(String(v)) },
        { key: 'simulatedToday', header: 'Simulated date', format: (v) => formatDate(String(v)) },
        { key: 'durationMs', header: 'Duration', format: (v) => fmtMs(v as number) },
        { key: 'itemsChecked', header: 'Items checked', format: (v) => fmtInt(v as number) },
        { key: 'statusWord', header: 'Status' },
      ]}
      rows={tableRows as unknown as BarRow[]}
    >
      <BarChart data={tableRows} margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
        <CartesianGrid stroke={tokens.grid} vertical={false} />
        {/* reversed: the rows are newest first, the chart reads oldest to newest left to right */}
        <XAxis dataKey="id" reversed interval="preserveStartEnd" minTickGap={14} tick={AXIS} stroke={tokens.grid} label={{ value: 'Run number (oldest on the left)', position: 'insideBottom', offset: -12, fontSize: 12, fill: tokens.axis }} />
        <YAxis orientation="left" tickFormatter={(v: number) => fmtMs(v)} width={64} tick={AXIS} stroke={tokens.grid} />
        <Tooltip
          cursor={{ fill: tokens.cursor }}
          content={({ active, payload }) => {
            const r = active ? (payload?.[0]?.payload as (typeof tableRows)[number] | undefined) : undefined;
            if (!r) return null;
            return (
              <div className="rounded border bg-surface p-2 text-sm shadow">
                <p className="font-semibold">
                  Run {r.id} · {r.statusWord}
                </p>
                <p>Started {formatDateTime(r.startedAt)} (real time)</p>
                <p>Simulated date {formatDate(r.simulatedToday)}</p>
                <p>Took {fmtMs(r.durationMs)}</p>
                <p>{fmtInt(r.itemsChecked)} items checked</p>
              </div>
            );
          }}
        />
        <Bar dataKey="durationMs" name="Duration" isAnimationActive={false}>
          {tableRows.map((r) => (
            <Cell key={r.id} fill={r.status === 'FAILED' ? tokens.danger : r.status === 'RUNNING' ? tokens.neutral : tokens.accent} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

/** Alerts per day, only for the days the API returned (no zero-fill). */
export function DayCountBars({ label, points, seriesName }: { label: string; points: { day: string; count: number }[]; seriesName: string }) {
  return (
    <ChartFrame
      label={label}
      height={260}
      columns={[
        { key: 'day', header: 'Day', format: (v) => formatDate(String(v)) },
        { key: 'count', header: seriesName, format: (v) => fmtInt(v as number) },
      ]}
      rows={points as unknown as BarRow[]}
    >
      <BarChart data={points} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={tokens.grid} vertical={false} />
        <XAxis dataKey="day" tickFormatter={shortDay} interval="preserveStartEnd" minTickGap={28} tick={AXIS} stroke={tokens.grid} />
        <YAxis allowDecimals={false} width={32} tick={AXIS} stroke={tokens.grid} />
        <Tooltip cursor={{ fill: tokens.cursor }} labelFormatter={(d) => formatDate(String(d))} />
        <Bar dataKey="count" name={seriesName} fill={tokens.accent} isAnimationActive={false} />
      </BarChart>
    </ChartFrame>
  );
}
