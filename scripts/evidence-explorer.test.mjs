import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'evaluator page contains its interactive script');

test('older benchmark displays missing suppression counters as unrecorded, not zero', async () => {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  dom.window.fetch = async (path) => ({
    ok: true,
    json: async () => JSON.parse(readFileSync(fileURLToPath(new URL(`../docs/${path}`, import.meta.url)), 'utf8')),
  });
  dom.window.eval(script);
  const select = dom.window.document.querySelector('#run-select');
  select.value = 'evidence/benchmark-results/565c210.json';
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const cards = [...dom.window.document.querySelectorAll('#engine-metrics .metric')].map((el) => el.textContent);
  assert.match(cards[2], /Not recorded/);
  assert.match(cards[3], /Not recorded/);
  const labels = [...dom.window.document.querySelectorAll('#engine-chart text')].map((el) => el.textContent);
  assert.ok(!labels.some((label) => label.includes('Suppressed attempts')));
  dom.window.close();
});
