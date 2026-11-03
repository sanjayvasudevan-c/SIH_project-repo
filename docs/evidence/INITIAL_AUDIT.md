# Initial audit (Phase 1)

Everything below was measured by running the code in this repository, not read off the README. Where a claim
could not be checked in this environment it is marked `NOT VERIFIED` and the reason is given.

## Run provenance

| | |
|---|---|
| Commit audited | `75731a8` (`75731a80b425549fc16bbdd3f4ba11d8285c565c`), branch `claude/new-session-35imia` |
| Date of run | 3 November 2026 |
| Environment | Linux container, PostgreSQL 16.15 (local cluster, not Docker), Node v22.22.0, Python 3.13.17 |
| Database | local cluster seeded with `npm --workspace api run setup:db` |
| Not exercised | the live Vercel deployment, the Neon database, the Docker Compose stack (no Docker daemon in this container) |

## Commands run and their actual results

| Command | Result |
|---|---|
| `npm --workspace api run prisma:generate` | success |
| `npm --workspace api run setup:db` | success. Measured since on the seeded database: 191 applications (the count varies between 191 and 192 between setups), 207 users (20 of them with documented demo logins), 120 institutions, 4 rule pack versions; form checks NONE 174 / HIGH 18 in the first run. Reproduce each count with `psql "$DATABASE_URL" -c 'SELECT count(*) FROM "User"'` (likewise `"Institution"`, `"Application"`, `"RulePackVersion"`) |
| `npm test` (vitest, 21 files) | **182 passed, 1 failed** before the fix below; **183 passed, 0 failed** after it |
| `npm --workspace api run typecheck` (`tsc --noEmit`) | clean, no errors |
| `npm --workspace web run build` (`tsc -b && vite build`) | success; warns that the JS chunk is 919 kB (266 kB gzipped) |
| `cd formcheck && python3 -m pytest -q` | **99 passed** |
| `cd formcheck && python3 -m training.evaluate` | success; regenerated `EVALUATION.md` **byte-identical** to the committed file |

The API test suite is not a set of mocked unit tests: it boots the real Express app with `supertest` and runs
against a real PostgreSQL database, recreated from a template before each test (`api/test/helpers.ts`,
`resetDb()`). That makes it strong evidence — the state transitions, audit rows and locks are genuinely exercised.

## Defect found and fixed during this audit

**`rules-a11.test.ts` → "a live window extension with a new-cases-only document leaves filed cases pinned
(demo step 11)" failed.** It was not a flake: it reproduced in isolation and it would have failed on every run
from 3 November 2026 onward.

Root cause — two different clocks were compared:

* `api/test/env.ts` pins the test clock to `TEST_TODAY = 2026-11-02`, so a rule pack published inside a test is
  stamped `publishedAt = 2026-11-02T10:00Z` (`publishVersion` uses `clock.now()`, `api/src/rules/versions.ts:267`).
* `api/prisma/seed/rulepacks.ts:161` set every user's `noticesSeenAt` to
  `max(clock.now(), newest seeded publishedAt)` — and at that point the override is released, so `clock.now()` is
  **real wall-clock time**.
* The unseen-notice query is `publishedAt > noticesSeenAt` (`api/src/routes/rules.ts:202`).

While the real date was on or before 2026-11-02 the comparison held. From 2026-11-03 the seed stamped
`noticesSeenAt` later than anything a test could publish, so a freshly published amendment counted as already
seen and the banner count came back `0` instead of `1`.

Fix (`api/prisma/seed/rulepacks.ts`): anchor `noticesSeenAt` to the newest seeded `publishedAt` alone, which is on
the same simulated timeline as the rest of the seeded data, instead of mixing in wall-clock time.

Verified after the fix:

* `npm test` → **183 passed, 0 failed**.
* Fresh seed still leaves the college banner clean: `noticesSeenAt = 2026-10-27 17:00`, newest seeded
  `publishedAt = 2026-10-27 17:00`, unseen rows = **0** (strict `>` excludes the seeded notices themselves).
