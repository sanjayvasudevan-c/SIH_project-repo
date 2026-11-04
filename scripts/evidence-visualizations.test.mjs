// scripts/evidence-visualizations.test.mjs — the evidence package against the committed data. Run with: node --test scripts/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSources, buildAll, VIS_DIR, machineDiff } from './evidence-visualizations.mjs';
import { checkLinks, docFiles } from './check-doc-links.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = loadSources(root);
const { files, charts } = buildAll(src);
const clone = (o) => JSON.parse(JSON.stringify(o));
const byKey = (k) => charts.find((c) => `${c.dir}/${c.file}` === k);
const marks = (k, series) => byKey(k).model.marks.filter((m) => !series || m.series === series);
const rebuild = (mutate) => {
  const s = { manifest: clone(src.manifest), snap: clone(src.snap), benches: clone(src.benches), metrics: clone(src.metrics) };
  mutate(s);
  return buildAll(s).charts;
};
const svgs = Object.entries(files).filter(([p]) => p.endsWith('.svg'));

test('the package builds every chart in the brief', () => {
  assert.ok(svgs.length >= 30, `only ${svgs.length} SVGs`);
  for (const dir of ['benchmarks', 'workflow', 'assignment', 'scheduler-compliance', 'alerts-audit', 'ml']) {
    assert.ok(charts.some((c) => c.dir === dir), dir);
    assert.ok(files[`${VIS_DIR}/${dir}/README.md`], `${dir}/README.md`);
  }
  assert.ok(files[`${VIS_DIR}/assignment/WORKED_EXAMPLE.md`]);
});

test('determinism: building twice gives byte-identical files, and they equal what is committed', () => {
  const again = buildAll(loadSources(root)).files;
  assert.deepStrictEqual(again, files);
  for (const [p, body] of Object.entries(files)) {
    assert.ok(existsSync(join(root, p)), `${p} is not on disk; run npm run evidence:visualize`);
    assert.strictEqual(readFileSync(join(root, p), 'utf8'), body, `${p} is stale; run npm run evidence:visualize`);
  }
});

test('every SVG has an opaque background, explicit colours, accessible names and a provenance footer', () => {
  for (const [p, svg] of svgs) {
    assert.ok(!svg.includes('currentColor'), `${p} uses currentColor`);
    assert.match(svg, /viewBox="0 0 800 \d+"/, p);
    assert.match(svg, /<rect x="0.5" y="0.5" width="799" height="\d+" rx="6" fill="#ffffff" stroke="#d0d7de"\/>/, `${p} has no opaque background`);
    assert.match(svg, /role="img"/, p);
    assert.match(svg, /<title id="t-[^"]+">[^<]+<\/title>/, p);
    assert.match(svg, /<desc id="d-[^"]+">[^<]+<\/desc>/, p);
    for (const m of svg.matchAll(/<text [^>]*>/g)) {
      assert.match(m[0], /fill="#[0-9a-fA-F]{6}"/, `${p}: ${m[0]}`);
      assert.ok(Number(/font-size="(\d+)"/.exec(m[0])[1]) >= 13, `${p}: small text ${m[0]}`);
    }
    assert.match(svg, /Provenance: (MEASURED|DERIVED|NOT AVAILABLE)/, p);
    assert.match(svg, /Source: /, p);
    assert.match(svg, /(commit [0-9a-f]{7}|@ [0-9a-f]{7})/, `${p} footer has no commit`);
    assert.match(svg, /(synthetic)/i, `${p} does not say synthetic`);
    for (const bad of ['undefined', 'NaN', '>null<', 'Infinity']) assert.ok(!svg.includes(bad), `${p} contains ${bad}`);
  }
});

test('footer provenance only uses the allowed classes (no TARGET or ESTIMATE: nothing citable)', () => {
  for (const ch of charts) {
    assert.match(ch.model.provenance, /^(MEASURED|DERIVED|NOT AVAILABLE)/, ch.file);
    assert.ok(!/TARGET|ESTIMATE/.test(ch.model.provenance), ch.file);
  }
});

