#!/usr/bin/env node
// The evidence-visualization pipeline: reads ONLY committed files and writes SVG charts plus the category READMEs that explain them.
//   npm run evidence:visualize            (node scripts/evidence-visualizations.mjs [--root <repo>] [--check])
//
// Inputs (the single source of truth; nothing is typed in here):
//   docs/evidence/visualizations/data/*.json   unmodified Evidence API responses, from `npm run evidence:snapshot`, plus manifest.json
//   docs/evidence/benchmark-results/*.json     load-test output, one file per run
//   formcheck/metrics.json                     the stored form-check evaluation (synthetic data)
// Output is deterministic: the same inputs give byte-identical files (no clock, no randomness; dates are the data's own).
// --check builds in memory and exits 1 if any file on disk differs, without writing.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chart, COLORS, SERIES_COLORS, validateBench, validateMetrics, loadJson, BENCH_HINT, METRICS_HINT, isNum, fmt, pct } from './evidence-charts.mjs';
import { categoryReadme, indexReadme, workedExample } from './evidence-visualizations-docs.mjs';

export const VIS_DIR = 'docs/evidence/visualizations';
const SNAP_NAMES = ['workflow', 'assignment', 'compliance', 'alerts', 'audit-analytics', 'engine-runs', 'summary', 'assignment-trace-assigned', 'assignment-trace-blocked'];
const MACHINE_FIELDS = ['cpus', 'cpuModel', 'memoryGb', 'node'];

class NotAvailable extends Error {}
export const na = (why) => new NotAvailable(why);

// ---------------------------------------------------------------- sources

export function loadSources(root) {
  const dataDir = join(root, VIS_DIR, 'data');
  const hint = 'npm run evidence:snapshot (needs the demo database; see docs/evidence/visualizations/METHODOLOGY.md)';
  const manifest = loadJson(join(dataDir, 'manifest.json'), hint);
  for (const k of ['generatedAt', 'commit', 'database', 'rowCounts', 'verification', 'provenance']) {
    if (manifest[k] === undefined) throw new Error(`manifest.json is missing ${k}. Produce it with: ${hint}`);
  }
  const snap = {};
  for (const n of SNAP_NAMES) {
    const p = join(dataDir, `${n}.json`);
    if (existsSync(p)) snap[n] = loadJson(p, hint);
  }
  const benchDir = join(root, 'docs/evidence/benchmark-results');
  const benches = readdirSync(benchDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const b = loadJson(join(benchDir, f), BENCH_HINT);
      validateBench(b);
      return { ...b, _file: `docs/evidence/benchmark-results/${f}` };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.commit.localeCompare(b.commit));
  if (!benches.length) throw new Error(`No benchmark JSON in ${benchDir}. Produce one with: ${BENCH_HINT}`);
  const metrics = loadJson(join(root, 'formcheck/metrics.json'), METRICS_HINT);
  validateMetrics(metrics);
  return { manifest, snap, benches, metrics };
}

const at = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const need = (o, path, why) => {
  const v = at(o, path);
  if (v === undefined || v === null) throw na(why ?? `${path} is not in the snapshot`);
  return v;
};

// ---------------------------------------------------------------- shared vocabulary

const STATUS_WORDS = { IN_STAGE: 'In progress', RETURNED: 'Waiting on college', APPROVED: 'Approved', APPROVED_WITH_CONDITIONS: 'Approved with conditions', REJECTED: 'Rejected', CLOSED: 'Closed' };
const FAULT_NAMES = { unit_error: 'Unit error on land area', builtup_over: 'Built-up larger than plot', faculty_short: 'Faculty shortage', expired_lease: 'Expired lease', bulk_missing: 'Bulk fill with missing documents' };
const MODE_ORDER = ['Rules only', 'Model only', 'Hybrid (rules or model)'];
const stateName = (s) => (s ? `${s.stage}/${s.status}` : 'new application');
const snapStamp = (m) => `Snapshot ${m.generatedAt.slice(0, 10)} · commit ${m.commit.short} · synthetic demo dataset`;
const benchStamp = (b) => `Benchmark run ${b.date.slice(0, 10)} · commit ${b.commit} · synthetic dataset, one shared machine`;
const snapSource = (name) => `${VIS_DIR}/data/${name}.json`;
const classes = (prov, keys) => [...new Set(keys.map((k) => prov?.[k]).filter(Boolean))].sort().join(' + ');

export function machineDiff(a, b) {
  const diffs = MACHINE_FIELDS.filter((f) => a.machine?.[f] !== b.machine?.[f]);
  if (a.pgVersion !== b.pgVersion) diffs.push('pgVersion');
  return diffs;
}

// ---------------------------------------------------------------- the chart registry

/**
 * Each entry: dir, file, title, subtitle, provenance(src), source(src), stamp(src), draw(c, src), docs(src).
 * `draw` throws na('reason') for a measure the inputs do not have: the chart then shows a "Not available" panel, never a zero.
 */