* The result no longer depends on the real date, because no wall-clock value enters the comparison.

This was a genuine latent bug, not only a test problem: any demo whose simulated clock sits behind the moment the
seed ran would have hidden new change notices from colleges.

## Discrepancy between the submission text and the repository's own evidence

`formcheck/EVALUATION.md` is reproducible — re-running `python3 -m training.evaluate` regenerated it
byte-for-byte. Its measured hybrid figures are:

| Metric | Measured (authoritative) | Claimed in the submission text |
|---|---:|---:|
| Precision | **0.975** | 0.97 — consistent |
| Recall | **0.863** | **0.89 — overstated** |
| False-alarm rate | **0.022 (2.2%)** | **2.9% — does not match** |

The claim appears in `sih-submission/2_idea_description.txt` (lines 201 and 336) and
`sih-submission/3_abstract.txt` (line 23). A judge who opens `EVALUATION.md` will see 0.863. **The submission text
should be corrected to 0.975 / 0.863 / 2.2%**, or the figures re-derived and the evaluation file regenerated. This
is the single highest-risk credibility item found in the audit.

Methodology check on the same model (requested in the brief): **no data leakage.** Train is 4,000 rows, all
unlabelled normal forms (correct for an unsupervised Isolation Forest); test sets are 1,000 normal and 1,000
faulty. Hashing each row's `values` object shows `train ∩ test_normal = 0`, `train ∩ test_faulty = 0`,
`test_normal ∩ test_faulty = 0`, and no duplicates within any split. The threshold (97th percentile of training
scores) is set on train only. A rules-only baseline is reported alongside the model, which is the right
comparison. The evaluation is sound; only the quoted numbers are wrong.

## Feature classification

Status values are as the brief defines them. "Tested" means a test in this repository exercises the behaviour and
I watched it pass.

### Core workflow and access control

| Feature | Status | Source | Evidence |
|---|---|---|---|
| Case lifecycle with a single current holder, server-enforced transition table | IMPLEMENTED AND TESTED | `api/src/workflow/transitions.ts`, `actions.ts` | `workflow.test.ts`, `matrix.test.ts` |
| Role × action permission matrix, 10 roles, denials audited | IMPLEMENTED AND TESTED | `api/src/policy/can.ts`, `roles.ts`, `scope.ts` | `matrix.test.ts` ("allows only the transition table cells", "refuses with 403 plus ACCESS_DENIED") |
| Separation of duties (scrutiniser cannot decide) | IMPLEMENTED AND TESTED | `api/src/policy/can.ts` | `matrix.test.ts` |
| Row-level lock on case transitions | IMPLEMENTED AND TESTED | `actions.ts:349` — `SELECT id FROM "Application" ... FOR UPDATE` | `workflow.test.ts` |
| Login, JWT, rate limiting | IMPLEMENTED AND TESTED | `api/src/auth/*`, `express-rate-limit` | `auth.test.ts` ("rate limits after 10 attempts in 15 minutes") |
| Public application tracking that does not leak which field was wrong | IMPLEMENTED AND TESTED | `api/src/routes/public.ts` | `public-track.test.ts` |

### Assignment

| Feature | Status | Source | Evidence |
|---|---|---|---|
| Eligibility filtering, capacity, availability, conflicts, load score, Bureau overflow | IMPLEMENTED AND TESTED | `api/src/assignment/engine.ts` (699 lines) | `assignment.test.ts` |
| Per-task advisory lock, so two concurrent assigns cannot double-assign | IMPLEMENTED AND TESTED | `engine.ts:341,539,621` via `advisoryXactLock`; partial unique index `assignment_open_task_unique` (`001_audit_guard.sql`) | `assignment.test.ts` |
| One-line reason recorded for every assignment | IMPLEMENTED AND TESTED | `Assignment.reasonText` | `assignment.test.ts` |
| Committee proposal by visit load | IMPLEMENTED AND TESTED | `api/src/assignment/committee.ts` | `assignment.test.ts` |
| Assignment **explainability surfaced to a judge** (eligible vs excluded officers with reasons, load before/after) | PARTIALLY IMPLEMENTED | reasons exist in the data and the engine computes exclusions | no screen presents the full eligible/excluded breakdown; this is the Evidence Center gap |