test('benchmarks: plotted latencies equal the newest run file', () => {
  const nb = src.benches[src.benches.length - 1];
  for (const [key, field] of [['p50', 'p50ms'], ['p95', 'p95ms'], ['p99', 'p99ms']]) {
    const m = marks('benchmarks/read-latency.svg', key);
    assert.deepStrictEqual(m.map((x) => x.value), nb.reads.map((r) => r[field]), key);
  }
  assert.deepStrictEqual(marks('benchmarks/dataset-scale.svg').map((m) => m.value), [nb.data.applications, nb.data.deadlineItems, nb.data.openDeadlineItems, nb.data.assignments]);
  const dup = marks('benchmarks/duplicate-prevention.svg');
  assert.ok(dup.some((m) => m.series === 'suppressed' && m.value === nb.engine.secondCycle.alertsSuppressed));
  assert.ok(dup.some((m) => m.series === 'created' && m.value === nb.engine.firstCycle.newAlerts));
});

test('benchmarks: both runs are compared only when their machine blocks match, with the caveat', () => {
  assert.ok(!machineDiff(src.benches[0], src.benches[1]).length, 'the two committed runs should match');
  const ok = byKey('benchmarks/read-p95-runs.svg');
  assert.strictEqual(ok.model.notAvailable, null);
  assert.match(ok.svg, /Not a like-for-like comparison/);
  const bad = rebuild((s) => { s.benches[0].machine.cpus = 8; }).find((c) => c.file === 'read-p95-runs.svg');
  assert.match(bad.model.notAvailable, /cpus differ/);
  assert.deepStrictEqual(bad.model.marks, []);
});

test('an older run without the suppressed counter is not drawn as zero', () => {
  const c = rebuild((s) => { s.benches.forEach((b) => { delete b.engine.firstCycle.alertsSuppressed; delete b.engine.secondCycle.alertsSuppressed; }); }).find((x) => x.file === 'duplicate-prevention.svg');
  assert.match(c.model.notAvailable, /no benchmark run recorded the suppressed-alert counter/);
  assert.match(c.svg, /Not available:/);
});

test('workflow: funnel, statuses and transitions equal the snapshot', () => {
  const w = src.snap.workflow.data;
  assert.deepStrictEqual(marks('workflow/stage-funnel.svg').map((m) => [m.value, m.ref]), w.funnel.map((f) => [f.reached, f.onRoute]));
  const st = marks('workflow/status-distribution.svg');
  assert.deepStrictEqual(st.map((m) => m.value), w.statusDistribution.map((s) => s.count));
  assert.strictEqual(st.reduce((a, m) => a + m.value, 0), w.submittedTotal);
  assert.ok(st.some((m) => m.label === 'Approved with conditions') && st.some((m) => m.label === 'Waiting on college'));
  assert.deepStrictEqual(marks('workflow/stage-transitions.svg').map((m) => m.value), w.transitions.moves.map((m) => m.count));
  const p = byKey('workflow/processing-time.svg');
  assert.match(p.svg, new RegExp(`>${w.processingTime.medianWorkingDays}<`));
  assert.deepStrictEqual(p.model.marks.filter((m) => m.series === 'value').map((m) => m.value), [w.processingTime.decidedCount, w.processingTime.inFlightCount]);
  const days = byKey('workflow/volume-over-time.svg').model.marks;
  assert.strictEqual(days.filter((m) => m.series === 'submitted').length, w.volumeOverTime.length, 'only days present, no zero fill');
  assert.strictEqual(days.filter((m) => m.series === 'overdue').reduce((a, m) => a + m.value, 0), w.volumeOverTime.reduce((a, d) => a + d.overdue, 0));
});

