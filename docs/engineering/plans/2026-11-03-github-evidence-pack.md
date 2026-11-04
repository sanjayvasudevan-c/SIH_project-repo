# GitHub Evidence Pack Implementation Plan

> Historical implementation plan retained for its design rationale and audit trail. Current evaluator documentation is in [`docs/evaluation/README.md`](../../evaluation/README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make this repository's already-measured engineering legible to an SIH evaluator in about two minutes, from the landing page, without cloning or signing in.

**Architecture:** Repo-native only. Mermaid for flows (GitHub renders it natively), committed SVG for quantitative charts, every chart emitted by a committed generator script from real run output so no figure is typed by hand. Three producers write JSON (`vitest`, `load:test`, `evaluate.py`); one generator turns that JSON into SVG; six Markdown artifacts and a README section present it.

**Tech Stack:** Node 22 (plain ESM scripts, no chart library — hand-rolled SVG strings), TypeScript for the `load-test.ts` change, Python 3.13 for `evaluate.py`, Markdown + Mermaid, PostgreSQL 16 locally for the benchmark run.

**Spec:** `docs/engineering/specs/2026-11-03-github-evidence-design.md`

## Global Constraints

- **Only reproducible figures.** ML figures are precision **0.975**, recall **0.863**, false-alarm rate **2.2%**. The submission text's 0.89 / 2.9% must appear nowhere in the repo.
- **No tamper-proof-against-a-DBA claim.** The honest wording: the application role cannot UPDATE or DELETE audit rows, and any edit that does not recompute the whole forward chain is detected.
- **No exactly-once external delivery claim.** `AlertLog`'s unique key makes the *decision* to alert exactly-once. No external channel exists in this build.
- **No production-ready claim.** Phase 8 hardening is absent and must be stated as absent.
- **All ML and benchmark data is labelled synthetic.**
- **Limitations sit inline**, under the number they qualify — never in a trailing section.
- **Charts must be legible at phone width** and in both GitHub themes: use `currentColor` for text and axes, embed commit hash and run date as a caption.
- **Argue from design properties, never from feature claims about other products.** No "e-Office cannot do X".
- **Branch:** `claude/new-session-35imia`. Commit after every task. Do not open a PR.

## Review Focus

Five conditions the spec implies that no artifact's own content exercises:

1. **A chart generated when a producer JSON file is missing** — the generator must fail with a message naming the missing file and the command that produces it, not write a chart with `undefined` in it. Test in Task 3.
2. **A benchmark re-run that comes out worse than the 26 Oct figures** — publishes as measured; the generator must not silently reuse a stale JSON. Pinned by the commit-hash caption test in Task 3.
3. **Mermaid that GitHub fails to render** — a diagram with a syntax error renders as a raw code block, which looks broken to an evaluator. Verified in Task 4.
4. **A moved `FEATURE_INVENTORY.md` leaving two live references behind** in `demo-production/README.md:16` and `demo-production/PLAN.md:7`. Fixed and grepped in Task 5.
5. **An SVG with text that overflows its viewBox at phone width** — long screen names ("Action Center summary (senior)") are the specific risk. Pinned by the label-truncation test in Task 3.

---

### Task 1: Benchmark provenance in `load-test.ts`

**Files:**
- Modify: `api/scripts/load-test.ts` (the `report` object and `main()`, lines ~118-140; `readLoad` around line 113)

**Interfaces:**
- Produces: a JSON file at the path given by `--out <path>`, shape below. Tasks 3 and 6 consume it.

```jsonc
{
  "commit": "8140a1f",            // new
  "datasetSize": 15000,           // new, from TARGET
  "pgVersion": "16.15",           // new
  "date": "...", "machine": { "cpus": 4, "cpuModel": "...", "memoryGb": 16, "node": "v22.22.0" },
  "data": { "seededApplications": 192, "applications": 15000, "deadlineItems": 27349, "openDeadlineItems": 13979, "assignments": 17264, "bulkLoadMs": 4500 },
  "engine": { "firstCycle": { "ms": 140000, "newAlerts": 9277, "result": {} }, "secondCycle": { "ms": 74000, "newAlerts": 0, "result": {} } },
  "reads": [{ "screen": "...", "requests": 400, "concurrency": 20, "errors": 0, "p50ms": 471, "p95ms": 624, "p99ms": 0, "maxMs": 782, "perSecond": 42 }]
}
```

- [ ] **Step 1: Add `p99ms` to the `reads` entries**

In `readLoad`, add `p99ms: pct(times, 99)` to the pushed object, between `p95ms` and `maxMs`. `pct` already exists at line 74.

- [ ] **Step 2: Add provenance fields to `report`**

In `main()`, add to the `report` object literal: `commit` from `git rev-parse --short HEAD` (`execSync`, trimmed, `'unknown'` on throw), `datasetSize: TARGET`, and `pgVersion` from `SELECT version()` via `prisma.$queryRaw`, reduced to the bare version number.

- [ ] **Step 3: Write the file when `--out` is given**

Parse `--out <path>` from `process.argv`. When present, `mkdir -p` its directory and write the same JSON that is printed. Keep the `console.log` unconditional so existing use is unchanged.

- [ ] **Step 4: Verify the flag works without a full run**

Run: `cd api && npx tsx --env-file-if-exists=../.env -e "process.argv.push('--out','/tmp/x.json')" 2>&1 | head -2`
Expected: no parse error. Then confirm `tsc --noEmit` is clean:
Run: `npm --workspace api run typecheck`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add api/scripts/load-test.ts
git commit -m "Load test: record commit, dataset size and p99, and write a JSON report"
```

---

### Task 2: Machine-readable ML metrics

**Files:**
- Modify: `formcheck/training/evaluate.py` (the `main()` tail that writes `EVALUATION.md`)
- Create: `formcheck/metrics.json` (generated, committed)

**Interfaces:**
- Produces: `formcheck/metrics.json`. Tasks 3 and 6 consume it.

```jsonc
{
  "model": "application_form_v1", "threshold": 0.5794,
  "datasets": { "train": 4000, "testNormal": 1000, "testFaulty": 1000, "synthetic": true },
  "modes": { "Rules only": { "precision": 1.0, "recall": 0.859, "false_alarm_rate": 0.0 }, "Model only": {}, "Hybrid (rules or model)": {} },
  "perFault": { "unit_error": { "Rules only": 0.295, "Model only": 0.07, "Hybrid (rules or model)": 0.315 } }
}
```

- [ ] **Step 1: Write `metrics.json` alongside `EVALUATION.md`**

Immediately before `(ROOT / "EVALUATION.md").write_text(...)`, dump the same `results` and `per_fault` objects already in scope to `ROOT / "metrics.json"` with `json.dump(..., indent=2)`. Reuse the existing values; do not recompute. `synthetic` is the literal `True`.

- [ ] **Step 2: Regenerate and check both files agree**

Run: `cd formcheck && python3 -m training.evaluate >/dev/null && python3 -c "import json;d=json.load(open('metrics.json'));print(d['modes']['Hybrid (rules or model)'])"`
Expected: `{'precision': 0.975, 'recall': 0.863, 'false_alarm_rate': 0.022}` — the Global Constraints figures. Also confirm `EVALUATION.md` is unchanged:
Run: `git diff --stat formcheck/EVALUATION.md`
Expected: no change.

- [ ] **Step 3: Commit**

```bash
git add formcheck/training/evaluate.py formcheck/metrics.json
git commit -m "Form check: emit metrics.json beside EVALUATION.md"
```

---

### Task 3: The chart generator

**Files:**
- Create: `scripts/evidence-charts.mjs`
- Create: `scripts/evidence-charts.test.mjs`
- Create (generated): `docs/evidence/charts/read-latency.svg`, `engine-cycle.svg`, `dataset-scale.svg`, `formcheck-modes.svg`

**Interfaces:**
- Consumes: Task 1's benchmark JSON, Task 2's `formcheck/metrics.json`.
- Produces: `node scripts/evidence-charts.mjs --bench <path> --metrics <path> --out <dir>`. Exported for the test: `barChart({title, caption, series, max, unit}) -> string` where `series` is `[{label, value}]`; `truncate(label, maxChars) -> string`.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/evidence-charts.test.mjs — run with: node --test scripts/
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/`
Expected: FAIL — cannot find module `./evidence-charts.mjs`.

- [ ] **Step 3: Implement `scripts/evidence-charts.mjs`**

Export `truncate(label, maxChars)` (appends `…` when cut), `loadJson(path, hint)` (throws an `Error` naming the path and the producing command), and `barChart(opts) -> string` (horizontal bars, `currentColor` for text/axis, one theme-neutral accent `#1E7B45` for fills, caption line at the foot). A `main()` guarded by `import.meta.url` check parses `--bench`, `--metrics`, `--out` and writes the four SVGs:

| File | Series |
|---|---|
| `read-latency.svg` | one bar per `reads[]` entry, `p95ms`, labelled with `screen` |
| `engine-cycle.svg` | `engine.firstCycle.newAlerts` vs `engine.secondCycle.newAlerts` — the duplicate-prevention result |
| `dataset-scale.svg` | `data.applications`, `data.deadlineItems`, `data.openDeadlineItems`, `data.assignments` |
| `formcheck-modes.svg` | recall per mode from `metrics.modes` |

Caption on every chart: `commit <bench.commit> · <bench.date as YYYY-MM-DD> · synthetic data`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/evidence-charts.mjs scripts/evidence-charts.test.mjs
git commit -m "Add the evidence chart generator"
```

---

### Task 4: Workflow diagrams

**Files:**
- Create: `docs/evidence/WORKFLOW.md`

**Interfaces:**
- Consumes: nothing. Produces: a document Task 7's README section links to.

- [ ] **Step 1: Write the four Mermaid diagrams**

Source each from the code, and cite the file under each diagram:

| Diagram | Source | Must show |
|---|---|---|
| Case lifecycle | `api/src/workflow/transitions.ts` | the permitted transitions and who holds the case in each state |
| Assignment decision | `api/src/assignment/engine.ts` | eligibility filters → continuity → lowest load score → Bureau overflow → blocked queue |
| Escalation ladder | `api/src/engine/cycle.ts` | at-risk at 80% of SLA, then overdue, then 3 / 7 / 14 days to senior / super senior / HoD, and that the clock pauses while the college holds the file |
| Rule-pack publish | `api/src/rules/versions.ts` | draft → submit → approve → publish, maker-checker, and that filed cases stay pinned to their version |

Keep each under about 12 nodes so it reads at phone width. One sentence of prose above each saying what it proves.

- [ ] **Step 2: Commit and push**

```bash
git add docs/evidence/WORKFLOW.md
git commit -m "Docs: workflow diagrams"
git push origin claude/new-session-35imia
```

- [ ] **Step 3: Verify every diagram renders on GitHub**

Open `docs/evidence/WORKFLOW.md` on github.com. Expected: four rendered diagrams. A Mermaid syntax error renders as a raw code block instead — fix it and push again if so.

---

### Task 5: Architecture versus prototype

**Files:**
- Create: `docs/evidence/ARCHITECTURE_VS_PROTOTYPE.md` (from `git mv`)
- Delete: `demo-production/FEATURE_INVENTORY.md`
- Modify: `demo-production/README.md:16`, `demo-production/PLAN.md:7`

- [ ] **Step 1: Move the file, preserving history**

```bash
git mv demo-production/FEATURE_INVENTORY.md docs/evidence/ARCHITECTURE_VS_PROTOTYPE.md
```

- [ ] **Step 2: Re-source it against the current commit**

Its header cites commit `d0f97d9`. Update to the current commit and today's date, and reconcile its status column against `docs/evidence/INITIAL_AUDIT.md` — in particular the seed fix, and the three claims in Global Constraints. Add a short opening section: the phases 0–8 architecture against what is built, with the ~40% figure stated plainly as deliberate scope (phases 0–4 plus rule packs and the government-style interface), not as a shortfall.

- [ ] **Step 3: Fix the two references and prove none remain**

Run: `grep -rn 'FEATURE_INVENTORY' . --exclude-dir=node_modules --exclude-dir=.git`
Expected: only `docs/engineering/specs/...` (the design doc's own prose) — no live links in `demo-production/`.

- [ ] **Step 4: Commit**

```bash
git add -A demo-production docs/evidence/ARCHITECTURE_VS_PROTOTYPE.md
git commit -m "Docs: surface the feature inventory as the architecture-vs-prototype evidence"
```

---

### Task 6: Benchmarks, run for real

**Files:**
- Create: `docs/evidence/benchmark-results/<commit>.json`, `docs/evidence/BENCHMARKS.md`, `docs/evidence/charts/*.svg`

**Interfaces:**
- Consumes: Task 1's `--out`, Task 3's generator.

- [ ] **Step 1: Run the benchmark against the local database**

Run: `cd api && npm run load:test -- --out ../docs/evidence/benchmark-results/$(git rev-parse --short HEAD).json`
Expected: ~7 minutes, exit 0, the file exists. **Local database only** — this resets the demo database at both ends; never run it against the hosted Neon one.

- [ ] **Step 2: Generate the charts**

Run: `node scripts/evidence-charts.mjs --bench docs/evidence/benchmark-results/<commit>.json --metrics formcheck/metrics.json --out docs/evidence/charts`
Expected: four SVGs written.

- [ ] **Step 3: Write `BENCHMARKS.md` around the measured numbers**

Embed the four charts. State the method, the environment from `machine`, the dataset size, and the exact command to reproduce. Put each limitation inline under the number it qualifies: the full cycle exceeds the demo's one-minute schedule at this scale (batching is the planned fix); team report and applications list are the slowest reads (read replica and paging are the plan); single machine, synthetic data, not a production benchmark. **If any figure is materially worse than the 26 Oct run in `docs/LOAD_TEST.md`, publish as measured and note the difference** — do not drop it.

- [ ] **Step 4: Verify no unreproducible figure slipped in**

Run: `grep -rn '0\.89\|2\.9%' docs/evidence/ README.md`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add docs/evidence/benchmark-results docs/evidence/charts docs/evidence/BENCHMARKS.md
git commit -m "Docs: benchmark evidence with generated charts from a real run"
```

---

### Task 7: Comparison, feasibility, and the README section

**Files:**
- Create: `docs/evidence/COMPARISON.md`, `docs/evidence/FEASIBILITY.md`
- Modify: `README.md` (new section near the top, above the existing quick start)

- [ ] **Step 1: Write `COMPARISON.md` from design properties**

One row per property, each citing the file that implements it: a filed case keeps the rules it was filed under when the handbook changes mid-cycle (`rules/filing.ts`, `Application.rulePackVersionId`); only provably relaxing changes reach live cases (`applyScope`); clocks pause while the college holds the file (`engine/cycle.ts`); the Action Center never counts the college's time against an officer (`engine/flags.ts`); audit is a DB-enforced hash chain (`lib/audit.ts`, `prisma/sql/001_audit_guard.sql`); every assignment carries a reason (`Assignment.reasonText`). For each, one line on what a generic workflow tool would have to add. **Name no product's features** — categories only.

- [ ] **Step 2: Write `FEASIBILITY.md`**

Zero licence cost (the whole stack is open source), rollout MVP → single-region pilot → national (months 0-3 / 4-9 / 10-18), NIC or MeghRaj hosting, phase 8 security work listed as absent, and what needs real AICTE validation: the 2026-27 timelines, the escalation titles, and the placeholder application windows. State that the impact figures (about 50% less follow-up, 60 → 40 days) are **pilot targets with no measured baseline**.

- [ ] **Step 3: Add the README section**

Near the top, above the quick start so it is not pushed below the fold: three lines on what this is, static badges with values from the real runs (183 API tests, 99 form-check tests, typecheck clean, web build clean), a table linking the five evidence documents with one line each, and a `verify it yourself` fenced block of the exact commands with their expected output. Badges are static shields while there is no CI; a live CI badge replaces them when CI lands.

- [ ] **Step 4: Verify the links resolve and the quick start is still above the fold**

Run: `grep -o 'docs/evidence/[A-Za-z_]*\.md' README.md | sort -u | while read f; do test -f "$f" && echo "OK $f" || echo "MISSING $f"; done`
Expected: every line `OK`.

- [ ] **Step 5: Commit and push**

```bash
git add README.md docs/evidence/COMPARISON.md docs/evidence/FEASIBILITY.md
git commit -m "Docs: comparison, feasibility and the README evidence section"
git push origin claude/new-session-35imia
```

---

### Task 8: Whole-pack check

- [ ] **Step 1: Re-run both suites to confirm nothing regressed**

Run: `npm test && cd formcheck && python3 -m pytest -q`
Expected: 183 passed, 99 passed.

- [ ] **Step 2: Read every artifact on github.com as an evaluator would**

Confirm: Mermaid renders, SVGs render in both themes, no broken links, no figure outside Global Constraints, and the three forbidden claims are absent.

- [ ] **Step 3: Commit any fixes and push**
