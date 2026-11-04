import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import tokens from '../../../lib/chartTokens';
import { ChartFrame } from './ChartFrame';
import { LinesTick, wrapLabel } from './charts';
import { fmtInt } from './format';
import type { Run } from './sections/perfModel';

const AXIS = { fontSize: 12, fill: tokens.axis };
const ms = (v: unknown) => fmtInt(v as number);
export const fmtSec = (v: number) => `${(v / 1000).toFixed(1)} s`;
type TickProps = { x?: number; y?: number; index?: number };

const screenTick = (names: string[]) => (p: TickProps) => <LinesTick x={p.x} y={p.y} lines={wrapLabel(names[p.index ?? 0] ?? '', 18)} />;

/** p50, p95 and p99 for each screen (horizontal groups, so screen names and values never collide). */
export function LatencyBars({ run }: { run: Run }) {
  const rows = run.reads;
  const names = rows.map((r) => r.screen);
  return (
    <ChartFrame
      label={`Read latency per screen in milliseconds, run ${run.commit}: p50, p95 and p99`}
      height={rows.length * 108 + 48}
      columns={[
        { key: 'screen', header: 'Screen' },
        { key: 'p50ms', header: 'p50 (ms)', format: ms },
        { key: 'p95ms', header: 'p95 (ms)', format: ms },
        { key: 'p99ms', header: 'p99 (ms)', format: ms },
        { key: 'errors', header: 'Errors', format: ms },
        { key: 'perSecond', header: 'Requests/s', format: ms },
      ]}
      rows={rows as unknown as Record<string, unknown>[]}
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 0 }} barCategoryGap="14%">
        <CartesianGrid stroke={tokens.grid} horizontal={false} />
        <XAxis type="number" tick={AXIS} stroke={tokens.grid} tickFormatter={(v: number) => fmtInt(v)} />
        <YAxis type="category" dataKey="screen" width={148} interval={0} tickLine={false} axisLine={{ stroke: tokens.grid }} tick={screenTick(names)} />
        <Tooltip cursor={{ fill: tokens.cursor }} />
        <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="p50ms" name="p50" fill={tokens.neutral} isAnimationActive={false}>
          <LabelList dataKey="p50ms" position="right" fontSize={11} fill={tokens.axis} formatter={ms} />
        </Bar>
        <Bar dataKey="p95ms" name="p95" fill={tokens.accent} isAnimationActive={false}>
          <LabelList dataKey="p95ms" position="right" fontSize={11} fill={tokens.axis} formatter={ms} />
        </Bar>
        <Bar dataKey="p99ms" name="p99" fill={tokens.axis} isAnimationActive={false}>
          <LabelList dataKey="p99ms" position="right" fontSize={11} fill={tokens.axis} formatter={ms} />
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

/** First against second engine cycle: duration in seconds. */
export function CycleBars({ run }: { run: Run }) {
  const rows = [
    { cycle: 'First cycle', ms: run.first.ms, seconds: Number((run.first.ms / 1000).toFixed(1)), newAlerts: run.first.newAlerts, suppressed: run.first.alertsSuppressed },
    { cycle: 'Second cycle', ms: run.second.ms, seconds: Number((run.second.ms / 1000).toFixed(1)), newAlerts: run.second.newAlerts, suppressed: run.second.alertsSuppressed },
  ];
  return (
    <ChartFrame
      label={`Duration of the first and second deadline-engine cycle in seconds, run ${run.commit}`}
      height={200}
      columns={[
        { key: 'cycle', header: 'Cycle' },
        { key: 'ms', header: 'Duration', format: (v) => fmtSec(v as number) },
        { key: 'newAlerts', header: 'New alerts', format: ms },
        { key: 'suppressed', header: 'Alerts suppressed', format: ms },
      ]}
      rows={rows}
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 52, bottom: 4, left: 0 }} barCategoryGap="30%">
        <CartesianGrid stroke={tokens.grid} horizontal={false} />
        <XAxis type="number" tick={AXIS} stroke={tokens.grid} unit=" s" />
        <YAxis type="category" dataKey="cycle" width={96} interval={0} tickLine={false} axisLine={{ stroke: tokens.grid }} tick={AXIS} />
        <Tooltip cursor={{ fill: tokens.cursor }} formatter={(v: unknown) => `${v as number} s`} />
        <Bar dataKey="seconds" name="Duration (s)" isAnimationActive={false}>
          {rows.map((r, i) => (
            <Cell key={r.cycle} fill={i === 0 ? tokens.accent : tokens.neutral} />
          ))}
          <LabelList dataKey="seconds" position="right" fontSize={12} fill={tokens.axis} formatter={(v: unknown) => `${v as number} s`} />
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

const signed = (d: number) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${fmtInt(Math.abs(d))}`;

/** p95 for each screen, one bar per run (oldest to newest), with the change between the two latest runs in the table. */
export function CompareBars({ runs }: { runs: Run[] }) {
  const latest = runs[runs.length - 1]!;
  const prev = runs[runs.length - 2]!;
  const seriesFill = (i: number) => (i === runs.length - 1 ? tokens.accent : i === 0 ? tokens.neutral : tokens.axis);
  const names = latest.reads.map((r) => r.screen);
  const rows = names.map((screen) => {
    const row: Record<string, unknown> = { screen };
    for (const r of runs) row[r.commit] = r.reads.find((x) => x.screen === screen)?.p95ms;
    const a = prev.reads.find((x) => x.screen === screen)?.p95ms;
    const b = latest.reads.find((x) => x.screen === screen)?.p95ms;
    row.change = a === undefined || b === undefined ? undefined : signed(b - a);
    return row;
  });
  return (
    <ChartFrame
      label={`p95 read latency per screen in milliseconds for runs ${runs.map((r) => r.commit).join(', ')}`}
      height={rows.length * (runs.length * 22 + 28) + 56}
      columns={[{ key: 'screen', header: 'Screen' }, ...runs.map((r) => ({ key: r.commit, header: `p95 ms, ${r.commit}`, format: ms })), { key: 'change', header: `Change, ${prev.commit} to ${latest.commit} (ms)` }]}
      rows={rows}
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 0 }} barCategoryGap="14%">
        <CartesianGrid stroke={tokens.grid} horizontal={false} />
        <XAxis type="number" tick={AXIS} stroke={tokens.grid} tickFormatter={(v: number) => fmtInt(v)} />
        <YAxis type="category" dataKey="screen" width={148} interval={0} tickLine={false} axisLine={{ stroke: tokens.grid }} tick={screenTick(names)} />
        <Tooltip cursor={{ fill: tokens.cursor }} />
        <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: 12 }} />
        {runs.map((r, i) => (
          <Bar key={r.commit} dataKey={r.commit} name={`${r.commit}`} fill={seriesFill(i)} isAnimationActive={false}>
            <LabelList dataKey={r.commit} position="right" fontSize={11} fill={tokens.axis} formatter={ms} />
          </Bar>
        ))}
      </BarChart>
    </ChartFrame>
  );
}