### Deadline engine and scheduler

| Feature | Status | Source | Evidence |
|---|---|---|---|
| One engine for all clock types, working days, paused while the college holds the file | IMPLEMENTED AND TESTED | `api/src/engine/cycle.ts`, `lib/workdays.ts` | `engine.test.ts`, `workdays.test.ts` |
| Alerts sent exactly once (idempotent cycles) | IMPLEMENTED AND TESTED | `alertOnce()` — `INSERT ... ON CONFLICT ("itemId", kind, "offsetOrLevel") DO NOTHING` (`cycle.ts:38`) | `engine.test.ts`; load test second cycle produced 0 new alerts |
| Escalation at 3 / 7 / 14 days to senior, super senior, HoD | IMPLEMENTED AND TESTED | `cycle.ts`, `policy/subtree.ts` | `engine.test.ts` |
| Two schedulers with leader election and handover | IMPLEMENTED AND TESTED | `api/src/scheduler.ts`, `pg_advisory_lock(CYCLE_LOCK_ID)` | `scheduler.test.ts` ("runs cycles on the leader only and hands over within a cycle when the leader stops") |
| Scheduler **run history** (execution id, duration, counts, errors, retries) | MISSING | counters exist in memory and are returned by `runEngineCycle`, but nothing persists a per-run row | no table, no API, no screen |
| Catch-up after downtime | IMPLEMENTED BUT NOT VERIFIED | late-reminder path in `cycle.ts` marks `late` when the trigger date has passed | no test injects downtime and asserts catch-up behaviour |

### Notifications

| Feature | Status | Source | Evidence |
|---|---|---|---|
| In-app notifications, written inside the same transaction as the state change | IMPLEMENTED AND TESTED | `api/src/lib/notify.ts` | `engine.test.ts` |
| Email / SMS delivery | MISSING (declared phase 8) | `notify.ts` comment says only the in-app channel exists | — |
| Outbox, retry, exactly-once **external** delivery | MISSING | there is no outbox table and no retry path | The brief's warning is correct and worth stating plainly: `AlertLog`'s unique key makes the **decision to alert** exactly-once, which is a different guarantee from delivery to an external gateway. Nothing in the repo currently over-claims this, and nothing yet implements it. |

### Audit

| Feature | Status | Source | Evidence |
|---|---|---|---|
| SHA-256 hash chain per case, canonical JSON, genesis hash | IMPLEMENTED AND TESTED | `api/src/lib/audit.ts` | `audit.test.ts` |
| Serialised appends (no interleaving within a chain) | IMPLEMENTED AND TESTED | `advisoryXactLock(tx, 'audit:' + chainKey)` (`audit.ts:79`) | `audit.test.ts` |
| Database-enforced append-only | IMPLEMENTED AND TESTED | `REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM aicte_app` plus a `BEFORE UPDATE OR DELETE` trigger that always raises (`001_audit_guard.sql`) | `audit.test.ts`; `npm run demo:tamper` demonstrates detection |
| Integrity check naming the first altered row | IMPLEMENTED AND TESTED | `verifyChains()` | `audit.test.ts`, `rules-a11.test.ts` |
| Tamper-proof against a privileged DBA | **NOT ACHIEVABLE — must not be claimed** | the trigger and the grants both belong to `aicte_migrator`; the table owner or a superuser can `ALTER TABLE ... DISABLE TRIGGER` and rewrite rows, then recompute hashes | The honest claim is: the application role cannot modify or delete audit rows, and any edit that does not recompute the whole forward chain is detected. Off-box log shipping or external notarisation would be needed for more. |

### Rules (yearly rule packs)

