#!/usr/bin/env node
// Generates the evidence-pack SVG charts from real run output. No chart library:
// each chart is a hand-written SVG string, so the files stay small and diffable.
//   node scripts/evidence-charts.mjs --bench <load-test.json> --metrics <formcheck/metrics.json> --out <dir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACCENT = '#1E7B45'; // theme-neutral green; text and axes use currentColor
const W = 480; // viewBox width: ~0.7x on a 360px phone, so 14px text renders ~10px
const LABEL_W = 170; // left column for bar labels
const BAR_X = LABEL_W + 12;
const BAR_W = 190; // widest bar; ~100px remain for value text
const ROW_H = 34;
const LABEL_CHARS = 22; // ~7.5px per char at 14px text fits inside LABEL_W

export function truncate(label, maxChars) {
  const s = String(label);
  return s.length <= maxChars ? s : s.slice(0, maxChars - 1) + '…';
}

export function loadJson(path, hint) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read ${path} (${err.message}). Produce it with: ${hint}`);
  }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Math.round(n * 10) / 10;

// Horizontal bar chart. series: [{label, value, text?}]; `text` overrides the value label
// (used to show metrics exactly as stored). Bars are scaled value/max, clamped to 0..1.
export function barChart({ title, caption, series, max, unit }) {
  const top = 52;
  const height = top + series.length * ROW_H + 40;
  const scale = max > 0 ? max : 1;
  const rows = series.map((s, i) => {
    const y = top + i * ROW_H;
    const w = num(BAR_W * Math.min(Math.max(s.value / scale, 0), 1));
    const text = s.text ?? `${s.value.toLocaleString('en-US')}${unit ? ' ' + unit : ''}`;
    return [
      `<text x="${LABEL_W}" y="${y + 17}" text-anchor="end" font-size="14" fill="currentColor"><title>${esc(s.label)}</title>${esc(truncate(s.label, LABEL_CHARS))}</text>`,
      `<rect x="${BAR_X}" y="${y + 4}" width="${w}" height="20" rx="2" fill="${ACCENT}"/>`,
      `<text x="${num(BAR_X + w + 8)}" y="${y + 19}" font-size="14" fill="currentColor">${esc(text)}</text>`,
    ].join('\n  ');
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(title)}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">
  <title>${esc(title)}</title>
  <text x="16" y="28" font-size="18" font-weight="600" fill="currentColor">${esc(title)}</text>
  <line x1="${BAR_X}" y1="${top}" x2="${BAR_X}" y2="${top + series.length * ROW_H}" stroke="currentColor" stroke-opacity="0.5"/>
  ${rows.join('\n  ')}
  <text x="16" y="${height - 14}" font-size="12" fill="currentColor" fill-opacity="0.7">${esc(caption)}</text>
</svg>
`;
}

// One chart per output file. Each reads real producer output; nothing is typed in.
export function buildCharts(bench, metrics) {
  const caption = `commit ${bench.commit} · ${String(bench.date).slice(0, 10)} · synthetic data`;
  const peak = (series) => Math.max(...series.map((s) => s.value));
  const counts = (title, series, unit) => barChart({ title, caption, series, max: peak(series), unit });

  // Short chart labels keep the officer/senior distinction inside the label column; full names live in the docs tables.
  const SHORT = { 'Action Center (officer)': 'Action Center', 'Action Center summary (senior)': 'Summary (senior)', 'Applications list (officer)': 'Applications list', 'Hybrid (rules or model)': 'Hybrid' };
  const short = (l) => SHORT[l] ?? l;
  const reads = bench.reads.map((r) => ({ label: short(r.screen), value: r.p95ms }));
  const engine = [
    { label: 'First cycle', value: bench.engine.firstCycle.newAlerts },
    { label: 'Second cycle', value: bench.engine.secondCycle.newAlerts },
  ];
  const d = bench.data;
  const scale = [
    { label: 'Applications', value: d.applications },
    { label: 'Deadline items', value: d.deadlineItems },
    { label: 'Open deadline items', value: d.openDeadlineItems },
    { label: 'Assignments', value: d.assignments },
  ];
  // Recall is drawn and labelled exactly as stored in metrics.json (already 3 decimals).
  const modes = Object.entries(metrics.modes).map(([label, m]) => ({ label: short(label), value: m.recall, text: m.recall.toFixed(3) }));

  return {
    'read-latency.svg': counts('Read latency, p95', reads, 'ms'),
    'engine-cycle.svg': counts('New alerts per cycle (alerts, not time)', engine, 'alerts'),
    'dataset-scale.svg': counts('Dataset scale', scale, ''),
    'formcheck-modes.svg': barChart({ title: 'Form check recall by mode', caption: 'source: formcheck/metrics.json · synthetic data', series: modes, max: 1, unit: '' }),
  };
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
  if (!args.bench || !args.metrics || !args.out) {
    console.error('Usage: node scripts/evidence-charts.mjs --bench <path> --metrics <path> --out <dir>');
    process.exit(2);
  }
  const bench = loadJson(args.bench, 'npm run load:test -- --out <path> (run in api/)');
  const metrics = loadJson(args.metrics, 'python3 -m training.evaluate (run in formcheck/)');
  mkdirSync(args.out, { recursive: true });
  for (const [name, svg] of Object.entries(buildCharts(bench, metrics))) {
    writeFileSync(join(args.out, name), svg);
    console.log(`wrote ${join(args.out, name)}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