export function registry(src) {
  const { manifest, snap, benches, metrics } = src;
  const nb = benches[benches.length - 1];
  const ob = benches.length > 1 ? benches[benches.length - 2] : null;
  const bsrc = (b) => b._file;
  const R = [];
  const add = (e) => R.push(e);

  // ------------------------------------------------------------ benchmarks
  add({
    dir: 'benchmarks', file: 'read-latency.svg', title: 'Read latency per screen (p50, p95, p99)',
    subtitle: `Newest run, commit ${nb.commit}: ${nb.datasetSize?.toLocaleString('en-US') ?? nb.data.applications.toLocaleString('en-US')} applications; ${nb.reads[0].requests} requests per screen at concurrency ${nb.reads[0].concurrency}.`,
    provenance: () => 'MEASURED · SYNTHETIC dataset', source: () => bsrc(nb), stamp: () => benchStamp(nb),
    draw(c) {
      const series = [{ name: 'p50', color: SERIES_COLORS[0] }, { name: 'p95', color: SERIES_COLORS[1] }, { name: 'p99', color: SERIES_COLORS[2], hatch: true }];
      for (const r of nb.reads) for (const k of ['p50ms', 'p95ms', 'p99ms']) if (!isNum(r[k])) throw na(`${k} was not recorded for ${r.screen} in ${bsrc(nb)}`);
      c.groupedHbars({
        categories: nb.reads.map((r) => ({ label: r.screen, bars: [{ s: 0, value: r.p50ms }, { s: 1, value: r.p95ms }, { s: 2, value: r.p99ms }] })),
        series, unit: 'ms', axisTitle: 'response time (milliseconds); lower is better', labelW: 210,
      });
    },
  });

  add({
    dir: 'benchmarks', file: 'read-p95-runs.svg', title: 'p95 read latency, two recorded runs side by side',
    subtitle: ob ? `Runs ${ob.commit} (${ob.date.slice(0, 10)}) and ${nb.commit} (${nb.date.slice(0, 10)}).` : 'Needs two recorded runs.',
    provenance: () => 'MEASURED · SYNTHETIC dataset', source: () => (ob ? `${bsrc(ob)} and ${bsrc(nb)}` : bsrc(nb)), stamp: () => benchStamp(nb),
    draw(c) {
      if (!ob) throw na('only one benchmark run is recorded, so there is nothing to compare');
      const d = machineDiff(ob, nb);
      if (d.length) throw na(`the two runs were not taken on matching machines (${d.join(', ')} differ), so their latencies are not compared`);
      const series = [{ name: ob.commit, color: SERIES_COLORS[0], hatch: true }, { name: nb.commit, color: SERIES_COLORS[0] }];
      const cats = nb.reads.map((r) => {
        const o = ob.reads.find((x) => x.screen === r.screen);
        if (!o) return null;
        return { label: r.screen, bars: [{ s: 0, value: o.p95ms }, { s: 1, value: r.p95ms }] };
      }).filter(Boolean);
      if (!cats.length) throw na('the two runs measured no screen in common');
      c.groupedHbars({ categories: cats, series, unit: 'ms', axisTitle: 'p95 response time (milliseconds); lower is better', labelW: 210 });
      c.panel([
        { text: 'Not a like-for-like comparison.', weight: 600, fill: COLORS.orange },
        { text: `The machine blocks match on ${MACHINE_FIELDS.join(', ')} and PostgreSQL ${nb.pgVersion}, but each bar is ONE run on a shared machine with other work on it, the commits differ (the code changed between them) and the data differs slightly (${fmt(ob.data.deadlineItems)} vs ${fmt(nb.data.deadlineItems)} deadline items). No run-to-run variance was measured, so a difference of this size cannot be called a regression or an improvement.`, size: 13 },
      ]);
    },
  });

  const runSeries = (hatchFirst = true) => benches.map((b, i) => ({ name: b.commit, color: SERIES_COLORS[0], hatch: hatchFirst && i < benches.length - 1 }));
  add({
    dir: 'benchmarks', file: 'engine-cycle-duration.svg', title: 'Deadline engine: first cycle vs second cycle duration',
    subtitle: 'One engine cycle checks every open deadline item. Cycle 1 creates alerts; cycle 2 runs again on unchanged data.',
    provenance: () => 'MEASURED · SYNTHETIC dataset', source: () => benches.map(bsrc).join(', '), stamp: () => benchStamp(nb),
    draw(c) {
      c.groupedHbars({
        categories: ['firstCycle', 'secondCycle'].map((k, i) => ({ label: i ? 'Second cycle' : 'First cycle', bars: benches.map((b, s) => ({ s, value: b.engine[k].ms, text: `${(b.engine[k].ms / 1000).toFixed(1)} s (${fmt(b.engine[k].ms)} ms)` })) })),
        series: runSeries(), axisTitle: 'cycle duration (milliseconds); lower is better', labelW: 150,
      });
    },
  });

  add({
    dir: 'benchmarks', file: 'engine-cycle-alerts.svg', title: 'Deadline engine: new alerts in the first and second cycle',
    subtitle: 'The second cycle re-examines the same items; a correct engine creates no new alert for them.',
    provenance: () => 'MEASURED · SYNTHETIC dataset', source: () => benches.map(bsrc).join(', '), stamp: () => benchStamp(nb),
    draw(c) {
      c.groupedHbars({
        categories: ['firstCycle', 'secondCycle'].map((k, i) => ({ label: i ? 'Second cycle' : 'First cycle', bars: benches.map((b, s) => ({ s, value: b.engine[k].newAlerts })) })),
        series: runSeries(), unit: 'alerts', axisTitle: 'new alerts created in the cycle (count of alerts, not time)', labelW: 150,
      });
    },
  });

  add({
    dir: 'benchmarks', file: 'duplicate-prevention.svg', title: 'Duplicate alert prevention: created vs suppressed',
    subtitle: 'Suppressed = an attempt to log an alert that already existed (the unique key refused it). Only runs that measured it are drawn.',
    provenance: () => 'MEASURED · SYNTHETIC dataset', source: () => benches.filter((b) => isNum(b.engine.firstCycle.alertsSuppressed) && isNum(b.engine.secondCycle.alertsSuppressed)).map(bsrc).join(', ') || bsrc(nb), stamp: () => benchStamp(nb),
    draw(c) {
      const runs = benches.filter((b) => isNum(b.engine.firstCycle.alertsSuppressed) && isNum(b.engine.secondCycle.alertsSuppressed));
      if (!runs.length) throw na('no benchmark run recorded the suppressed-alert counter (runs before 2026-11-04 did not measure it)');
      const series = [{ name: 'created', color: SERIES_COLORS[0] }, { name: 'suppressed', color: SERIES_COLORS[1], hatch: true }];
      c.groupedHbars({
        categories: runs.flatMap((b) => ['firstCycle', 'secondCycle'].map((k, i) => ({ label: `${b.commit}: ${i ? 'cycle 2' : 'cycle 1'}`, bars: [{ s: 0, value: b.engine[k].newAlerts }, { s: 1, value: b.engine[k].alertsSuppressed }] }))),
        series, unit: 'alerts', axisTitle: 'alerts in the cycle (count)', labelW: 190,
      });
    },
  });

  add({
    dir: 'benchmarks', file: 'dataset-scale.svg', title: 'Benchmark dataset scale',
    subtitle: `Rows present when run ${nb.commit} was measured (${nb.data.seededApplications} were the seeded demo applications; the rest were bulk-loaded).`,
    provenance: () => 'MEASURED · SYNTHETIC dataset', source: () => bsrc(nb), stamp: () => benchStamp(nb),
    draw(c) {
      const d = nb.data;
      c.hbars({
        items: [{ label: 'Applications', value: d.applications }, { label: 'Deadline items', value: d.deadlineItems }, { label: 'Open deadline items', value: d.openDeadlineItems }, { label: 'Assignments', value: d.assignments }],
        axisTitle: 'rows in the database (count)', labelW: 190,
      });
    },
  });

  add({
    dir: 'benchmarks', file: 'throughput-errors.svg', title: 'Throughput and errors per screen',
    subtitle: `Newest run, commit ${nb.commit}. Errors = requests that did not return success.`,
    provenance: () => 'MEASURED · SYNTHETIC dataset', source: () => bsrc(nb), stamp: () => benchStamp(nb),
    draw(c) {
      c.table({
        cols: [{ h: 'Screen', w: 250 }, { h: 'Requests', w: 90, align: 'right' }, { h: 'Concurrency', w: 100, align: 'right' }, { h: 'Errors', w: 80, align: 'right' }, { h: 'Requests/s', w: 100, align: 'right' }, { h: 'Slowest (ms)', w: 110, align: 'right' }],
        rows: nb.reads.map((r) => [r.screen, fmt(r.requests), fmt(r.concurrency), fmt(r.errors), fmt(r.perSecond), fmt(r.maxMs)]),
        rowH: 30,
      });
    },
  });

  // ------------------------------------------------------------ workflow
  const wf = snap.workflow;
  const wfProv = (keys) => () => `${classes(wf?.provenance, keys) || 'MEASURED'} · SYNTHETIC demo data`;
  add({
    dir: 'workflow', file: 'stage-funnel.svg', title: 'Stage funnel: applications that reached each stage',
    subtitle: wf ? `${wf.data.submittedTotal} applications submitted (all dates). Each bar: reached; dashed outline: applications whose route includes the stage.` : '',
    provenance: wfProv(['funnel']), source: () => snapSource('workflow'), stamp: () => snapStamp(manifest),
    draw(c) {
      const f = need(wf, 'data.funnel', 'the workflow aggregate is not in the snapshot');
      c.hbars({
        items: f.map((s) => ({ label: s.label, value: s.reached, ref: s.onRoute, text: `${fmt(s.reached)} of ${fmt(s.onRoute)} on route` })),
        axisTitle: 'applications (count); a shorter bar is not drop-out when the stage is not on every route', labelW: 190,
      });
    },
  });

  add({
    dir: 'workflow', file: 'status-distribution.svg', title: 'Current status of every submitted application',
    subtitle: wf ? `${wf.data.submittedTotal} applications; the six counts add up to it.` : '',
    provenance: wfProv(['statusDistribution']), source: () => snapSource('workflow'), stamp: () => snapStamp(manifest),
    draw(c) {
      const d = need(wf, 'data.statusDistribution', 'the workflow aggregate is not in the snapshot');
      const colour = { IN_STAGE: COLORS.blue, RETURNED: COLORS.amber, APPROVED: COLORS.green, APPROVED_WITH_CONDITIONS: COLORS.green, REJECTED: COLORS.orange, CLOSED: COLORS.grey };
      c.hbars({
        items: d.map((s) => ({ label: STATUS_WORDS[s.status] ?? s.status, value: s.count, color: colour[s.status], text: `${fmt(s.count)} (${pct(s.share)})` })),
        axisTitle: 'applications (count), by current status', labelW: 190,
      });
    },
  });

  add({
    dir: 'workflow', file: 'volume-over-time.svg', title: 'Submitted, decided and overdue per day',
    subtitle: 'Only days on which something was recorded are drawn: days with nothing are left out, never shown as zero, and nothing is interpolated.',
    provenance: wfProv(['volumeOverTime']), source: () => snapSource('workflow'), stamp: () => snapStamp(manifest),
    draw(c) {
      const v = need(wf, 'data.volumeOverTime', 'the workflow aggregate is not in the snapshot');
      if (!v.length) throw na('no submission, decision or overdue event is recorded');
      c.timePanels({
        days: v,
        panels: [
          { key: 'submitted', label: 'Applications submitted that day', color: COLORS.blue },
          { key: 'decided', label: 'Applications decided that day', color: COLORS.green },
          { key: 'overdue', label: 'Deadline items with an overdue alert, plotted on their DUE date', color: COLORS.orange },
        ],
      });
      c.text('Horizontal axis: calendar day (real date scale). Vertical axes start at zero and each panel has its own scale.', { size: 13, fill: COLORS.muted });
    },
  });

  add({
    dir: 'workflow', file: 'processing-time.svg', title: 'Median working days from submission to decision',
    subtitle: 'Decided applications only. In-flight applications are not finished, so their time is not yet known.',
    provenance: wfProv(['processingTime']), source: () => snapSource('workflow'), stamp: () => snapStamp(manifest),
    draw(c) {
      const p = need(wf, 'data.processingTime', 'the workflow aggregate is not in the snapshot');
      if (!isNum(p.medianWorkingDays)) throw na('no application in the window has been decided, so no median exists');
      c.stat({ value: String(p.medianWorkingDays), label: `${p.unit} (median)`, caption: `Over the ${fmt(p.decidedCount)} decided applications. A further ${fmt(p.inFlightCount)} applications are in flight and are excluded, not counted as zero. No mean is given.` });
      c.hbars({
        items: [{ label: 'Decided (in the median)', value: p.decidedCount, color: COLORS.green }, { label: 'In flight (excluded)', value: p.inFlightCount, color: COLORS.grey }],
        axisTitle: 'applications (count); the two add up to all submitted applications', labelW: 190,
      });
    },
  });

  add({
    dir: 'workflow', file: 'stage-transitions.svg', title: 'Recorded stage and status changes, by action',
    subtitle: wf?.data?.transitions ? `${fmt(wf.data.transitions.total)} state-changing events of ${fmt(wf.data.transitions.applications)} applications. Counts are events, not applications.` : '',
    provenance: wfProv(['transitions']), source: () => snapSource('workflow'), stamp: () => snapStamp(manifest),
    draw(c) {
      const t = need(wf, 'data.transitions', 'this snapshot predates the transitions measure');
      c.hbars({
        items: t.moves.map((m) => ({ label: `${m.action}: ${stateName(m.from)} → ${stateName(m.to)}`, value: m.count })),
        axisTitle: 'recorded events (count); from → to is stage/status before and after the action', labelW: 400,
      });
    },
  });

  // ------------------------------------------------------------ assignment
  const asg = snap.assignment;
  const aProv = (keys) => () => `${classes(asg?.provenance, keys) || 'MEASURED'} · SYNTHETIC demo data`;
  const officers = () => {
    const o = need(asg, 'data.officers', 'the assignment aggregate is not in the snapshot');
    if (!o.length) throw na('no officer with the OFFICER role is recorded');
    return o;
  };
  add({
    dir: 'assignment', file: 'utilisation-by-officer.svg', title: 'Utilisation by officer, highest first',
    subtitle: asg ? `${asg.data.officers.length} officers, current open book. Utilisation = open points ÷ capacity points. Dashed line: the normal cap (1.00); bars above it are orange.` : '',
    provenance: aProv(['officers', 'utilisation']), source: () => snapSource('assignment'), stamp: () => snapStamp(manifest),
    draw(c) {
      const o = [...officers()].sort((a, b) => b.utilisation - a.utilisation || a.name.localeCompare(b.name));
      const caps = [...new Set(o.map((x) => x.maxUtil))];
      if (caps.length !== 1) throw na(`officers carry different caps (${caps.join(', ')}), so one cap line would be wrong`);
      const cap = caps[0];
      c.hbars({
        items: o.map((x) => ({
          label: x.name, value: x.utilisation, color: x.utilisation > cap ? COLORS.orange : COLORS.blue,
          text: `${x.utilisation.toFixed(2)}${x.utilisation > cap ? ` above cap (${x.openPoints} of ${x.capacityPoints} pts)` : ''}`,
        })),
        lines: [{ value: cap, label: `cap ${cap.toFixed(2)}` }], barH: 14, gap: 9, labelW: 160, valueW: 250,
        axisTitle: 'utilisation = open points ÷ capacity points (1.00 = at capacity)',
      });
    },
  });

  add({
    dir: 'assignment', file: 'utilisation-distribution.svg', title: 'How many officers sit at each utilisation level',
    subtitle: 'DERIVED: the same officer list as the previous chart, grouped into bands of 0.10. Nothing here is a new measurement.',
    provenance: () => `DERIVED from measured values · SYNTHETIC demo data`, source: () => snapSource('assignment'), stamp: () => snapStamp(manifest),
    draw(c) {
      const o = officers();
      const hi = Math.max(...o.map((x) => Math.floor(x.utilisation * 10 + 1e-9)));
      const bins = Array.from({ length: hi + 1 }, (_, i) => ({ lo: i, n: 0 }));
      o.forEach((x) => { bins[Math.floor(x.utilisation * 10 + 1e-9)].n += 1; });
      c.vbars({
        cats: bins.map((b) => ({ label: `${(b.lo / 10).toFixed(1)}`, values: [b.n] })),
        series: [{ name: 'officers', color: COLORS.blue }], yTitle: 'officers (count)', xTitle: 'utilisation band: lower edge of each 0.10-wide band (0.3 = 0.30 up to 0.39); 1.00 is the normal cap', h: 200,
      });
    },
  });

  add({
    dir: 'assignment', file: 'decisions-by-outcome.svg', title: 'Automatic assignment decisions by outcome',
    subtitle: asg ? `${fmt(asg.data.outcomes.reduce((a, o) => a + o.count, 0))} recorded decisions (decision tables exist for automatic assignment only).` : '',
    provenance: aProv(['coverage']), source: () => snapSource('assignment'), stamp: () => snapStamp(manifest),
    draw(c) {
      const o = need(asg, 'data.outcomes', 'the assignment aggregate is not in the snapshot');
      const col = { ASSIGNED: COLORS.blue, BLOCKED: COLORS.orange, BUREAU_OVERFLOW: COLORS.amber };
      c.hbars({ items: o.map((x) => ({ label: x.outcome, value: x.count, color: col[x.outcome] ?? COLORS.grey })), axisTitle: 'decisions (count)', labelW: 190 });
    },
  });

  add({
    dir: 'assignment', file: 'candidates.svg', title: 'Candidates considered, eligible and excluded',
    subtitle: 'Candidate rows across all recorded decisions: one decision evaluates many officers, so these are rows, not cases.',
    provenance: aProv(['candidates']), source: () => snapSource('assignment'), stamp: () => snapStamp(manifest),
    draw(c) {
      const k = need(asg, 'data.candidates', 'the assignment aggregate is not in the snapshot');
      c.hbars({
        items: [
          { label: 'Considered', value: k.candidatesConsidered }, { label: 'Eligible', value: k.eligible, color: COLORS.green },
          ...k.excluded.map((e) => ({ label: `Excluded: ${e.reason}`, value: e.count, color: COLORS.orange })),
        ],
        axisTitle: 'candidate rows (count)', labelW: 190,
      });
    },
  });

  // ------------------------------------------------------------ scheduler & compliance
  const comp = snap.compliance;
  const cProv = (keys) => () => `${classes(comp?.provenance, keys) || 'MEASURED'} · SYNTHETIC demo data`;
  add({
    dir: 'scheduler-compliance', file: 'deadline-states.svg', title: 'Deadline items: open states now, and closed-out states',
    subtitle: comp ? `As of ${comp.data.asOf} (the system's current date). The open states add up to the open total.` : '',
    provenance: cProv(['deadlines']), source: () => snapSource('compliance'), stamp: () => snapStamp(manifest),
    draw(c) {
      const d = need(comp, 'data.deadlines', 'the compliance aggregate is not in the snapshot');
      const sum = d.overdue + d.atRisk + d.dueSoon + d.onTrack;
      if (sum !== d.openTotal) throw na(`the four open states add up to ${sum}, not the open total ${d.openTotal}, so the bar is not drawn`);
      c.segBar({
        segments: [
          { label: 'Overdue', value: d.overdue, color: COLORS.orange }, { label: 'At risk (80% or more of allowed days used)', value: d.atRisk, color: COLORS.amber },
          { label: 'Due soon (within 30 days)', value: d.dueSoon, color: COLORS.blue }, { label: 'On track', value: d.onTrack, color: COLORS.green },
        ],
        total: d.openTotal, unit: 'items',
      });
      c.gap(14);
      c.text('Not part of the open total (counted separately):', { size: 14, weight: 600 });
      c.hbars({
        items: [{ label: 'Met on time', value: d.met, color: COLORS.green }, { label: 'Missed', value: d.missed, color: COLORS.orange }, { label: 'Paused', value: d.paused, color: COLORS.grey }, { label: 'Closed', value: d.closed, color: COLORS.grey }],
        axisTitle: 'deadline items (count)', labelW: 190,
      });
    },
  });

  add({
    dir: 'scheduler-compliance', file: 'escalations.svg', title: 'Escalation alerts by level',
    subtitle: 'Level 1, 2 and 3 are raised once per item when it is 3, 7 and 14 days overdue.',
    provenance: cProv(['escalations']), source: () => snapSource('compliance'), stamp: () => snapStamp(manifest),
    draw(c) {
      const e = need(comp, 'data.escalations', 'the compliance aggregate is not in the snapshot');
      if (!e.length) throw na('no escalation alert is recorded');
      const days = { 1: '3', 2: '7', 3: '14' };
      c.hbars({ items: e.map((x) => ({ label: `Level ${x.level}${days[x.level] ? ` (${days[x.level]} days overdue)` : ''}`, value: x.count, color: COLORS.orange })), unit: 'alerts', axisTitle: 'escalation alerts raised (count)', labelW: 190 });
    },
  });

  const runs = () => {
    const rows = need(snap['engine-runs'], 'rows', 'the engine-runs response is not in the snapshot');
    if (!rows.length) throw na('the engine has no recorded run');
    return [...rows].sort((a, b) => Number(a.id) - Number(b.id));
  };
  add({
    dir: 'scheduler-compliance', file: 'engine-run-duration.svg', title: 'Deadline engine run duration, per run',
    subtitle: snap['engine-runs'] ? `${snap['engine-runs'].total} recorded runs, in run order. Each run checks every open deadline item.` : '',
    provenance: () => 'MEASURED · SYNTHETIC demo data (runs on a simulated clock)', source: () => snapSource('engine-runs'), stamp: () => snapStamp(manifest),
    draw(c) {
      const r = runs();
      for (const x of r) if (!isNum(x.durationMs)) throw na(`run ${x.id} has no recorded duration`);
      c.vbars({ cats: r.map((x) => ({ label: x.id, values: [x.durationMs] })), series: [{ name: 'duration', color: COLORS.blue }], yTitle: 'duration of the run (milliseconds)', xTitle: 'engine run number (1 = oldest)', h: 220 });
    },
  });

  add({
    dir: 'scheduler-compliance', file: 'alerts-per-run.svg', title: 'Alerts created vs suppressed, per engine run',
    subtitle: 'Created = a new alert was logged. Suppressed = the unique key refused a repeat of an alert that already existed.',
    provenance: () => 'MEASURED · SYNTHETIC demo data (runs on a simulated clock)', source: () => snapSource('engine-runs'), stamp: () => snapStamp(manifest),
    draw(c) {
      const r = runs();
      for (const x of r) if (!isNum(x.alertsCreated) || !isNum(x.alertsSuppressed)) throw na(`run ${x.id} did not record both alert counters`);
      c.vbars({
        cats: r.map((x) => ({ label: x.id, values: [x.alertsCreated, x.alertsSuppressed] })),
        series: [{ name: 'created', color: SERIES_COLORS[0] }, { name: 'suppressed', color: SERIES_COLORS[1], hatch: true }],
        yTitle: 'alerts in the run (count)', xTitle: 'engine run number (1 = oldest); zero values are not labelled', h: 230,
      });
    },
  });

  add({
    dir: 'scheduler-compliance', file: 'reminder-timing.svg', title: 'Reminder alerts: on time vs late',
    subtitle: 'Late = raised more than one day after the reminder date. The log cannot tell a slow engine from an item created after its reminder date had passed.',
    provenance: cProv(['alerts']), source: () => snapSource('compliance'), stamp: () => snapStamp(manifest),
    draw(c) {
      const r = need(comp, 'data.alerts.reminderTiming', 'no engine run and no alert is recorded, so reminder timing was not measured');
      if (r.reminders === 0) throw na('no reminder alert is recorded');
      c.segBar({ segments: [{ label: 'Late (more than one day after the reminder date)', value: r.late, color: COLORS.orange }, { label: 'On time', value: r.onTime, color: COLORS.green }], total: r.reminders, unit: 'reminders' });
    },
  });

  // ------------------------------------------------------------ alerts & audit
  const al = snap.alerts;
  const au = snap['audit-analytics'];
  add({
    dir: 'alerts-audit', file: 'alerts-by-kind.svg', title: 'Alerts logged, by kind',
    subtitle: al ? `${fmt(al.data.total)} alerts. One row per deadline item, kind and level (digests: one per user per day).` : '',
    provenance: () => `${classes(al?.provenance, ['byKind']) || 'MEASURED'} · SYNTHETIC demo data`, source: () => snapSource('alerts'), stamp: () => snapStamp(manifest),
    draw(c) {
      const k = need(al, 'data.byKind', 'no engine run and no alert is recorded (none recorded, not zero)');
      c.hbars({ items: k.map((x) => ({ label: x.kind, value: x.count })), unit: 'alerts', axisTitle: 'alerts logged (count)', labelW: 190 });
    },
  });

  add({
    dir: 'alerts-audit', file: 'alerts-per-day.svg', title: 'Alerts logged per day',
    subtitle: 'Simulated calendar days on which at least one alert was logged. Days with none are omitted, not zero-filled.',
    provenance: () => `${classes(al?.provenance, ['perDay']) || 'MEASURED'} · SYNTHETIC demo data`, source: () => snapSource('alerts'), stamp: () => snapStamp(manifest),
    draw(c) {
      const p = need(al, 'data.perDay', 'no engine run and no alert is recorded');
      if (!p.length) throw na('no alert is recorded on any day');
      c.vbars({ cats: p.map((x) => ({ label: x.day, values: [x.count] })), series: [{ name: 'alerts', color: COLORS.blue }], yTitle: 'alerts logged that day (count)', xTitle: 'simulated calendar day (only days with alerts are shown)', h: 220 });
    },
  });

  const auditBars = (file, title, key, labelKey, axis, subtitle) =>
    add({
      dir: 'alerts-audit', file, title, subtitle,
      provenance: () => `${classes(au?.provenance, ['events']) || 'MEASURED'} (counts only) · SYNTHETIC demo data`, source: () => snapSource('audit-analytics'), stamp: () => snapStamp(manifest),
      draw(c) {
        const rows = need(au, `data.${key}`, 'the audit aggregate is not in the snapshot');
        c.hbars({ items: rows.map((x) => ({ label: x[labelKey], value: x.count })), axisTitle: axis, labelW: 190, barH: 16, gap: 10 });
      },
    });
  auditBars('audit-by-action.svg', 'Audit events by action', 'byAction', 'action', 'audit events (count)', au ? `${fmt(au.data.total)} audit events. Each event is counted once here; counts only, no case content.` : '');
  auditBars('audit-by-role.svg', 'Audit events by actor role', 'byActorRole', 'actorRole', 'audit events (count)', au ? `${fmt(au.data.total)} audit events, by the role that acted. Counts only.` : '');
  auditBars('audit-by-entity.svg', 'Audit events by entity', 'byEntity', 'entity', 'audit events (count)', au ? `${fmt(au.data.total)} audit events, by what they were about. Counts only.` : '');

  add({
    dir: 'alerts-audit', file: 'audit-integrity.svg', title: 'Audit integrity check: what it detects and what it does not',
    subtitle: 'Recomputed over the whole audit log when the snapshot was taken.',
    provenance: () => 'MEASURED at snapshot time (hashes recomputed) · SYNTHETIC demo data', source: () => snapSource('audit-analytics'), stamp: () => snapStamp(manifest),
    draw(c) {
      const i = need(au, 'data.integrity', 'the audit aggregate is not in the snapshot');
      c.stat({
        value: i.ok ? 'OK' : 'BROKEN', color: i.ok ? COLORS.green : COLORS.orange, label: `${fmt(i.chainsChecked)} chains, ${fmt(i.rowsChecked)} rows checked, ${fmt(i.brokenChainCount)} broken`,
        caption: `Scope: ${i.scope === 'WHOLE_LOG' ? 'the whole audit log' : i.scope}, not just the events counted in the other audit charts.`,
      });
      c.panel([
        { text: 'It detects', weight: 600 },
        { text: 'Any edit to an audit row that does not also recompute the whole forward hash chain after it, and any broken link in a chain.', size: 14 },
        { text: 'The application cannot hide it', weight: 600 },
        { text: 'The application role has no UPDATE or DELETE permission on audit rows (a database guard refuses them).', size: 14 },
      ]);
      c.panel([
        { text: 'It is NOT tamper-proof', weight: 600, fill: COLORS.orange },
        { text: 'The database owner can disable the guard and rewrite a whole chain consistently; that would pass this check. It reports damage after the fact; it does not prevent anyone with database owner access from changing rows.', size: 14 },
      ], { border: COLORS.orange });
    },
  });

  add({
    dir: 'alerts-audit', file: 'alert-handling-status.svg', title: 'What the alert data cannot say yet',
    subtitle: 'Two things a reader might ask for, and why neither is drawn.',
    provenance: () => 'NOT AVAILABLE (stated limits of the data)', source: () => snapSource('alerts'), stamp: () => snapStamp(manifest),
    draw(c) {
      const nr = need(al, 'data.notRecorded', 'the alerts aggregate is not in the snapshot');
      const nc = need(al, 'data.notComputed', 'the alerts aggregate is not in the snapshot');
      if (nr.includes('acknowledgement')) c.na('acknowledgement of an alert is not recorded. A notification has a read flag but no timestamp, and nothing records that someone acted on an alert.');
      if (nc.includes('time from alert to deadline item closing')) c.na('time from an alert to its deadline item closing is recorded per item (DeadlineItem.closedAt, linked by AlertLog.itemId) but it is not computed or charted in this package.');
      const n = need(al, 'data.notifications', 'the alerts aggregate is not in the snapshot');
      c.text(`Notifications created: ${fmt(n.total)}; marked read: ${fmt(n.read)}; unread: ${fmt(n.unread)}. ${n.informative ? '' : 'The read flag is not informative in this demo dataset, so no response-rate figure is drawn.'}`, { size: 14 });
    },
  });

  // ------------------------------------------------------------ ml
  const hyb = metrics.modes['Hybrid (rules or model)'];
  const ds = metrics.datasets;
  const mlStamp = () => `formcheck/metrics.json · evaluation run ${metrics.generatedAt.slice(0, 10)}${metrics.commit ? ' @ ' + metrics.commit : ''} · synthetic data`;
  add({
    dir: 'ml', file: 'headline-metrics.svg', title: 'Form-check headline metrics (hybrid mode)',
    subtitle: 'Advisory check on synthetic test forms. Every figure below is stored in formcheck/metrics.json.',
    provenance: () => 'MEASURED on SYNTHETIC test data', source: () => 'formcheck/metrics.json', stamp: mlStamp,
    draw(c) {
      const uf = metrics.perFault?.unit_error?.['Hybrid (rules or model)'];
      if (!isNum(uf)) throw na('perFault.unit_error is not in formcheck/metrics.json');
      c.table({
        cols: [{ h: 'Metric', w: 250 }, { h: 'Value', w: 100, align: 'right' }, { h: 'Basis', w: 400 }],
        rows: [
          ['Precision', hyb.precision.toFixed(3), 'stored: flagged forms that were faulty'],
          ['Recall, overall', hyb.recall.toFixed(3), 'stored: faulty forms that were flagged'],
          ['Recall, unit errors only', uf.toFixed(3), 'stored: the weak spot (see recall-by-fault)'],
          ['False-alarm rate', pct(hyb.false_alarm_rate), 'stored: normal forms wrongly flagged'],
        ],
        rowH: 34, boldFirst: true,
      });
      c.text(`Test set: ${fmt(ds.testFaulty)} faulty and ${fmt(ds.testNormal)} normal synthetic forms. Not validated on real AICTE applications.`, { size: 14, fill: COLORS.muted });
    },
  });

  add({
    dir: 'ml', file: 'confusion-matrix.svg', title: 'Confusion matrix (hybrid mode), derived from stored rates',
    subtitle: 'DERIVED, not stored: the evaluation stores rates, and these counts are rebuilt from them and the test-set sizes.',
    provenance: () => 'DERIVED from stored rates · SYNTHETIC test data', source: () => 'formcheck/metrics.json', stamp: mlStamp,
    draw(c) {
      const faulty = ds.testFaulty;
      const normal = ds.testNormal;
      const tp = Math.round(hyb.recall * faulty);
      const fn = faulty - tp;
      const fp = Math.round(hyb.false_alarm_rate * normal);
      const tn = normal - fp;
      const x0 = M_LEFT;
      const cw = 230;
      const ch = 74;
      const y0 = c.y + 40;
      c.t(x0 + 170 + cw / 2, y0 - 12, 'Flagged by the check', { size: 14, weight: 600, anchor: 'middle' });
      c.t(x0 + 170 + cw + 10 + cw / 2, y0 - 12, 'Not flagged', { size: 14, weight: 600, anchor: 'middle' });
      const cells = [
        ['Actually faulty', fmt(faulty) + ' forms', [['True positive', tp, COLORS.green], ['False negative', fn, COLORS.orange]]],
        ['Actually normal', fmt(normal) + ' forms', [['False positive', fp, COLORS.amber], ['True negative', tn, COLORS.blue]]],
      ];
      cells.forEach(([lab, sub, pair], r) => {
        const ry = y0 + r * (ch + 10);
        c.t(x0 + 160, ry + 32, lab, { size: 14, weight: 600, anchor: 'end' });
        c.t(x0 + 160, ry + 52, sub, { size: 13, anchor: 'end', fill: COLORS.muted });
        pair.forEach(([name, n, col], k) => {
          const cx = x0 + 170 + k * (cw + 10);
          c.rect(cx, ry, cw, ch, { fill: COLORS.panel, stroke: col, sw: 3, rx: 4 });
          c.t(cx + cw / 2, ry + 38, fmt(n), { size: 28, weight: 600, anchor: 'middle' });
          c.t(cx + cw / 2, ry + 62, name, { size: 14, anchor: 'middle', fill: COLORS.muted });
          c.model.marks.push({ series: 'cell', label: name, value: n, text: fmt(n) });
        });
      });
      c.y = y0 + 2 * (ch + 10) + 8;
      const prec = tp / (tp + fp);
      const lines = [
        `True positive = recall ${hyb.recall} × ${fmt(faulty)} faulty forms = ${fmt(tp)}.   False negative = ${fmt(faulty)} − ${fmt(tp)} = ${fmt(fn)}.`,
        `False positive = false-alarm rate ${hyb.false_alarm_rate} × ${fmt(normal)} normal forms = ${fmt(fp)}.   True negative = ${fmt(normal)} − ${fmt(fp)} = ${fmt(tn)}.`,
        `Check: ${fmt(tp)} ÷ (${fmt(tp)} + ${fmt(fp)}) = ${prec.toFixed(3)}, ${prec.toFixed(3) === hyb.precision.toFixed(3) ? `equal to the stored precision ${hyb.precision.toFixed(3)}` : `NOT equal to the stored precision ${hyb.precision.toFixed(3)}`}.`,
        'The stored rates are rounded to 3 decimals, so each count is good to about ±1 form.',
      ];
      c.panel(lines.map((text) => ({ text, size: 13 })));
    },
  });

  add({
    dir: 'ml', file: 'baseline-modes.svg', title: 'Rules only vs model only vs hybrid',
    subtitle: 'Precision, recall and false-alarm rate for the three ways of running the check (0 to 1; synthetic test forms).',
    provenance: () => 'MEASURED on SYNTHETIC test data', source: () => 'formcheck/metrics.json', stamp: mlStamp,
    draw(c) {
      const series = [{ name: 'precision', color: SERIES_COLORS[0] }, { name: 'recall', color: SERIES_COLORS[2] }, { name: 'false alarm', color: COLORS.orange, hatch: true }];
      const modes = MODE_ORDER.filter((m) => metrics.modes[m]);
      c.groupedHbars({
        categories: modes.map((m) => ({ label: m, bars: [{ s: 0, value: metrics.modes[m].precision, text: metrics.modes[m].precision.toFixed(3) }, { s: 1, value: metrics.modes[m].recall, text: metrics.modes[m].recall.toFixed(3) }, { s: 2, value: metrics.modes[m].false_alarm_rate, text: metrics.modes[m].false_alarm_rate.toFixed(3) }] })),
        series, max: 1, axisTitle: 'fraction of forms (0 to 1); higher is better for precision and recall, lower for false alarms', labelW: 180,
      });
    },
  });

  add({
    dir: 'ml', file: 'recall-by-fault.svg', title: 'Recall by fault type: the unit-error weakness',
    subtitle: 'Share of the 200 test forms of each fault type that each mode flagged.',
    provenance: () => 'MEASURED on SYNTHETIC test data', source: () => 'formcheck/metrics.json', stamp: mlStamp,
    draw(c) {
      const pf = metrics.perFault;
      if (!pf || !Object.keys(pf).length) throw na('perFault is not in formcheck/metrics.json');
      const series = [{ name: 'rules', color: SERIES_COLORS[0] }, { name: 'model', color: SERIES_COLORS[1], hatch: true }, { name: 'hybrid', color: SERIES_COLORS[2] }];
      const keys = Object.keys(pf);
      c.groupedHbars({
        categories: keys.map((k) => ({
          label: `${FAULT_NAMES[k] ?? k}${k === 'unit_error' ? ' (weakest)' : ''}`, highlight: k === 'unit_error',
          bars: MODE_ORDER.map((m, s) => ({ s, value: pf[k][m], text: pf[k][m].toFixed(3) })),
        })),
        series, max: 1, axisTitle: 'recall (0 to 1); higher is better', labelW: 200, prefix: true,
      });
    },
  });

  add({
    dir: 'ml', file: 'methodology.svg', title: 'How the form check was evaluated',
    subtitle: 'The conditions behind every figure on the other ML charts.',
    provenance: () => 'MEASURED on SYNTHETIC test data (descriptive panel)', source: () => 'formcheck/metrics.json, formcheck/EVALUATION.md', stamp: mlStamp,
    draw(c) {
      c.panel([
        { text: 'Model', weight: 600 },
        { text: `${metrics.model} (an Isolation Forest, per formcheck/EVALUATION.md). Decision threshold ${metrics.threshold} on the anomaly score.`, size: 14 },
        { text: 'Datasets', weight: 600 },
        { text: `Trained on ${fmt(ds.train)} synthetic forms. Tested on ${fmt(ds.testNormal)} normal and ${fmt(ds.testFaulty)} faulty synthetic forms, generated by the same program with a fixed seed.`, size: 14 },
        { text: 'Hybrid mode', weight: 600 },
        { text: 'A form is flagged if the rules flag it OR the model flags it.', size: 14 },
      ]);
      c.panel([
        { text: 'Limits', weight: 600, fill: COLORS.orange },
        { text: 'The check is advisory only: it never blocks filing and never changes routing, deadlines or assignment. All data is synthetic. It has NOT been validated on real AICTE applications, so none of these figures is a claim about real-world accuracy.', size: 14 },
      ], { border: COLORS.orange });
    },
  });

  return R;
}