test('a snapshot without the transitions measure draws "Not available", not an empty chart', () => {
  const c = rebuild((s) => { delete s.snap.workflow.data.transitions; }).find((x) => x.file === 'stage-transitions.svg');
  assert.match(c.model.notAvailable, /predates the transitions measure/);
  assert.match(c.svg, /Not available: this snapshot predates/);
});

test('assignment: officers sorted high to low with the cap, above-cap highlighted, distribution derived from the same list', () => {
  const o = src.snap.assignment.data.officers;
  const m = marks('assignment/utilisation-by-officer.svg', 'value');
  assert.strictEqual(m.length, o.length);
  assert.deepStrictEqual(m.map((x) => x.value), [...o].map((x) => x.utilisation).sort((a, b) => b - a));
  assert.ok(marks('assignment/utilisation-by-officer.svg', 'line').some((l) => l.value === 1));
  const above = o.filter((x) => x.utilisation > x.maxUtil);
  assert.strictEqual(m.filter((x) => /above cap/.test(x.text)).length, above.length);
  assert.match(byKey('assignment/utilisation-by-officer.svg').svg, /fill="#D55E00"/);
  assert.strictEqual(marks('assignment/utilisation-distribution.svg').reduce((a, x) => a + x.value, 0), o.length);
  assert.match(byKey('assignment/utilisation-distribution.svg').svg, /DERIVED/);
  const a = src.snap.assignment.data;
  assert.deepStrictEqual(marks('assignment/decisions-by-outcome.svg').map((x) => x.value), a.outcomes.map((x) => x.count));
  assert.deepStrictEqual(marks('assignment/candidates.svg').map((x) => x.value), [a.candidates.candidatesConsidered, a.candidates.eligible, ...a.candidates.excluded.map((e) => e.count)]);
});

test('worked example quotes the stored reason text verbatim and has the blocked decision and the above-cap explanation', () => {
  const we = files[`${VIS_DIR}/assignment/WORKED_EXAMPLE.md`];
  const asg = src.snap['assignment-trace-assigned'].rows.find((r) => r.outcome === 'ASSIGNED');
  const blk = src.snap['assignment-trace-blocked'].rows.find((r) => r.outcome === 'BLOCKED');
  assert.ok(we.includes(`> ${asg.reasonText}`));
  assert.ok(we.includes(`> ${blk.reasonText}`));
  for (const r of src.snap.assignment.data.continuityOverrides.rows) assert.ok(we.includes(`> ${r.text}`));
  assert.ok(we.includes(asg.candidates[0].name));
});

test('scheduler: open states sum to the open total and closed-out states are separate', () => {
  const d = src.snap.compliance.data.deadlines;
  const seg = byKey('scheduler-compliance/deadline-states.svg').model.marks;
  assert.deepStrictEqual(seg.filter((m) => m.series === 'segment').map((m) => m.value), [d.overdue, d.atRisk, d.dueSoon, d.onTrack]);
  assert.strictEqual(seg.find((m) => m.series === 'total').value, d.openTotal);
  assert.deepStrictEqual(seg.filter((m) => m.series === 'value').map((m) => m.value), [d.met, d.missed, d.paused, d.closed]);
  assert.deepStrictEqual(marks('scheduler-compliance/escalations.svg').map((m) => m.value), src.snap.compliance.data.escalations.map((e) => e.count));
  const runs = [...src.snap['engine-runs'].rows].sort((a, b) => Number(a.id) - Number(b.id));
  assert.deepStrictEqual(marks('scheduler-compliance/engine-run-duration.svg').map((m) => [m.label, m.value]), runs.map((r) => [r.id, r.durationMs]));
  assert.deepStrictEqual(marks('scheduler-compliance/alerts-per-run.svg', 'created').map((m) => m.value), runs.map((r) => r.alertsCreated));
  assert.deepStrictEqual(marks('scheduler-compliance/alerts-per-run.svg', 'suppressed').map((m) => m.value), runs.map((r) => r.alertsSuppressed));
  const rt = src.snap.compliance.data.alerts.reminderTiming;
  assert.deepStrictEqual(marks('scheduler-compliance/reminder-timing.svg', 'segment').map((m) => m.value), [rt.late, rt.onTime]);
});

