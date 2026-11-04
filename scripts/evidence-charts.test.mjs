// scripts/evidence-charts.test.mjs — run with: node --test scripts/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { barChart, chart, truncate, loadJson, validateBench, validateMetrics, niceMax, wrap, textW } from './evidence-charts.mjs';

const footer = { provenance: 'MEASURED', source: 'a.json', stamp: 'snapshot 2026-11-04 · commit abc1234' };

test('bar chart carries its caption and no undefined', () => {
  const svg = barChart({ title: 'Read latency', caption: 'commit 8140a1f · 2026-11-03', series: [{ label: 'Action Center', value: 471 }], max: 500, unit: 'ms' });
  assert.match(svg, /<svg[^>]+viewBox="0 0 800 /);
  assert.match(svg, /commit 8140a1f/);
  assert.ok(!svg.includes('undefined') && !svg.includes('NaN'));
});

test('a chart never inherits a colour: opaque white background, explicit colours, no currentColor (GitHub renders it black in an <img>)', () => {
  const svg = barChart({ title: 't', caption: 'c', series: [{ label: 'a', value: 1 }], max: 2, unit: 'ms' });
  assert.ok(!svg.includes('currentColor'));
  assert.match(svg, /<rect x="0.5" y="0.5" width="799" height="\d+" rx="6" fill="#ffffff" stroke="#d0d7de"\/>/);
  for (const m of svg.matchAll(/<text [^>]*>/g)) assert.match(m[0], /fill="#[0-9a-fA-F]{6}"/, m[0]);
});

test('every text is 13 units or larger', () => {
  const svg = barChart({ title: 't', caption: 'c', series: [{ label: 'a', value: 1 }], unit: 'ms' });
  for (const m of svg.matchAll(/font-size="(\d+)"/g)) assert.ok(Number(m[1]) >= 13, m[0]);
});

test('hbars are zero-based and bar length is proportional to the value', () => {
  const c = chart({ id: 'z', title: 'z' });
  c.hbars({ items: [{ label: 'a', value: 50 }, { label: 'b', value: 100 }], max: 100 });
  const { svg } = c.render(footer);
  const widths = [...svg.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="([\d.]+)" height="20" fill="#0072B2" stroke="none"\/>/g)].map((m) => Number(m[1]));
  assert.strictEqual(widths.length, 2);
  assert.ok(Math.abs(widths[1] / widths[0] - 2) < 0.02, `widths ${widths}`);
  assert.match(svg, /<text [^>]*>0<\/text>/); // the axis starts at 0
});

test('a label that would run outside the chart is an error, not a clipped label', () => {
  const c = chart({ id: 'clip', title: 'clip' });
  c.t(700, 100, 'x'.repeat(60), { size: 14 });
  assert.throws(() => c.render(footer), /would run outside the chart/);
});

test('a footer needs provenance, source and a stamp', () => {
  const c = chart({ id: 'f', title: 'f' });
  assert.throws(() => c.render({ provenance: 'MEASURED' }), /provenance, source and stamp/);
});

test('a "Not available" panel states the reason and plots nothing', () => {
  const c = chart({ id: 'na', title: 'na' });
  c.na('no run measured it');
  const { svg, model } = c.render(footer);
  assert.match(svg, /Not available: no run measured it/);
  assert.strictEqual(model.notAvailable, 'no run measured it');
  assert.deepStrictEqual(model.marks, []);
});

test('segmented bar refuses segments that do not sum to the total', () => {
  const c = chart({ id: 'seg', title: 'seg' });
  assert.throws(() => c.segBar({ segments: [{ label: 'a', value: 1, color: '#000000' }], total: 2 }), /sum to 1, not 2/);
});

test('niceMax rounds up to a tick and never to zero', () => {
  assert.strictEqual(niceMax(2296).max, 2500);
  assert.strictEqual(niceMax(1).max, 1);
  assert.ok(niceMax(0).max > 0);
});

test('wrap keeps lines inside the width and textW is conservative', () => {
  for (const l of wrap('one two three four five six seven eight nine ten', 100, 14)) assert.ok(textW(l, 14) <= 100 || !l.includes(' '));
});

test('long screen names are truncated by truncate()', () => {
  assert.strictEqual(truncate('Action Center summary (senior)', 18), 'Action Center sum…');
  assert.strictEqual(truncate('short', 18), 'short');
});

test('a missing producer file names the file and the command that makes it', () => {
  assert.throws(() => loadJson('/nope/bench.json', 'npm run load:test'), /\/nope\/bench\.json.*load:test/s);
});

const benchFixture = () => ({
  commit: 'abc1234',
  date: '2026-11-03T08:26:18.480Z',
  data: { applications: 1234, deadlineItems: 2345, openDeadlineItems: 1111, assignments: 987 },
  engine: { firstCycle: { newAlerts: 777, ms: 5 }, secondCycle: { newAlerts: 0, ms: 4 } },
  reads: [{ screen: 'Action Center (officer)', p95ms: 461 }],
});
const metricsFixture = () => ({
  generatedAt: '2026-11-03T13:35:09+00:00',
  modes: { 'Rules only': { precision: 1, recall: 0.5, false_alarm_rate: 0 } },
});

test('valid fixtures pass the validators', () => {
  validateBench(benchFixture());
  validateMetrics(metricsFixture());
});

test('truncated bench JSON: every missing or mistyped field is named with the producer command', () => {
  for (const [field, mutate] of [
    ['data', (b) => delete b.data],
    ['engine', (b) => delete b.engine],
    ['reads[0].p95ms', (b) => { b.reads[0] = { screen: 'x', p95: 5 }; }],
    ['reads', (b) => { b.reads = []; }],
    ['data.applications', (b) => { b.data.applications = '15000'; }],
    ['engine.firstCycle.ms', (b) => delete b.engine.firstCycle.ms],
    ['engine.secondCycle.alertsSuppressed', (b) => { b.engine.secondCycle.alertsSuppressed = 'lots'; }],
  ]) {
    const b = benchFixture();
    mutate(b);
    assert.throws(() => validateBench(b), (e) => !(e instanceof TypeError) && e.message.includes(field) && /load:test -- --out <path>/.test(e.message), field);
  }
});

test('malformed metrics JSON names the field and the evaluate command', () => {
  assert.throws(() => validateMetrics({ generatedAt: 'x', modes: { Hybrid: {} } }), /modes\["Hybrid"\]\.precision.*training\.evaluate/s);
  assert.throws(() => validateMetrics({ generatedAt: 'x' }), /modes.*training\.evaluate/s);
  assert.throws(() => validateMetrics({ modes: { H: { precision: 1, recall: 1, false_alarm_rate: 0 } } }), /generatedAt.*training\.evaluate/s);
});

test('barChart refuses an empty series or a point with no value', () => {
  assert.throws(() => barChart({ title: 'T', caption: 'c', series: [], max: 1 }), /no data points/);
  assert.throws(() => barChart({ title: 'T', caption: 'c', series: [{ label: 'a' }], max: 1 }), (e) => !(e instanceof TypeError) && /series\[0\] \(a\).*numeric value/.test(e.message));
});
