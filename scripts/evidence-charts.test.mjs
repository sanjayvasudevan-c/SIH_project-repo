// scripts/evidence-charts.test.mjs — run with: node --test scripts/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { barChart, truncate, loadJson } from './evidence-charts.mjs';

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