const M_LEFT = 24;

// ---------------------------------------------------------------- build

/** Build every chart. A chart whose inputs lack a measure becomes a "Not available" panel; any other error aborts the build. */
export function buildCharts(src) {
  const out = [];
  for (const e of registry(src)) {
    const c = chart({ id: `${e.dir}-${e.file.replace(/\.svg$/, '')}`, title: e.title, subtitle: e.subtitle });
    let how = 'drawn';
    try {
      e.draw(c, src);
    } catch (err) {
      if (!(err instanceof NotAvailable)) throw new Error(`${e.dir}/${e.file}: ${err.message}`);
      how = 'na';
      const fresh = chart({ id: `${e.dir}-${e.file.replace(/\.svg$/, '')}`, title: e.title, subtitle: e.subtitle });
      fresh.na(err.message);
      out.push({ ...e, ...finish(fresh, e, src, 'NOT AVAILABLE'), how });
      continue;
    }
    out.push({ ...e, ...finish(c, e, src), how });
  }
  return out;
}

function finish(c, e, src, provOverride) {
  return c.render({ provenance: provOverride ?? e.provenance(src), source: e.source(src), stamp: e.stamp(src) });
}

/** Every file the pipeline owns: relative path -> content. */
export function buildAll(src) {
  const charts = buildCharts(src);
  const files = {};
  for (const ch of charts) files[`${VIS_DIR}/${ch.dir}/${ch.file}`] = ch.svg;
  for (const dir of [...new Set(charts.map((c) => c.dir))]) files[`${VIS_DIR}/${dir}/README.md`] = categoryReadme(dir, charts.filter((c) => c.dir === dir), src);
  files[`${VIS_DIR}/README.md`] = indexReadme(charts, src);
  const we = workedExample(src);
  files[`${VIS_DIR}/assignment/WORKED_EXAMPLE.md`] = we;
  return { files, charts };
}

function main() {
  const argv = process.argv.slice(2);
  const rootArg = argv.indexOf('--root');
  const root = rootArg >= 0 ? resolve(argv[rootArg + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { files, charts } = buildAll(loadSources(root));
  if (argv.includes('--check')) {
    const stale = Object.entries(files).filter(([p, body]) => !existsSync(join(root, p)) || readFileSync(join(root, p), 'utf8') !== body).map(([p]) => p);
    if (stale.length) {
      console.error(`${stale.length} generated file(s) differ from what the data produces:\n  ${stale.join('\n  ')}\nRun: npm run evidence:visualize`);
      process.exit(1);
    }
    console.log(`all ${Object.keys(files).length} generated files are up to date`);
    return;
  }
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  const na_ = charts.filter((c) => c.how === 'na').map((c) => `${c.dir}/${c.file}`);
  console.log(`wrote ${Object.keys(files).length} files (${charts.length} charts) under ${VIS_DIR}`);
  if (na_.length) console.log(`  drawn as "Not available": ${na_.join(', ')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