| Feature | Status | Source | Evidence |
|---|---|---|---|
| Versioned packs, maker-checker, diff, impact preview, publish | IMPLEMENTED AND TESTED | `api/src/rules/*` (14 files) | `rules-api.test.ts`, `rules-a11.test.ts`, `rulepacks.test.ts` |
| Filed cases partly pinned to the pack version in force when filed. Pinning is partial by design: application types (eligibility, route), documents, fees, norms, programmes, form-check rules, letters and change notice stay on the filed version; schedule, reminders, escalation, assignment, committees and calendar follow the cycle's current published version, and an amendment's apply scope can also move open cases (`rebaseAfterPublish`) | IMPLEMENTED AND TESTED | `Application.rulePackVersionId`, `rules/filing.ts`, `mergeSections` in `rules/resolved.ts` | `rules-a11.test.ts` (verified again after the fix above) |
| Only relaxing changes may apply to live cases | IMPLEMENTED AND TESTED | `applyScope`, refusal for eligibility changes | `rules-a11.test.ts` ("refuses as live an eligibility change that would flip an open case") |
| One PUBLISHED version per cycle under concurrent publishes | IMPLEMENTED AND TESTED | `advisoryXactLock(tx, 'rules:cycle:' + id)` (`versions.ts:88,257`) | `rules-a11.test.ts` ("keeps one PUBLISHED version per cycle under two concurrent publishes") |
| Expression safety (depth, size, unknown variables) | IMPLEMENTED AND TESTED | `rules/expr.ts`, `rules/schema.ts` | `expr.test.ts` (84 tests), `rules-a11.test.ts` |
| Node / Python expression conformance | IMPLEMENTED AND TESTED | shared conformance fixtures | `expr.test.ts` + `formcheck/tests/test_expr.py` |
| **Decision trace** (which conditions were evaluated, which passed, which failed, for one case) | PARTIALLY IMPLEMENTED | the filed version and the resolved rules are retrievable per case | no per-condition pass/fail trace is stored or displayed |

### Form check (ML)

| Feature | Status | Source | Evidence |
|---|---|---|---|
| 5 plausibility rules + Isolation Forest, advisory only, never blocks filing | IMPLEMENTED AND TESTED | `formcheck/app/*`, `api/src/formcheck/*` | 99 Python tests, `formcheck.test.ts` |
| Rules fallback when the Python service is slow or down | IMPLEMENTED AND TESTED | `api/src/formcheck/service.ts` (800 ms timeout) | `formcheck.test.ts`; the test env points `FORMCHECK_URL` at a dead port on purpose |
| Reproducible evaluation with a baseline and per-fault recall | IMPLEMENTED AND TESTED | `formcheck/training/evaluate.py`, `EVALUATION.md` | regenerated byte-identical during this audit. `formcheck/models/*.joblib` and `formcheck/data/` are gitignored, so a fresh clone has neither the model nor the datasets, yet `cd formcheck && python3 -m training.generate && python3 -m training.train && python3 -m training.evaluate` in a clean copy reproduces `EVALUATION.md` and `metrics.json` byte-identically. Verified on this machine class only; CI runs the same check as a non-blocking step because float results can differ across CPUs |
| Per-flag explanation from actual feature values | IMPLEMENTED AND TESTED | `formcheck/app/rules.py` returns field names and reasons | `test_formcheck.py` |
| Synthetic-data labelling in the UI | IMPLEMENTED BUT NOT VERIFIED | `EVALUATION.md` is explicit; the in-app Form checks panel was not inspected for a synthetic-data caveat | needs a screen check |

### Delivery and operations