test('alerts and audit: counts equal the snapshot, only days present, integrity card states its limits', () => {
  const a = src.snap.alerts.data;
  assert.deepStrictEqual(marks('alerts-audit/alerts-by-kind.svg').map((m) => m.value), a.byKind.map((k) => k.count));
  assert.deepStrictEqual(marks('alerts-audit/alerts-per-day.svg').map((m) => [m.label, m.value]), a.perDay.map((d) => [d.day, d.count]));
  const u = src.snap['audit-analytics'].data;
  assert.deepStrictEqual(marks('alerts-audit/audit-by-action.svg').map((m) => m.value), u.byAction.map((x) => x.count));
  assert.deepStrictEqual(marks('alerts-audit/audit-by-role.svg').map((m) => m.value), u.byActorRole.map((x) => x.count));
  assert.deepStrictEqual(marks('alerts-audit/audit-by-entity.svg').map((m) => m.value), u.byEntity.map((x) => x.count));
  const card = byKey('alerts-audit/audit-integrity.svg').svg;
  assert.match(card, /whole forward hash chain/);
  assert.match(card, /UPDATE or DELETE/);
  assert.match(card, /NOT tamper-proof/);
  assert.match(card, /database owner can disable the guard/);
  const note = byKey('alerts-audit/alert-handling-status.svg').svg;
  assert.match(note, /acknowledgement of an alert is not recorded/);
  assert.match(note, /DeadlineItem\.closedAt/);
});

test('ML: the four headline figures and the derived confusion matrix', () => {
  const svg = (k) => byKey(k).svg;
  const h = svg('ml/headline-metrics.svg');
  for (const v of ['0.975', '0.863', '0.315', '2.2%']) assert.ok(h.includes(`>${v}<`), v);
  assert.deepStrictEqual(marks('ml/confusion-matrix.svg', 'cell').map((m) => m.value), [863, 137, 22, 978]);
  assert.match(svg('ml/confusion-matrix.svg'), /equal to the stored precision 0\.975/);
  assert.match(svg('ml/confusion-matrix.svg'), /863 ÷ \(863 \+ 22\)/);
  const f = marks('ml/recall-by-fault.svg');
  assert.ok(f.some((m) => /Unit error/.test(m.label) && m.series === 'hybrid' && m.value === 0.315));
  assert.match(svg('ml/recall-by-fault.svg'), /fill="#fdf0e6"/, 'unit-error row is highlighted');
  const modes = marks('ml/baseline-modes.svg');
  assert.strictEqual(modes.length, 9);
  assert.ok(modes.every((m) => m.value >= 0 && m.value <= 1));
  assert.match(svg('ml/methodology.svg'), /NOT been validated on real AICTE/);
  assert.match(readFileSync(join(root, 'formcheck/EVALUATION.md'), 'utf8'), /Isolation Forest/, 'the methodology panel names the model type EVALUATION.md states');
});

test('a missing stored metric is "Not available", never zero', () => {
  const c = rebuild((s) => { delete s.metrics.perFault; }).find((x) => x.file === 'headline-metrics.svg');
  assert.match(c.model.notAvailable, /perFault\.unit_error is not in formcheck\/metrics\.json/);
  const d = rebuild((s) => { delete s.snap.compliance; }).find((x) => x.file === 'deadline-states.svg');
  assert.match(d.svg, /Not available:/);
});

