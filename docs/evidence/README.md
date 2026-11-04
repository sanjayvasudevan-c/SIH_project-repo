# Evidence and Validation System

The Evidence Center is **built**: an administrator-only screen at `/admin/evidence` (Administration, then Evidence
Center) with eight sections, backed by a read-only API at `/api/evidence/*`. Audit findings that led to it are in
[`INITIAL_AUDIT.md`](INITIAL_AUDIT.md). It is a prototype screen over synthetic and demo data, not a production
monitoring tool.

## The one rule this system exists to enforce

Every number a judge sees must be traceable to a command they can run. Nothing in the Evidence Center is written
by hand, and no status is hardcoded. If a check has not run, it reads `NOT VERIFIED`, never green. The UI is a
viewer, never a source: the API computes each figure from stored rows or committed files, and the page only
draws it.

## The eight sections

Each section is a tab (a labelled select on a phone). "Date filter" means the section has a From/To range;
"current state" means that figure is read as of now and the dates do not change it.

| Section | What it shows | Date filter | Data provenance |
|---|---|---|---|
| Overview | Four headline cards (stored test verdict, applications in flight, last recorded scheduler cycle, audit integrity) each linking to its section, and a submitted/decided-per-day chart | none (all dates) | Test verdict from `test-results.json` (see below); the rest `LIVE_DEMO` / measured / derived from the database |
| Workflow | Stage funnel, current status of every submitted application, median working days to decision, applications over time | yes, by application submission date | Measured and derived from `Application`, deadline items and the audit log |
| Assignment | Officer utilisation against capacity, officers above their cap, decisions by outcome, and a "Show candidates" table of every officer considered for a decision with the stored reason | the workload panels are current state; the decisions panels filter by decision date | Measured and derived from `AssignmentTrace`, written by the assignment engine when it decides. Traces exist for automatic assignment only; manual assignment writes none, and the section says so |
| Scheduler & compliance | Overdue and at-risk deadline items now, engine run history (count, failures, abandoned runs, duration), duplicate alerts prevented | open-deadline panels are current state (as of the app's simulated today); run panels filter by the date the engine treated as today | `EngineRun` rows (one per engine cycle) and `AlertLog`; the simulated clock is labelled as such |
| Alerts | Alerts raised by kind and level, escalations, reminders raised late, alerts per day | yes, by alert date (the system's simulated calendar); notification counts are never windowed | Measured from `AlertLog` and `Notification`. Acknowledgement and resolution time are not recorded by this system and are shown as "insufficient data", not zero |
| Audit | Events by action, actor role and entity (counts only, no case content) and a live integrity check | yes for the three breakdowns (real-clock event time), plus role/action/entity selects; the integrity check always covers the whole log | Measured from `AuditLog`; integrity is recomputed on request over the whole log |
| ML evaluation | Precision, recall, false-alarm rate, F1, derived confusion matrix, rules-only vs model-only vs hybrid, recall per fault type | none (a stored evaluation) | `formcheck/metrics.json`, labelled **synthetic data** throughout |
| Performance | Test machine, read latency per screen (p50 / p95 / p99), deadline engine cycle times, duplicate alert prevention, comparison of the two recorded runs | none; a select chooses which recorded run to show | `docs/evidence/benchmark-results/*.json`, labelled benchmark on a synthetic dataset, one shared machine |

## The data-quality contract

Every panel follows the same rules, enforced in code (`web/src/pages/admin/evidence/Panel.tsx`) and tested:

* A figure is shown only with a **definition** ("How this is measured"), a **scope** line (what rows and which dates it
  covers) and a **provenance chip** (Measured, Derived, Synthetic data, Live demo data, Benchmark, Simulated clock,
  or "Source not declared"). If the API sends a figure without a definition or scope, the panel refuses to show it.
* Loading, error, empty and "insufficient data" are four different states. Missing data is never drawn as zero.
* Derived figures show how they were derived (for example the confusion matrix and its arithmetic check).
* Colour is never the only signal, and charts have a data table beside them.

## Verify it: `npm run evidence:verify`

Run from the repository root with the demo database up. It calls every Evidence Center API aggregate, then
recomputes each headline number with separate raw SQL written against the tables (it imports nothing from the
route code), on four date windows (all dates, last 30 days of the data, the busiest day, an empty range), and
compares them. Exit code 0 means every number agrees, 1 means a disagreement, 2 a configuration error. On the
dev database on 4 November 2026 it printed `250 checks, 250 agree, 0 disagree`.

What it proves: the API's aggregates match an independent query of the same database, so a bug in the aggregate
code (a wrong join, a double count) would show as a disagreement. What it does not prove: that the stored data is
true; that the SQL is right (two queries by the same team can share a misunderstanding); the individual
at-risk/due-soon/on-track split (only their sum is checked); recomputation of audit hashes (linkage and counts
only; the integrity card itself recomputes hashes); or that it is safe against a concurrent writer between the
two reads. Its database session is read-only and it writes no audit row.

## Screenshots

All eight sections at 1280 px and 390 px, taken against the dev database on 4 November 2026, are in
[`docs/screens/evidence/`](../screens/evidence/): `overview`, `workflow`, `assignment`, `scheduler`, `alerts`,
`audit`, `ml`, `performance`, each as `-desktop-1280.png` and `-mobile-390.png`. `assignment-why-*` shows the
candidate table open. On the dev database the Overview test-verification card reads **Not verified**, because no
`test-results.json` exists: that file is produced only by `npm run evidence:record-tests`, run locally (CI does not write it), and it has not been run on this checkout.

## Where the data comes from

Two stores, on purpose.

* **Database tables** for what the running system produces: `EngineRun` (one row per deadline-engine cycle, including
  `alertsSuppressed`, the count of `ON CONFLICT DO NOTHING` collisions, which directly measures duplicate-alert
  prevention) and `AssignmentTrace` (the candidate list the engine already computed, stored instead of discarded).
* **Files under `docs/evidence/`** for what a run produces once: `benchmark-results/*.json` (from
  `npm run load:test`, each carrying its commit hash, machine, `provenance` and repeat count) and the ML figures
  in `formcheck/metrics.json`. `test-results.json` (`{commit, status, passed, failed, notVerified, runAt}`) is written only by `npm run evidence:record-tests`,
  which runs the API suite locally against the dev database and records the result for the current HEAD. It is gitignored (a committed
  copy would describe an older commit after the next commit) and CI does not write it. The Overview card reads it and
  shows `Not verified` until the command has been run (and when the file is absent or malformed), and `STALE` when its commit is not the current HEAD. The
  API never computes a pass itself.

API (all `ADMIN` only, all read-only): `/api/evidence/summary`, `engine-runs`, `assignment-trace/:applicationId`,
`audit-integrity`, `artifacts`, and the section aggregates `workflow`, `assignment`, `compliance`, `alerts`,
`audit-analytics`.

## CI

`.github/workflows/ci.yml` runs on pushes to `main`, every pull request, a daily schedule and manual dispatch,
as five independent jobs (no `needs:`), so one can fail alone:

```
API typecheck                  prisma generate, then tsc --noEmit
Web build                      web tests (npm --workspace web run test), then vite build
API tests                      PostgreSQL 16 service container; uploads JUnit XML and commit.txt
Form-check tests and ML        generate, train, pytest; the reproducibility check is non-fatal
Chart generator tests          node --test scripts/*.test.mjs
```

`benchmark.yml` is separate, manual and weekly, never per pull request; it uploads results as a workflow artifact
and never commits. No lint job exists because the repository has no linter configured.

**CI has never run on GitHub.** The workflows are written and read back against the repository's commands, but
nothing here has been observed executing on GitHub's runners. CI uploads JUnit XML and `commit.txt` as workflow artifacts and does
not write `test-results.json`; the Overview test card changes only when `npm run evidence:record-tests` is run locally.

## What this system deliberately does not claim

* **No "production-ready" claim.** Phase 8 hardening (2FA, SSO, row-level security, DPDP review, audit shipping)
  is not in this build.
* **No tamper-proof-against-a-DBA claim.** The audit guard stops the *application* role, and the integrity check
  detects any edit that does not recompute the forward chain. The table owner can disable the trigger. The UI states this.
* **No exactly-once external delivery claim.** `AlertLog`'s unique key makes the *decision* to alert
  exactly-once. There is no external channel in this build, so there is nothing to deliver and nothing to claim.
  An outbox belongs with the real gateways in phase 8.
* **No real-AICTE accuracy claim.** Every ML figure is synthetic: 0.975 precision, 0.863 overall recall, 0.315
  recall on unit errors, 2.2% false alarms. The unit-error weakness is shown, not buried. The submission text's earlier
  "0.89" recall and "2.9%" false-alarm figures were wrong and are the claim being corrected.
* **No requirement coverage matrix.** It needs the official SIH26262 problem statement text, which is not in the
  repository. Paste it into `docs/evidence/PROBLEM_STATEMENT.md` and the matrix can be built against it. Writing it from a
  reading of the README would put a paraphrase in the "official requirement" column.
* Acknowledgement and resolution of alerts are not recorded, and the benchmark has two single runs on one
  shared machine, so no variance is claimed.

## The original plan, in value order

Written before the build, kept for the record. Status today: items 2 and 3 are built and item 4 is partly built (commit hash, p99, throughput, error count and a JSON file per run exist; there is no CSV and only one dataset size and one concurrency level); item 1 is written but has never run on GitHub; item 6 (decision trace) is not built. Items 0, 5 and 7 were not re-checked for this update.

| # | Work | Why it ranks here | Size |
|---|---|---|---|
| **0** | **Correct the ML recall claim** (0.89 → 0.863, 2.9% → 2.2%) in the description, abstract and deck | The only item that can actively *lose* marks. Costs minutes. | XS |
| **1** | **CI pipeline** (typecheck, 183 + 99 tests; a lint stage is not built and would need a linter configured first) | Turns "the tests pass" into a verifiable badge, and stops the next date bomb. Nothing to build — the tests exist. | S |
| **2** | **`EngineRun` + scheduler history** | Closes the one MISSING item in an otherwise fully tested subsystem, and `alertsSuppressed` measures duplicate prevention directly. | M |
| **3** | **`AssignmentTrace` + Evidence Center tabs A–E** | The judge-facing core: workflow, assignment fairness, scheduler, audit integrity. Answers "is it explainable and fair" with live data. | L |
| **4** | **Benchmark provenance** — commit hash, p99, throughput, error rate, JSON + CSV artifacts, more than one dataset size and concurrency level | Makes the strongest existing claim reproducible instead of a dated note. | M |
| **5** | **Failure-recovery tests** (DB unavailable, scheduler killed mid-cycle, duplicate request, unauthorised access, bad upload, invalid rule) | New ground, genuinely strengthens the reliability story. | M |
| **6** | **Decision trace** — store per-condition pass/fail at evaluation, surface on the case | The remaining PARTIAL in rules; highest effort, and the engine is already correct, so it buys inspectability only. | L |
| **7** | **Judge technical guide + 5-minute demo plan** | Needs 1–6 to describe. | S |
| — | **Requirement coverage matrix** | **Blocked** — see the limits above. | — |