| Feature | Status | Source | Evidence |
|---|---|---|---|
| CI pipeline | **MISSING** | no `.github/workflows` directory existed at the audited commit (CI was added afterwards in `ci.yml`; its first GitHub run has not yet been observed) | Nothing ran lint, typecheck or tests on a push. The suite is good and currently passes, so this is cheap, high-value ground to take. |
| Lint | MISSING | no ESLint / Prettier / Ruff config in the repo | `typecheck` and `tsc -b` are the only static gates |
| Load test | IMPLEMENTED AND TESTED (as a script) | `api/scripts/load-test.ts`, `docs/LOAD_TEST.md` | documented run of 26 Oct 2026 at 15,000 applications, 0 errors |
| Load test **provenance and machine-readable output** | PARTIALLY IMPLEMENTED | the script prints JSON to stdout (`load-test.ts:136`) but writes no file and records no commit hash | `docs/LOAD_TEST.md` names the date and hardware but not the commit, so results cannot be tied to a code version |
| Latency percentiles | PARTIALLY IMPLEMENTED | p50 and p95 are reported | no p99, no throughput figure, no error-rate field, one concurrency level (20) and one dataset size |
| Demo reset | IMPLEMENTED AND TESTED | `api/src/lib/demoReset.ts` | `reset.test.ts` ("restores the seed in seconds and every demo user can log in") |
| Hosted (Vercel + Neon) mode | IMPLEMENTED BUT NOT VERIFIED **here** | `api/src/serverless.ts`, `lib/hosted.ts` | works per earlier sessions; **not tested in this audit** — no network calls were made to the live site |
| Evidence Center UI | **MISSING** | — | no such screen exists. The `evidence` hits in `web/src` are undertaking evidence and the compliance verify panel, which are unrelated. |
| Official SIH problem statement in the repository | **MISSING — blocker for Phase 2** | only prose mentions in `README.md` and `CONTRIBUTORS.md` | see below |

### Frontend

| Feature | Status | Source | Evidence |
|---|---|---|---|
| Role-based screens (public, college, officer, manager, committee, authority, admin, rules) | IMPLEMENTED BUT NOT VERIFIED | `web/src/pages/**` | builds clean; 39 screenshots in `docs/screens/all/`. No automated UI test or accessibility assertion runs in this repo. |
| English and Hindi, high contrast, text size | IMPLEMENTED BUT NOT VERIFIED | `web/src/strings/en.ts`, `hi.ts` | screenshots exist for Hindi and high contrast; nothing asserts WCAG 2.2 AA automatically |
| Bundle size | NEEDS ATTENTION | single 919 kB chunk | the build warns; relevant because judges may load the site on a phone or conference Wi-Fi |

## Phase 2 blocker

The brief says: if the official problem statement is not in the repository, report it as a blocker and ask rather
than invent requirements. **It is not in the repository.** `SIH26262` appears only as prose in `README.md` and
`CONTRIBUTORS.md`; there is no file containing the official requirement text.

A requirement coverage matrix built from my reading of the README would be my paraphrase presented as AICTE's
requirements — the exact fabrication the brief forbids. `docs/evidence/REQUIREMENT_COVERAGE.md` is therefore
**not written yet**, and is blocked on the official problem statement text (title, description, and any
expected-solution or deliverables wording) being added to the repository.

## Honest summary

The engineering is better than the presentation claims. Concurrency is handled deliberately rather than
hopefully: per-task advisory locks for assignment, `FOR UPDATE` on case transitions, a partial unique index for
one open assignment per task, `ON CONFLICT DO NOTHING` for exactly-once alert decisions, an advisory lock per
audit chain, and a leader-elected scheduler. 183 real integration tests and 99 Python tests pass. The ML
evaluation is reproducible and methodologically clean.

The gaps are concentrated in three places, and none of them are in the core engine:

1. **Nothing was automated** at the audited commit (CI was added afterwards). No CI, so a date-dependent failure like the one fixed above sat undetected until
   someone ran the suite by hand. This is the cheapest large win available.
2. **Nothing is persisted as evidence.** The scheduler keeps no run history; the load test writes no artifact and
   records no commit; no decision trace is stored. A judge cannot inspect any of it after the fact.
3. **One published claim overstates the measured result** (ML recall 0.89 vs 0.863). That needs correcting before
   anything else, because it is the one item that could cost credibility rather than merely fail to gain it.