test('wording rules: "fair" appears nowhere; 0.89 and 2.9% are never results; tamper-proof only in negation', () => {
  for (const [p, body] of Object.entries(files)) {
    assert.ok(!/\bfair/i.test(body), `${p} contains "fair"`);
    assert.ok(!/0\.89|2\.9%/.test(body), `${p} contains a retracted figure`);
    for (const m of body.matchAll(/[^\n]*tamper-proof[^\n]*/gi)) assert.match(m[0], /\b(not|NOT|cannot|no)\b/, `${p}: ${m[0]}`);
    assert.ok(!/production-ready/i.test(body) || /\b(not|no)\b[^.\n]*production-ready|production-ready[^.\n]*not/i.test(body), p);
  }
  const arch = readFileSync(join(root, VIS_DIR, 'architecture/README.md'), 'utf8');
  assert.ok(!/\bfair/i.test(arch));
});

test('every chart in a category README is embedded and explained in the four required parts', () => {
  for (const ch of charts) {
    const md = files[`${VIS_DIR}/${ch.dir}/README.md`];
    assert.ok(md.includes(`](${ch.file})`), `${ch.file} is not embedded`);
    const start = md.indexOf(`## ${ch.title}`);
    assert.ok(start >= 0, ch.title);
    const section = md.slice(start, md.indexOf('\n## ', start + 5) === -1 ? undefined : md.indexOf('\n## ', start + 5));
    if (ch.how === 'na') continue;
    for (const part of ['**What it shows.**', '**How it was measured.**', '**What you can reasonably conclude.**', '**What you cannot conclude.**']) assert.ok(section.includes(part), `${ch.file} lacks ${part}`);
  }
});

test('snapshot manifest is honest: commit, no credentials, synthetic statement, verification result', () => {
  const m = src.manifest;
  assert.match(m.commit.short, /^[0-9a-f]{7,}$/);
  assert.match(m.provenance, /synthetic/);
  assert.strictEqual(m.verification.disagree, 0);
  assert.strictEqual(m.verification.checks, m.verification.agree);
  assert.ok(!/password|postgres:\/\/|:\/\/[^/\s]*:[^@\s]*@/i.test(JSON.stringify(m)), 'manifest leaks a credential');
  assert.ok(m.rowCounts.Application > 0);
});

test('snapshot data files are unmodified API responses: definition, provenance, data', () => {
  for (const n of ['workflow', 'assignment', 'compliance', 'alerts', 'audit-analytics']) {
    const s = src.snap[n];
    assert.ok(s.definition && s.provenance && s.data, n);
  }
});

test('link checker: every relative link in README.md and docs/evidence/**/*.md resolves', () => {
  const broken = checkLinks(root, docFiles(root));
  assert.deepStrictEqual(broken, []);
});

test('link checker catches a missing file, a missing heading and ignores code blocks and URLs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'links-'));
  mkdirSync(join(dir, 'a'));
  writeFileSync(join(dir, 'a', 'x.md'), '# Real heading\n');
  writeFileSync(join(dir, 'a', 'y.md'), ['![ok](x.md)', '[ok](x.md#real-heading)', '![gone](nope.svg)', '[bad](x.md#missing)', '[web](https://example.com/q)', '```', '[code](not-checked.md)', '```', '`[inline](not-checked.md)`', '<img src="img-gone.png">'].join('\n'));
  const broken = checkLinks(dir, [join(dir, 'a', 'y.md')]);
  assert.deepStrictEqual(broken.map((b) => [b.target, b.reason]), [['nope.svg', 'file not found'], ['x.md#missing', 'heading not found'], ['img-gone.png', 'file not found']]);
});

test('the evidence documents do not link into the screenshots folder of the prototype UI', () => {
  for (const f of docFiles(root).filter((p) => p.includes('docs/evidence/visualizations'))) {
    assert.ok(!/docs\/screens\/evidence|screens\/evidence/.test(readFileSync(f, 'utf8')), f);
  }
  const all = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? all(join(d, f)) : [join(d, f)]));
  assert.ok(all(join(root, VIS_DIR)).length > 40);
});
