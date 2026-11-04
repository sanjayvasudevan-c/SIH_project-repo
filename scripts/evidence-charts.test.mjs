// scripts/evidence-charts.test.mjs — run with: node --test scripts/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { barChart, truncate, loadJson, buildCharts } from './evidence-charts.mjs';

test('bar chart carries its caption and no undefined', () => {
  const svg = barChart({ title: 'Read latency', caption: 'commit 8140a1f · 2026-11-03', series: [{ label: 'Action Center', value: 471 }], max: 500, unit: 'ms' });
  assert.match(svg, /<svg[^>]+viewBox/);
  assert.match(svg, /commit 8140a1f/);
  assert.ok(!svg.includes('undefined') && !svg.includes('NaN'));
});

test('bar chart uses currentColor so both GitHub themes work', () => {
  const svg = barChart({ title: 't', caption: 'c', series: [{ label: 'a', value: 1 }], max: 2, unit: 'ms' });
  assert.match(svg, /currentColor/);
});

test('long screen names are truncated to stay inside the viewBox', () => {
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
  engine: { firstCycle: { newAlerts: 777 }, secondCycle: { newAlerts: 0 } },
  reads: [
    { screen: 'Action Center (officer)', p95ms: 461 },
    { screen: 'Team report (senior)', p95ms: 1851 },
  ],
});
const metricsFixture = () => ({
  generatedAt: '2026-11-03T13:35:09+00:00',
  commit: '6f6e7cd',
  modes: { 'Rules only': { recall: 0.5 }, 'Hybrid (rules or model)': { recall: 0.863 } },
});

test('buildCharts writes four clean SVGs with known values in the right chart', () => {
  const charts = buildCharts(benchFixture(), metricsFixture());
  assert.deepStrictEqual(Object.keys(charts).sort(), ['dataset-scale.svg', 'engine-cycle.svg', 'formcheck-modes.svg', 'read-latency.svg']);
  for (const [name, svg] of Object.entries(charts)) {
    assert.ok(!svg.includes('undefined') && !svg.includes('NaN'), `${name} has undefined/NaN`);
  }
  assert.match(charts['read-latency.svg'], /1,851 ms/);
  assert.match(charts['read-latency.svg'], /commit abc1234 · 2026-11-03/);
  assert.match(charts['dataset-scale.svg'], /1,234/);
  assert.match(charts['engine-cycle.svg'], /777 alerts/);
  assert.match(charts['formcheck-modes.svg'], /0\.863/);
  assert.match(charts['formcheck-modes.svg'], /2026-11-03 @ 6f6e7cd/);
  assert.ok(!charts['read-latency.svg'].includes('0.863'));
});

test('the CLI writes all four files from fixture JSON in a temp directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'charts-'));
  writeFileSync(join(dir, 'bench.json'), JSON.stringify(benchFixture()));
  writeFileSync(join(dir, 'metrics.json'), JSON.stringify(metricsFixture()));
  execFileSync(process.execPath, [fileURLToPath(new URL('./evidence-charts.mjs', import.meta.url)), '--bench', join(dir, 'bench.json'), '--metrics', join(dir, 'metrics.json'), '--out', join(dir, 'out')], { stdio: 'pipe' });
  assert.deepStrictEqual(readdirSync(join(dir, 'out')).sort(), ['dataset-scale.svg', 'engine-cycle.svg', 'formcheck-modes.svg', 'read-latency.svg']);
  assert.match(readFileSync(join(dir, 'out', 'read-latency.svg'), 'utf8'), /461 ms/);
});

test('a bench JSON without reads fails naming the field and the producer, not a TypeError', () => {
  const b = benchFixture();
  delete b.reads;
  assert.throws(() => buildCharts(b, metricsFixture()), (e) => !(e instanceof TypeError) && /reads/.test(e.message) && /load:test -- --out <path>/.test(e.message));
});

test('truncated bench JSON: missing data, engine, a renamed field and an empty reads list all name what is wrong', () => {
  for (const [field, mutate] of [
    ['data', (b) => delete b.data],
    ['engine', (b) => delete b.engine],
    ['reads[1].p95ms', (b) => { b.reads[1] = { screen: 'x', p95: 5 }; }],
    ['reads', (b) => { b.reads = []; }],
    ['data.applications', (b) => { b.data.applications = '15000'; }],
  ]) {
    const b = benchFixture();
    mutate(b);
    assert.throws(() => buildCharts(b, metricsFixture()), (e) => !(e instanceof TypeError) && e.message.includes(field) && /load:test/.test(e.message), field);
  }
});

test('malformed metrics JSON names the field and the evaluate command', () => {
  assert.throws(() => buildCharts(benchFixture(), { generatedAt: 'x', modes: { Hybrid: {} } }), /modes\["Hybrid"\]\.recall.*training\.evaluate/s);
  assert.throws(() => buildCharts(benchFixture(), { generatedAt: 'x' }), /modes.*training\.evaluate/s);
  assert.throws(() => buildCharts(benchFixture(), { modes: { H: { recall: 1 } } }), /generatedAt.*training\.evaluate/s);
});

test('barChart refuses an empty series or a point with no value instead of printing -Infinity or a bare TypeError', () => {
  assert.throws(() => barChart({ title: 'T', caption: 'c', series: [], max: 1 }), /no data points/);
  assert.throws(() => barChart({ title: 'T', caption: 'c', series: [{ label: 'a' }], max: 1 }), (e) => !(e instanceof TypeError) && /series\[0\] \(a\).*numeric value/.test(e.message));
});

test('the duplicate-prevention chart plots created against suppressed, from the measured counters', () => {
  const b = benchFixture();
  b.engine.firstCycle.alertsSuppressed = 0;
  b.engine.secondCycle.alertsSuppressed = 777;
  const charts = buildCharts(b, metricsFixture());
  const svg = charts['duplicate-prevention.svg'];
  assert.ok(svg, 'duplicate-prevention.svg is produced when the run measured alertsSuppressed');
  assert.match(svg, /Created \(cycle 1\)/);
  assert.match(svg, /Suppressed \(cycle 2\)/);
  assert.match(svg, /777 alerts/);
  assert.ok(!svg.includes('undefined') && !svg.includes('NaN'));
});

test('an older bench without alertsSuppressed draws no duplicate-prevention chart rather than inventing one', () => {
  assert.ok(!('duplicate-prevention.svg' in buildCharts(benchFixture(), metricsFixture())));
});

test('a non-numeric alertsSuppressed names the field and the producer', () => {
  const b = benchFixture();
  b.engine.secondCycle.alertsSuppressed = 'lots';
  assert.throws(() => buildCharts(b, metricsFixture()), /engine\.secondCycle\.alertsSuppressed.*load:test/s);
});
