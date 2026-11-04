import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import tokens from '../../../lib/chartTokens';
import { ChartFrame } from './ChartFrame';
import { LinesTick, wrapLabel } from './charts';
import { faultName, HYBRID, type Metrics } from './sections/mlModel';

const AXIS = { fontSize: 12, fill: tokens.axis };
const rate = (v: unknown) => String(v);
const modeFill = (mode: string, i: number) => (mode === HYBRID ? tokens.accent : i === 0 ? tokens.neutral : tokens.axis);

/** Precision, recall and false-alarm rate, one group per measure and one bar per mode (horizontal, so labels never collide). */
export function ModeBars({ metrics }: { metrics: Metrics }) {
  const modes = Object.keys(metrics.modes);
  const groups = [
    { key: 'precision', name: 'Precision' },
    { key: 'recall', name: 'Recall' },
    { key: 'false_alarm_rate', name: 'False-alarm rate' },
  ] as const;
  const data = groups.map((g) => ({ measure: g.name, ...Object.fromEntries(modes.map((m) => [m, metrics.modes[m]![g.key]])) }));
  return (
    <ChartFrame
      label="Precision, recall and false-alarm rate of each mode, on synthetic data"
      height={groups.length * (modes.length * 22 + 28) + 56}
      columns={[{ key: 'mode', header: 'Mode' }, { key: 'precision', header: 'Precision', format: rate }, { key: 'recall', header: 'Recall', format: rate }, { key: 'false_alarm_rate', header: 'False-alarm rate', format: rate }]}
      rows={modes.map((mode) => ({ mode, ...metrics.modes[mode]! }))}
    >
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 0 }} barCategoryGap="16%">
        <CartesianGrid stroke={tokens.grid} horizontal={false} />
        <XAxis type="number" domain={[0, 1]} tick={AXIS} stroke={tokens.grid} />
        <YAxis type="category" dataKey="measure" width={110} interval={0} tick={AXIS} tickLine={false} axisLine={{ stroke: tokens.grid }} />
        <Tooltip cursor={{ fill: tokens.cursor }} />
        <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: 12 }} />
        {modes.map((m, i) => (
          <Bar key={m} dataKey={m} name={m} fill={modeFill(m, i)} isAnimationActive={false}>
            <LabelList dataKey={m} position="right" fontSize={11} fill={tokens.axis} formatter={rate} />
          </Bar>
        ))}
      </BarChart>
    </ChartFrame>
  );
}

/** Hybrid recall per fault type, weakest first; the weakest is red and is also named in the text and the table. */
export function FaultRecallBars({ metrics }: { metrics: Metrics }) {
  const modes = Object.keys(metrics.modes);
  const rows = Object.entries(metrics.perFault)
    .map(([k, byMode]) => ({ key: k, fault: faultName(k), hybrid: byMode[HYBRID]!, byMode }))
    .sort((a, b) => a.hybrid - b.hybrid);
  const weakest = rows.length > 1 && rows[0]!.hybrid < rows[1]!.hybrid ? rows[0]!.key : undefined;
  return (
    <ChartFrame
      label="Recall of the hybrid mode for each fault type, on synthetic data"
      height={rows.length * 48 + 28}
      columns={[{ key: 'fault', header: 'Fault type' }, ...modes.map((m) => ({ key: m, header: m, format: rate }))]}
      rows={rows.map((r) => ({ fault: r.fault, ...Object.fromEntries(modes.map((m) => [m, r.byMode[m]])) }))}
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 0 }} barCategoryGap="22%">
        <CartesianGrid stroke={tokens.grid} horizontal={false} />
        <XAxis type="number" domain={[0, 1]} tick={AXIS} stroke={tokens.grid} />
        <YAxis type="category" dataKey="fault" width={148} interval={0} tickLine={false} axisLine={{ stroke: tokens.grid }} tick={(p: { x?: number; y?: number; index?: number }) => <LinesTick x={p.x} y={p.y} lines={wrapLabel(rows[p.index ?? 0]?.fault ?? '', 18)} />} />
        <Tooltip cursor={{ fill: tokens.cursor }} />
        <Bar dataKey="hybrid" name="Recall (hybrid)" isAnimationActive={false}>
          {rows.map((r) => (
            <Cell key={r.key} fill={r.key === weakest ? tokens.danger : tokens.accent} />
          ))}
          <LabelList dataKey="hybrid" position="right" fontSize={12} fill={tokens.axis} formatter={rate} />
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}
