# Evidence Center Implementation Plan

> Historical implementation plan. The implementation, API, tests, and evidence artifacts remain in the repository. The UI was later removed from the normal application routes and navigation; see [`docs/evidence/README.md`](../../evidence/README.md) for the retained implementation record and [`docs/evaluation/README.md`](../../evaluation/README.md) for the current evaluator guide.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a judge an in-app Evidence Center whose every panel is drawn from real stored data — scheduler run history, assignment decisions, audit integrity and committed evidence artifacts — with provenance declared per panel and no status that a real check did not produce.

**Architecture:** Two new tables persist what the engine already computes and currently discards (`EngineRun`, `AssignmentTrace`). One ADMIN-only read-only router (`/api/evidence`) serves them alongside a live audit-integrity check and the committed JSON under `docs/evidence/`. The UI is a tabbed page under Admin built from the existing recharts + `chartTokens` house pattern. The UI is a viewer: it computes no verdicts, and a missing or stale artifact reads `STALE`, never green.

**Tech Stack:** Prisma 5 / PostgreSQL 16, Express 4 + zod, React 18 + TanStack Query 5 + react-router-dom 6, recharts 2.15.0 with `web/src/lib/chartTokens.ts`, Tailwind, lucide-react, vitest against a real database.

**Spec:** `docs/engineering/specs/2026-11-03-github-evidence-design.md` (its "Architecture" and "Database additions" sections) and `docs/evidence/README.md` (the Evidence Center design, sections A–I).

## Scope note — this is one plan of five

The request covers several independent subsystems. This plan is the one that produces the Evidence Center and its dashboards, and it stands alone: at its end there is a working, tested, judge-facing page. The other four are separate plans, each worth its own review gate, and none blocks this one:

| Follow-on plan | Why separate |
|---|---|
| Playwright browser E2E for the role journeys | New test harness and runner; no shared interface with this plan |
| Failure-recovery tests (DB down, scheduler killed, bad upload, invalid rule, duplicate request, unauthorized action) | Pure test addition against existing code; Task 1 here covers only the scheduler subset |
| CI expansion (frontend tests, E2E, Mermaid validation, security check) | Depends on the two plans above existing first |
| README restructure to the 14-point order, and engine-cycle profiling | Documentation and performance; touches no file this plan touches |

## Global Constraints

- **No hardcoded status.** A panel shows `PASS` only where a real check produced it. Missing or stale input reads `STALE` or `NOT VERIFIED`, never green.
- **Provenance is schema, not prose.** Every served record and every panel carries one of `LIVE_DEMO`, `TEST_RUN`, `BENCHMARK`, `SIMULATED`.
- **No tamper-proof-against-a-DBA claim.** The honest wording: the application role cannot UPDATE or DELETE audit rows, and any edit that does not recompute the whole forward chain is detected; the table owner can disable the trigger.
- **No exactly-once external delivery claim.** `AlertLog`'s unique key makes the *decision* to alert exactly-once. There is no external channel in this build.
- **No production-ready claim.** Phase 8 hardening is absent.
- **ML figures, verbatim and nothing else:** precision **0.975**, recall **0.863** overall, **0.315** on unit errors, false-alarm rate **2.2%**, all on synthetic data. The strings `0.89` and `2.9%` must not appear as this project's results.
- **Limitations inline**, under the number they qualify, never in a trailing section.
- **No new chart library and no new framework.** recharts and `chartTokens` only.
- **Status is never colour alone** — pair every colour with a label or icon.

## Data quality contract (amended 2026-11-03, binding on Tasks 3 and 4)

The user's stated priority is **clean, understandable dashboards backed by accurate data**, explicitly *not* a page full of charts that look impressive and are hard to read. That reorders this plan: correctness of the aggregation is the gate, and presentation serves comprehension rather than density. Tasks 3 and 4 are bound by all of the following.

**Every KPI carries a written definition** — numerator, denominator, time window, exclusions — in `api/src/routes/evidence.ts` beside the query that computes it, and surfaced to the reader in the UI. A KPI whose denominator is not stated does not ship.

**Missing is not zero.** Every aggregate distinguishes three states: a measured value, a genuine zero, and absent data. `null`/`absent` must never render as `0`, a flat line, or a 0% share. Charts show their empty state for absent data and say what is absent.

**No invented history.** No back-filled series, no interpolated gaps, no trend line through two points, and no comparison against a period for which no data exists. A time series starts where the data starts.

**Provenance per value, four kinds:** `MEASURED` (counted from live rows), `DERIVED` (computed from measured values — the formula stated), `SYNTHETIC` (benchmark or seeded data), `TARGET` (a goal with no measurement behind it). Targets are never drawn so as to read as achievements.

**Internal agreement.** A KPI card, the chart beneath it and any table of the same measure are computed from one query, not three. Where that is impossible, the API returns one object and the UI derives both from it.

**Filters apply to every related visualisation or to none.** A date range that silently misses one panel on the same tab is a defect.

**Censored workflows are stated, not averaged away.** Processing time over cases that have not finished is a censored sample: report the median with the completed-case count and the in-flight count, and say so. Do not present a mean over incomplete cases as an average processing time.

**The four questions.** For every chart, a reader who has never seen this codebase must be able to answer, from the page alone: what is measured, what the value means, what period it covers, and what conclusion may reasonably be drawn. A chart that fails any of the four is cut rather than captioned into submission.

**Aggregation is tested against source records.** Each aggregate gets a test that builds known rows and asserts the endpoint's number equals an independently counted expectation — not merely that the shape is right.
- **Selection behaviour must not change.** Task 2 touches the assignment engine to retain identities it currently discards; the officer chosen for any given input must be identical before and after.
- **Commit locally. Do NOT push.** The user has withdrawn blanket push permission.
- Branch `claude/new-session-35imia`. No PR.

## Review Focus

Five conditions the spec implies that no task's own happy path exercises:

1. **A cycle that throws midway** must leave its `EngineRun` row `FAILED` with the error recorded, not `RUNNING` for ever — otherwise the reliability panel silently counts a crash as an in-flight run. Test in Task 1.
2. **A non-ADMIN role calling `/api/evidence/*`** must get 403 with the denial audited, and must leak no audit row, officer name or application number in the body. Test in Task 3.
3. **The summary endpoint with the test-result JSON missing, or recorded against a different commit than `HEAD`**, must report `STALE` and name the commit mismatch — never fall back to green or to the last known good result. Test in Task 3.
4. **Every chart on a database with zero rows** (a fresh reset, before any cycle has run) must render its empty state, not a broken axis, a `NaN` tick or a division by zero. Test in Task 4.
5. **An assignment where nobody is eligible** (the `BLOCKED` path) must still write an `AssignmentTrace` row, with `chosenOfficerId` null and every exclusion reason present — that case is precisely the one a judge asks about. Test in Task 2.

---

### Task 1: `EngineRun` — persisted scheduler run history

**Files:**
- Modify: `api/prisma/schema.prisma` (add the model)
- Create: `api/prisma/migrations/20261103120000_engine_run/migration.sql`
- Modify: `api/src/engine/cycle.ts` (`alertOnce` at :38, `Counters` at :82, `runEngineCycle` at :245)
- Test: `api/test/engine-run.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `EngineRun` table, and `runEngineCycle` returning `CycleResult` additionally containing `engineRunId: string` and `alertsSuppressed: number`. Tasks 3 and 4 read the table.

```prisma
model EngineRun {
  id               BigInt    @id @default(autoincrement())
  startedAt        DateTime
  finishedAt       DateTime?
  durationMs       Int?
  instanceId       String
  simulatedToday   DateTime  @db.Date
  provenance       String                      // LIVE_DEMO | TEST_RUN | BENCHMARK
  itemsChecked     Int       @default(0)
  alertsCreated    Int       @default(0)
  alertsSuppressed Int       @default(0)
  notifications    Int       @default(0)
  flagsRaised      Int       @default(0)
  escalations      Int       @default(0)
  status           String                      // RUNNING | OK | FAILED
  error            String?

  @@index([startedAt])
  @@index([status])
}
```

`alertsSuppressed` is the direct measurement of duplicate-alert prevention: `alertOnce` already returns `false` when `ON CONFLICT ... DO NOTHING` swallows an insert, and that count is currently thrown away. `instanceId` identifies the replica, so leader handover is visible.

- [ ] **Step 1: Write the failing tests**

```ts
// api/test/engine-run.test.ts
it('records one OK row per cycle with the counters and the simulated date', async () => {
  const r = await runEngineCycle({ source: 'test' });
  const row = await prisma.engineRun.findUniqueOrThrow({ where: { id: BigInt(r.engineRunId as string) } });
  expect(row.status).toBe('OK');
  expect(row.finishedAt).not.toBeNull();
  expect(row.durationMs).toBeGreaterThanOrEqual(0);
  expect(row.itemsChecked).toBe(r.itemsChecked);
  expect(row.provenance).toBe('TEST_RUN');
  expect(isoDate(row.simulatedToday)).toBe(r.today);
});

it('counts suppressed alerts on a repeated cycle and creates none', async () => {
  const first = await runEngineCycle({ source: 'test' });
  const second = await runEngineCycle({ source: 'test' });
  expect(second.alertsCreated).toBe(0);
  expect(Number(second.alertsSuppressed)).toBeGreaterThan(0);
  expect(Number(first.alertsSuppressed)).toBeLessThan(Number(second.alertsSuppressed) + 1);
});

it('marks the row FAILED with the error when the cycle throws midway [Review Focus 1]', async () => {
  // Force a mid-cycle failure by dropping the AlertLog unique index's table access for the app role,
  // or by stubbing buildFlags to throw — whichever the implementer finds least invasive.
  await expect(runEngineCycleWithFailure()).rejects.toThrow();
  const row = await prisma.engineRun.findFirstOrThrow({ orderBy: { id: 'desc' } });
  expect(row.status).toBe('FAILED');
  expect(row.error).toBeTruthy();
  expect(row.finishedAt).not.toBeNull();
});

it('records a distinct instanceId per replica and only the leader writes rows', async () => {
  // Two concurrent runCycleWithLock calls: the advisory lock serialises them, so two rows appear
  // with different instanceIds and neither is left RUNNING.
  const before = await prisma.engineRun.count();
  await Promise.allSettled([runCycleWithLock({ source: 'a' }), runCycleWithLock({ source: 'b' })]);
  const rows = await prisma.engineRun.findMany({ orderBy: { id: 'desc' }, take: 2 });
  expect(await prisma.engineRun.count()).toBeGreaterThan(before);
  expect(rows.every((r) => r.status !== 'RUNNING')).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && npx vitest run test/engine-run.test.ts`
Expected: FAIL — `prisma.engineRun` is not a property.

- [ ] **Step 3: Add the model and the migration**

Add the model above to `schema.prisma`. Write the migration SQL by hand in the directory named above, matching the existing files' style (`api/prisma/migrations/20261025150000_stored_blob/migration.sql` is the closest precedent). Grant nothing extra: `001_audit_guard.sql` already grants the app role DML on all tables in `public`. Then `npm --workspace api run prisma:generate`.

- [ ] **Step 4: Thread the counter and the row through `runEngineCycle`**

Add `alertsSuppressed: number` to `Counters`. In `alertOnce`, increment it when the insert returns no row — it needs the counters object, so pass `c` in. In `runEngineCycle`: insert the `RUNNING` row before the item loop with `instanceId` (from `process.env.ENGINE_INSTANCE_ID ?? os.hostname() + ':' + process.pid`) and `provenance` (`TEST_RUN` when `process.env.NODE_ENV === 'test'` or `VITEST` is set, `BENCHMARK` when `meta.source === 'load-test'`, else `LIVE_DEMO`); wrap the body in `try/catch/finally` so the row is updated to `OK` or to `FAILED` with the error message, with `finishedAt` and `durationMs` set either way; return `engineRunId` and `alertsSuppressed` in the result.

The update must not run inside the caller's transaction — a failed cycle's row has to survive the rollback.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd api && npx vitest run test/engine-run.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Run the full suite — this changes a hot path**

Run: `npm test`
Expected: 187 passed (183 existing + 4). Any pre-existing test that asserts on the shape of `CycleResult` must still pass; if one fails, the addition is wrong, not the test.

- [ ] **Step 7: Commit**

```bash
git add api/prisma api/src/engine/cycle.ts api/test/engine-run.test.ts
git commit -m "Engine: persist a run history row per cycle, and count suppressed alerts"
```

---

### Task 2: `AssignmentTrace` — persist the decision the engine already makes

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: `api/prisma/migrations/20261103130000_assignment_trace/migration.sql`
- Modify: `api/src/assignment/engine.ts` (`Exclusions` at :195, `filterCandidates` at :201, `assign` at :340)
- Test: `api/test/assignment-trace.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the `AssignmentTrace` table and an exported `traceOf(exclusionsByTier, pick, weight) -> TraceCandidate[]`. Tasks 3 and 4 read the table.

```prisma
model AssignmentTrace {
  id              BigInt   @id @default(autoincrement())
  assignmentId    String?
  applicationId   String
  taskType        String
  decidedAt       DateTime
  chosenOfficerId String?
  outcome         String              // ASSIGNED | BUREAU_OVERFLOW | BLOCKED
  weight          Float
  candidates      Json                // TraceCandidate[]
  reasonText      String

  @@index([applicationId])
  @@index([decidedAt])
}
```

```ts
export interface TraceCandidate {
  officerId: string;
  name: string;
  tier: number;
  eligible: boolean;
  excludedBy: 'UNAVAILABLE' | 'BARRED' | 'RECUSED' | 'OVER_CAPACITY' | null;
  capacity: number;
  openPoints: number;
  projectedUtil: number;
  score: number;
  chosen: boolean;
}
```

**The one engine change this needs.** `filterCandidates` currently records `barred` and `recused` as bare counts (`api/src/assignment/engine.ts:195-199`), so their identities are unrecoverable. Change `Exclusions` to hold `barred: Candidate[]` and `recused: Candidate[]` instead of `number`, and update `exclusionText` to use `.length` where it used the number. **Nothing else may change**: the `pass`/exclude decision order, the score, the tie-break and the chosen officer must be identical. `score(p, c, weight)` is already exported and is what the trace records.

- [ ] **Step 1: Write the failing tests**

```ts
// api/test/assignment-trace.test.ts
it('writes one trace row per assignment, naming the chosen officer and every candidate', async () => {
  const { app, applicationId } = await submitAndAssign();
  const t = await prisma.assignmentTrace.findFirstOrThrow({ where: { applicationId }, orderBy: { id: 'desc' } });
  expect(t.outcome).toBe('ASSIGNED');
  expect(t.chosenOfficerId).toBeTruthy();
  const cands = t.candidates as unknown as TraceCandidate[];
  expect(cands.length).toBeGreaterThan(1);
  expect(cands.filter((c) => c.chosen)).toHaveLength(1);
  expect(cands.find((c) => c.chosen)!.officerId).toBe(t.chosenOfficerId);
  expect(cands.every((c) => c.eligible === (c.excludedBy === null))).toBe(true);
});

it('writes a BLOCKED trace with no officer and the exclusion reasons when nobody is eligible [Review Focus 5]', async () => {
  // Make every eligible officer unavailable, then assign.
  const { applicationId } = await blockAllOfficersThenAssign();
  const t = await prisma.assignmentTrace.findFirstOrThrow({ where: { applicationId }, orderBy: { id: 'desc' } });
  expect(t.outcome).toBe('BLOCKED');
  expect(t.chosenOfficerId).toBeNull();
  const cands = t.candidates as unknown as TraceCandidate[];
  expect(cands.length).toBeGreaterThan(0);
  expect(cands.every((c) => !c.eligible && c.excludedBy !== null)).toBe(true);
});

it('two concurrent assignments of the same task produce one assignment and one trace', async () => {
  const { applicationId, task } = await openTask();
  await Promise.allSettled([assignOnce(task), assignOnce(task)]);
  expect(await prisma.assignment.count({ where: { applicationId, releasedAt: null } })).toBe(1);
  expect(await prisma.assignmentTrace.count({ where: { applicationId, outcome: 'ASSIGNED' } })).toBe(1);
});

it('records the same chosen officer as before the trace was added', async () => {
  // Regression guard on the Exclusions type change: a fixed fixture must still pick the same officer.
  const picked = await pickFor(await fixedScrutinyTask());
  expect(picked.officer.id).toBe(await expectedOfficerIdFromFixture());
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && npx vitest run test/assignment-trace.test.ts`
Expected: FAIL — `prisma.assignmentTrace` is not a property.

- [ ] **Step 3: Add the model and the migration**

As Task 1 Step 3, with the directory named above.

- [ ] **Step 4: Widen `Exclusions` to keep identities, and export `traceOf`**

Change `barred` and `recused` to `Candidate[]`; fix `exclusionText` to read `.length`. Add `traceOf(exclusionsByTier, pick, weight) -> TraceCandidate[]`, flattening every tier's candidates into one array with `excludedBy` set from which bucket each came out of, `score` from `score(p, c, weight)`, and `chosen` true only for the pick.

- [ ] **Step 5: Write the row in `assign`**

In `assign`, after the assignment row is written (and on the blocked path too), insert the trace **inside the same transaction** as the assignment, so a rolled-back assignment leaves no trace claiming it happened. `outcome` is `ASSIGNED` for tier 0, `BUREAU_OVERFLOW` when the pick came from a higher tier, `BLOCKED` when `pick` is null.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd api && npx vitest run test/assignment-trace.test.ts`
Expected: 4 passed.

- [ ] **Step 7: Run the full suite — the engine change is behaviour-critical**

Run: `npm test`
Expected: 191 passed. `assignment.test.ts` and `matrix.test.ts` are the ones that would catch a changed selection; if either fails, revert the `Exclusions` change and find another way to keep identities.

- [ ] **Step 8: Commit**

```bash
git add api/prisma api/src/assignment/engine.ts api/test/assignment-trace.test.ts
git commit -m "Assignment: persist the candidate table behind every decision"
```

---

### Task 3: `/api/evidence` — the read-only ADMIN router

**Files:**
- Create: `api/src/routes/evidence.ts`
- Modify: `api/src/app.ts:45` (mount `api.use('/evidence', evidenceRouter())` next to the admin router)
- Test: `api/test/evidence-api.test.ts`

**Interfaces:**
- Consumes: Task 1's `EngineRun`, Task 2's `AssignmentTrace` and `TraceCandidate`.
- Produces: these endpoints, which Task 4 consumes.

| Endpoint | Returns |
|---|---|
| `GET /api/evidence/summary` | `{ status: 'PASS' \| 'FAIL' \| 'STALE' \| 'NOT_VERIFIED', commit, artifactCommit, checks: { passed, failed, notVerified }, lastRunAt, scheduler: { lastRunAt, lastStatus, lastDurationMs }, provenance }` |
| `GET /api/evidence/engine-runs?from&to&status&page&pageSize` | `{ rows: EngineRun[], total, page, pageSize }` |
| `GET /api/evidence/assignment-trace/:applicationId` | `{ rows: AssignmentTrace[] }` |
| `GET /api/evidence/audit-integrity` | live `verifyChains()` result plus `provenance: 'LIVE_DEMO'` |
| `GET /api/evidence/artifacts` | the parsed JSON under `docs/evidence/benchmark-results/` and `formcheck/metrics.json`, each with its own `provenance` and `commit` |

`summary` **reads** the stored test-result JSON and never computes a verdict. When the file is absent it returns `NOT_VERIFIED`; when its commit differs from `HEAD` it returns `STALE` and both commits. It must never return `PASS` from anything but a recorded pass.

- [ ] **Step 1: Write the failing tests**

```ts
// api/test/evidence-api.test.ts
it('serves the summary as NOT_VERIFIED when no test-result artifact exists [Review Focus 3]', async () => {
  const r = await request(app).get('/api/evidence/summary').set(...bearer(admin));
  expect(r.status).toBe(200);
  expect(r.body.status).toBe('NOT_VERIFIED');
  expect(r.body.status).not.toBe('PASS');
});

it('serves the summary as STALE when the artifact records a different commit [Review Focus 3]', async () => {
  await writeArtifact({ commit: 'deadbee', passed: 183, failed: 0 });
  const r = await request(app).get('/api/evidence/summary').set(...bearer(admin));
  expect(r.body.status).toBe('STALE');
  expect(r.body.artifactCommit).toBe('deadbee');
  expect(r.body.commit).not.toBe('deadbee');
});

it('refuses every endpoint to a non-ADMIN role and leaks nothing [Review Focus 2]', async () => {
  for (const path of ['/summary', '/engine-runs', '/audit-integrity', '/artifacts']) {
    const r = await request(app).get(`/api/evidence${path}`).set(...bearer(officer));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('ACCESS_DENIED');
    expect(JSON.stringify(r.body)).not.toMatch(/applicationNo|rowHash|officerId/);
  }
});

it('pages engine runs newest first and filters by status', async () => {
  await runEngineCycle({ source: 'test' });
  const r = await request(app).get('/api/evidence/engine-runs?status=OK&pageSize=10').set(...bearer(admin));
  expect(r.body.rows.length).toBeGreaterThan(0);
  expect(r.body.rows.every((x: { status: string }) => x.status === 'OK')).toBe(true);
  expect(r.body.total).toBeGreaterThanOrEqual(r.body.rows.length);
});

it('reports audit integrity from a live check, and reports a break after tampering', async () => {
  const ok = await request(app).get('/api/evidence/audit-integrity').set(...bearer(admin));
  expect(ok.body.ok).toBe(true);
  await tamperOneAuditRow();
  const bad = await request(app).get('/api/evidence/audit-integrity').set(...bearer(admin));
  expect(bad.body.ok).toBe(false);
  expect(bad.body.firstBroken).toBeTruthy();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && npx vitest run test/evidence-api.test.ts`
Expected: FAIL with 404 on every route.

- [ ] **Step 3: Implement `evidenceRouter(): Router` in `api/src/routes/evidence.ts`**

Follow `api/src/routes/admin.ts` exactly: `Router()`, a zod query schema per endpoint, `h()` and `parse()` from `../lib/http.js`, `requireRole('ADMIN')` on the router. Reuse `verifyChains` from `../lib/audit.js` and do not reimplement it. Read artifacts from `process.env.EVIDENCE_DIR ?? <repo>/docs/evidence` so a test can point it at a temp directory; a malformed or missing file yields `NOT_VERIFIED` for that artifact rather than a 500.

- [ ] **Step 4: Mount it**

Add the import and `api.use('/evidence', evidenceRouter());` immediately after the admin line in `api/src/app.ts`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd api && npx vitest run test/evidence-api.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Run the full suite and the typecheck**

Run: `npm test && npm --workspace api run typecheck`
Expected: 196 passed; typecheck silent.

- [ ] **Step 7: Commit**

```bash
git add api/src/routes/evidence.ts api/src/app.ts api/test/evidence-api.test.ts
git commit -m "Evidence API: ADMIN-only read-only router over the stored evidence"
```

---

### Task 4: The Evidence Center page — **SUPERSEDED by Tasks 4a–4e below (Amendment 2)**

*Retained for its panel rules, which still bind. It is no longer dispatched as one task.*

**Files:**
- Create: `web/src/pages/admin/evidence/EvidenceCenter.tsx` (the tab shell and route target)
- Create: `web/src/pages/admin/evidence/panels.tsx` (the chart panels)
- Create: `web/src/pages/admin/evidence/Provenance.tsx` (the chip and the metric-definition tooltip)
- Modify: `web/src/App.tsx:110` (add the route beside `/admin`)
- Modify: `web/src/api/types.ts` (response types for Task 3's endpoints)
- Modify: `web/src/strings/en.ts` and `web/src/strings/hi.ts` (labels)
- Test: `web/src/pages/admin/evidence/panels.test.tsx` *(see Step 1 on the runner)*

**Interfaces:**
- Consumes: every endpoint in Task 3's table.
- Produces: the route `/admin/evidence`, ADMIN-only.

**Amended for restraint.** The brief is clean and understandable, not dense. Each tab gets **one response** from its aggregate endpoint and derives every card, chart and table on that tab from it, so they cannot disagree. Each tab carries **at most four visuals**; if a fifth seems necessary, one of the four was not earning its place. A chart that cannot answer all four questions from the page alone is cut, not captioned.

| Tab | Visuals (at most four) | Source |
|---|---|---|
| **Overview** | Four KPI cards only — validation status, last scheduler run, audit integrity, applications in flight. No chart. | `summary`, `audit-integrity`, `engine-runs` |
| **Workflow** | Lifecycle funnel; status distribution; processing-time median with its censored counts; volume over time | `workflow` |
| **Assignment** | Utilisation per officer with its capacity line; utilisation spread; the per-decision explanation table from `assignment-trace` | `assignment` |
| **Scheduler and compliance** | Run timeline (duration and status); deadline states; escalations by level; alerts created against suppressed | `compliance`, `engine-runs` |
| **Audit** | Events by action; events by actor role; the live integrity result — counts only, no case state | `audit-analytics` |
| **Form check** | Confusion matrix; recall per fault type. Synthetic, stated in the panel body. | `artifacts` |
| **Performance** | Latency percentiles per screen; benchmark runs compared only within the same environment | `artifacts` |

Every panel renders, in this order: a descriptive title naming the measure and its unit; the provenance chip; the one-line KPI definition from the endpoint's `definition` field (rendered verbatim, not paraphrased in the UI); then the visual or its empty state; then a methodology note only where the measure could be misread.

Rules that make the page honest rather than decorative:

- Every panel renders a `<Provenance kind=…>` chip: `LIVE_DEMO`, `TEST_RUN`, `BENCHMARK` or `SIMULATED`.
- Every KPI and axis carries a metric definition on hover **and** as text, since a tooltip is unreachable by keyboard and absent on a phone.
- Status is never colour alone: pair each with its word.
- The fairness panel reports the **spread** (standard deviation of projected utilisation) and names the policy version; it must not use the word "fair" about equal counts.
- The form-check panel states "synthetic data" in the panel body, not only in a caption, and shows the 0.315 unit-error recall beside the 0.863 overall.
- Benchmark runs are compared only within the same `machine` block; runs from different environments are shown side by side with their environments, never averaged.
- **Absent data renders as an empty state naming what is absent**, never as `0`, a flat line or a 0% share. A `null` from the API is "not measured", not zero.
- **No invented history**: a series starts where its data starts, with no back-fill, no interpolation across gaps and no trend line through two points.
- **One query per tab.** A card and the chart under it are two renderings of one number, never two computations of it.
- **The date filter applies to every panel on its tab**, or the tab has no filter. A filter that misses one panel is a defect, not a cosmetic gap.
- **Targets are drawn so they cannot read as achievements** — dashed, labelled "target", and never on the same axis style as a measured series.

- [ ] **Step 1: Write the failing tests**

`web` has no test runner configured. Add `vitest` + `@testing-library/react` + `jsdom` as web devDependencies and a `test` script (`vitest run`); this is the same runner the API already uses, so it introduces no new framework. Then:

```tsx
// web/src/pages/admin/evidence/panels.test.tsx
it('renders the empty state, not a broken chart, when a panel has no rows [Review Focus 4]', () => {
  render(<SchedulerPanel data={{ rows: [], total: 0 }} />);
  expect(screen.getByText(/no engine runs recorded yet/i)).toBeInTheDocument();
  expect(document.querySelector('.recharts-wrapper')).toBeNull();
});

it('never shows PASS for a NOT_VERIFIED summary', () => {
  render(<OverviewPanel summary={{ status: 'NOT_VERIFIED', checks: { passed: 0, failed: 0, notVerified: 0 } }} />);
  expect(screen.getByText(/not verified/i)).toBeInTheDocument();
  expect(screen.queryByText(/^pass$/i)).toBeNull();
});

it('shows STALE with both commits when the artifact is behind HEAD', () => {
  render(<OverviewPanel summary={{ status: 'STALE', commit: 'abc1234', artifactCommit: 'deadbee', checks: { passed: 183, failed: 0, notVerified: 0 } }} />);
  expect(screen.getByText(/stale/i)).toBeInTheDocument();
  expect(screen.getByText(/deadbee/)).toBeInTheDocument();
});

it('labels every panel with its provenance', () => {
  render(<FormCheckPanel metrics={fixtureMetrics} />);
  expect(screen.getByText(/synthetic/i)).toBeInTheDocument();
  expect(screen.getByText(/0\.315/)).toBeInTheDocument();
  expect(screen.queryByText(/0\.89|2\.9%/)).toBeNull();
});

it('states the fairness metric rather than calling a distribution fair', () => {
  render(<FairnessPanel rows={fixtureWorkload} policyVersion="2027-28 v1" />);
  expect(screen.getByText(/standard deviation|spread/i)).toBeInTheDocument();
  expect(screen.getByText(/2027-28 v1/)).toBeInTheDocument();
  expect(screen.queryByText(/\bfair\b/i)).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --workspace web run test`
Expected: FAIL — the panel modules do not exist.

- [ ] **Step 3: Build `Provenance.tsx` and `panels.tsx`**

Each panel is a pure component taking already-fetched data, so the tests above need no network. Use `ResponsiveContainer` + the recharts primitive + `tokens.*` from `../../../lib/chartTokens`, exactly as `web/src/pages/manager/Team.tsx:107-118` does. Each panel renders, in order: heading, `<Provenance>`, the metric definition, then the chart or the empty state. A panel with no rows returns its empty state and renders no chart.

- [ ] **Step 4: Build `EvidenceCenter.tsx` and wire the route**

Tabs over the panels, each tab's data from a `useQuery` against Task 3's endpoints, with a shared date-range filter for the time-series panels. Loading, empty and error states per tab. Add the route inside `<RequireRole roles={['ADMIN']}>` beside `/admin` in `App.tsx`, and a link from `Admin.tsx`.

- [ ] **Step 5: Run the tests and the build**

Run: `npm --workspace web run test && npm --workspace web run build`
Expected: 5 passed; build succeeds (the ~919 kB chunk warning is pre-existing).

- [ ] **Step 6: Verify it against the running app**

Start the API and web dev server, sign in as `admin@demo.in` / `demo1234`, open `/admin/evidence`, and confirm with a screenshot per tab that: every panel shows a provenance chip; the scheduler tab lists real runs after `npm --workspace api run demo:reset` and one cycle; and the overview does **not** read `PASS`. Save the screenshots under `docs/screens/evidence/`.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/admin/evidence web/src/App.tsx web/src/api/types.ts web/src/strings web/package.json docs/screens/evidence
git commit -m "Evidence Center: a judge-facing page over the stored evidence"
```

---

### Task 5: Wire the engine-cycle counters into the load test and the artifacts

**Files:**
- Modify: `api/scripts/load-test.ts` (the `report` object)
- Modify: `scripts/evidence-charts.mjs` (one new chart)
- Modify: `docs/evidence/BENCHMARKS.md`
- Test: `scripts/evidence-charts.test.mjs`

**Interfaces:**
- Consumes: Task 1's `alertsSuppressed` and `engineRunId`.
- Produces: `alertsSuppressed` in the benchmark JSON, and `docs/evidence/charts/duplicate-prevention.svg`.

The second cycle's `0 alerts` currently proves duplicate prevention only by absence. `alertsSuppressed` proves it by measurement, and that figure belongs in the benchmark artifact and on a chart.

- [ ] **Step 1: Write the failing test**

```js
test('the duplicate-prevention chart plots created against suppressed', () => {
  const svg = barChart({ title: 'Duplicate alert prevention', caption: 'c', unit: 'alerts',
    series: [{ label: 'Created (cycle 1)', value: 9321 }, { label: 'Suppressed (cycle 2)', value: 9321 }], max: 9321 });
  assert.match(svg, /Suppressed/);
  assert.ok(!svg.includes('undefined') && !svg.includes('NaN'));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test scripts/*.test.mjs`
Expected: FAIL. (**Never** `node --test scripts/` — that form silently runs nothing on Node 22.)

- [ ] **Step 3: Add the chart and the report field**

Add `alertsSuppressed` to each cycle in the load test's `engine` block, and the fourth-plus chart to `buildCharts`.

- [ ] **Step 4: Re-run the benchmark and regenerate**

Run: `cd api && npm run load:test -- --out ../docs/evidence/benchmark-results/$(git rev-parse --short HEAD).json` then the generator. **Local database only** — it resets the demo database at both ends.

- [ ] **Step 5: Update `BENCHMARKS.md`**

Add the measured `alertsSuppressed` beside the existing second-cycle figure, with the limitation inline. **Do not delete the previous run's JSON** — benchmark history is additive.

- [ ] **Step 6: Run the tests**

Run: `node --test scripts/*.test.mjs && npm test`
Expected: 5 chart tests; 196 API tests.

- [ ] **Step 7: Commit**

```bash
git add api/scripts/load-test.ts scripts/evidence-charts.mjs scripts/evidence-charts.test.mjs docs/evidence
git commit -m "Benchmarks: measure duplicate alert prevention instead of inferring it"
```

---

### Task 6: Aggregation endpoints with stated KPI definitions

*Added by the amendment above. **Execution order is 1, 2, 3, 6, 4, 5** — Task 4 draws what this task computes, so this precedes it.*

**Files:**
- Create: `api/src/routes/evidence/aggregates.ts` (the queries and their definitions)
- Modify: `api/src/routes/evidence.ts` (mount the aggregate routes)
- Test: `api/test/evidence-aggregates.test.ts`

**Interfaces:**
- Consumes: `EngineRun` (Task 1), `AssignmentTrace` (Task 2), and the existing `Application`, `DeadlineItem`, `AlertLog`, `Assignment`, `OfficerProfile`, `AuditLog` tables.
- Produces: the endpoints below. Task 4 consumes them and derives every card, chart and table on a tab from **one** response per tab.

Each endpoint returns `{ definition, provenance, data }`, where `definition` is the written KPI definition (numerator, denominator, window, exclusions) that the UI renders verbatim, and `provenance` is `MEASURED`, `DERIVED`, `SYNTHETIC` or `TARGET`.

| Endpoint | Measure, and the definition it must state |
|---|---|
| `GET /api/evidence/workflow?from&to` | **Funnel**: distinct applications that have *reached* each stage, counted from `AuditLog` stage transitions, not from current status — an application now at `DECIDED` has still passed through scrutiny. Denominator for each stage's share is applications submitted in the window. **Status distribution**: current `status` counts, denominator = applications in the window. **Processing time**: median working days from submission to decision over **decided** cases only, reported with `decidedCount` and `inFlightCount`; a censored sample, never a mean over unfinished cases. **Volume over time**: submitted, decided and overdue per day, starting at the first record — no back-fill. |
| `GET /api/evidence/assignment?from&to` | Per officer: `capacityPoints`, open `weight` sum, `utilisation = openPoints / capacity` (**DERIVED**, formula stated). **Spread**: the standard deviation of utilisation across officers *with capacity > 0*, with `officerCount` as the denominator. Never the word "fair". Plus the eligible/excluded counts from `AssignmentTrace` and the pinned `rulePackVersion` label. |
| `GET /api/evidence/compliance?from&to` | Deadline items by state (`atRisk`, `overdue`, `dueSoon`, `met`) with the working-day definition of each stated; escalations by level 1/2/3; alerts by `kind` and by `late`; and `alertsSuppressed` summed from `EngineRun` as the **measured** duplicate-prevention figure. |
| `GET /api/evidence/audit-analytics?from&to&actor&action&entity` | Event counts by actor role, by action and by entity, plus the live `verifyChains()` result. ADMIN-only like the rest; never returns `fromState`/`toState` bodies, only counts, so no case detail leaks through an analytics endpoint. |

- [ ] **Step 1: Write the failing tests**

Each test builds known rows and asserts the endpoint's number against an independently counted expectation.

```ts
// api/test/evidence-aggregates.test.ts
it('counts the funnel from stage transitions, not current status', async () => {
  // Drive one application all the way to DECIDED, then assert it is counted in every
  // stage it passed through — not only in the last one.
  const { applicationId } = await driveToDecided();
  const r = await request(app).get('/api/evidence/workflow').set(...bearer(admin));
  const f = r.body.data.funnel;
  expect(f.find((s: { stage: string }) => s.stage === 'SCRUTINY')!.reached).toBeGreaterThanOrEqual(1);
  expect(f.find((s: { stage: string }) => s.stage === 'DECIDED')!.reached).toBeGreaterThanOrEqual(1);
});

it('reports processing time over decided cases only, with the censored counts', async () => {
  const r = await request(app).get('/api/evidence/workflow').set(...bearer(admin));
  const p = r.body.data.processingTime;
  expect(p.decidedCount).toBeGreaterThan(0);
  expect(p).toHaveProperty('inFlightCount');
  expect(p).toHaveProperty('medianWorkingDays');
  expect(p).not.toHaveProperty('mean');
  expect(r.body.definition.processingTime).toMatch(/decided|censor/i);
});

it('returns null rather than 0 for a measure with no data in the window', async () => {
  const r = await request(app).get('/api/evidence/workflow?from=1990-01-01&to=1990-01-02').set(...bearer(admin));
  expect(r.body.data.processingTime.medianWorkingDays).toBeNull();
  expect(r.body.data.processingTime.decidedCount).toBe(0);
});

it('computes utilisation spread only over officers with capacity, and names the denominator', async () => {
  const r = await request(app).get('/api/evidence/assignment').set(...bearer(admin));
  const a = r.body.data;
  const withCapacity = await prisma.officerProfile.count({ where: { capacityPoints: { gt: 0 } } });
  expect(a.spread.officerCount).toBe(withCapacity);
  expect(JSON.stringify(r.body)).not.toMatch(/\bfair\b/i);
});

it('the alerts total equals the AlertLog rows in the window, and suppressed comes from EngineRun', async () => {
  await runEngineCycle({ source: 'test' });
  const r = await request(app).get('/api/evidence/compliance').set(...bearer(admin));
  expect(r.body.data.alerts.total).toBe(await prisma.alertLog.count());
  const sup = await prisma.engineRun.aggregate({ _sum: { alertsSuppressed: true } });
  expect(r.body.data.alerts.suppressed).toBe(sup._sum.alertsSuppressed ?? 0);
});

it('the funnel and the status distribution agree on the application total', async () => {
  const r = await request(app).get('/api/evidence/workflow').set(...bearer(admin));
  const statusTotal = r.body.data.statusDistribution.reduce((n: number, s: { count: number }) => n + s.count, 0);
  expect(statusTotal).toBe(r.body.data.submittedTotal);
});

it('audit analytics returns counts only, never case state', async () => {
  const r = await request(app).get('/api/evidence/audit-analytics').set(...bearer(admin));
  expect(r.status).toBe(200);
  expect(JSON.stringify(r.body)).not.toMatch(/fromState|toState|rowHash/);
});

it('a date filter narrows every measure in the response, not some of them', async () => {
  const wide = await request(app).get('/api/evidence/workflow').set(...bearer(admin));
  const narrow = await request(app).get('/api/evidence/workflow?from=2099-01-01&to=2099-01-02').set(...bearer(admin));
  expect(narrow.body.data.submittedTotal).toBe(0);
  expect(narrow.body.data.volumeOverTime).toEqual([]);
  expect(narrow.body.data.statusDistribution.every((s: { count: number }) => s.count === 0)).toBe(true);
  expect(wide.body.data.submittedTotal).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && npx vitest run test/evidence-aggregates.test.ts`
Expected: FAIL with 404 on every route.

- [ ] **Step 3: Implement the aggregates**

One exported function per endpoint in `aggregates.ts`, each returning `{ definition, provenance, data }`. Prefer a single SQL round trip per endpoint via `prisma.$queryRaw` where a Prisma aggregate cannot express it; working-day arithmetic reuses `api/src/lib/workdays.ts` rather than re-deriving it. The funnel reads `AuditLog` actions, so check the action names actually written by `api/src/workflow/actions.ts` instead of assuming them.

- [ ] **Step 4: Mount and run the tests**

Run: `cd api && npx vitest run test/evidence-aggregates.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Run the full suite and the typecheck**

Run: `npm test && npm --workspace api run typecheck`
Expected: all green, count = previous + 8.

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/evidence api/src/routes/evidence.ts api/test/evidence-aggregates.test.ts
git commit -m "Evidence API: aggregates that state their own KPI definitions"
```

---

## Amendment 2 (2026-11-03): eight sections, a split Task 4, and what the data actually supports

**Why.** The user specified the page structure: **Overview, Workflow, Assignment, Scheduler & compliance, Alerts, Audit, ML evaluation, Performance** — "keep each section focused … avoid putting every metric on one screen." Task 4 as first written (seven tabs in one task) could not be gated by one reviewer, so it is replaced by 4a–4e. Before writing these I inspected the dev database, and several things the request assumed do not exist in the data. They are recorded here because they bind the design; **a panel the data cannot support is shown as an explicit insufficient-data state, never faked**.

### What the data does and does not support (measured on the dev database, 2026-11-03)

*Figures are from one seed and vary slightly between reseeds (e.g. 191–192 applications, 810–812 notifications). The conclusions do not depend on the exact counts; the section tasks and the verification script always re-measure.*

| Requested | What exists | Consequence |
|---|---|---|
| Alerts by **status**; acknowledgement and resolution time | `AlertLog` has **no status, acknowledgement or resolution field** — only `late`. `Notification` has one `read` boolean. | A status panel would be invention. The Alerts section shows an insufficient-data panel naming exactly what is not recorded. |
| Notification read state | 812 notifications, **0 read** — nobody has signed in to open them. | True and meaningless. Not charted; the response flags `informative: false` and the UI says why. |
| Alert **trend** | 107 alerts over **7 distinct simulated days** (1, 1, 3, 16, 22, 43, 21). Gaps are days the engine did not run, not zero-alert days. | Bars per day, gaps omitted, never a line; x-axis labelled "simulated date". The definition says it records when the engine ran, not an operational trend. |
| Benchmark **comparison across runs** | **One** run is committed (`565c210.json`). The 26 Oct run exists only as prose, from a different CPU. | Insufficient-data panel until Task 5 adds a second run on the same machine block. Runs are compared only when their `machine` blocks match. |
| Confusion matrix | `metrics.json` stores rates and the test-set sizes (1,000 normal, 1,000 faulty). | **Derivable exactly**: TP 863, FN 137, FP 22, TN 978 (three decimals over 1,000 samples is lossless); recomputed precision 0.9751 matches stored 0.975; F1 0.9156. Shown as **DERIVED** with the formula. |
| Feature-level ML explanations | Not in `metrics.json`; per-form explanations live on each case's Form checks panel. | Not aggregated here. A one-line pointer, stated as a deliberate omission. |
| Resource utilisation during benchmarks | Not measured. | Stated as not measured. |
| Engine **run timeline** by time | All 25 runs started on **one real day**; `simulatedToday` spans 2026-05-18 → 2026-11-03. | X-axis is run sequence, with the simulated date in the tooltip and table. A time axis would stack 25 dots on one tick. |
| `LIVE_DEMO` provenance on engine runs | All 25 are tagged `LIVE_DEMO`, but they were produced by the seed on a back-dated clock. | **Defect in Task 1's labelling.** `SIMULATED` exists and is never emitted. Fixed in Task 7. |

### The clock rule (Ruling E14)

**Superseded by Ruling E22.** Engine runs are windowed by `simulatedToday` (the date the engine treated as today), so applications, deadlines, alerts and runs share one clock; real `startedAt` is a displayed column and the 15-minute abandoned test is the only thing that uses real time. Each filter still sits inside the group it governs, current-state groups take no filter and say so, and the range is per-section and cleared on section change. *(The original text of this rule, which windowed runs by real start time, was withdrawn after the dev database showed all 25 runs inside a 24-second real-time span and alerts disagreeing with runs for the same window.)*

### Revised execution order

`1 ✔, 2 ✔, 3 ✔, 6 ✔, 7 ✔ (independent review running), 7b, 4a, 4b, 4c, 4d, 5, 4e, 8, 9, 10.`
Task 5 now precedes 4e so the Performance section has two comparable runs; 4e still tests the single-run case.

### The eight sections — what each shows, and what it deliberately does not

Every section is built from `Panel` (Task 4a), so every panel has: a descriptive title naming the measure and its unit; a provenance chip; an **always-visible scope line** ("n = 192 applications · all dates"); the endpoint's `definition` in a `<details>` in the same card; the visual; and its loading / empty / error / insufficient-data states handled once. **At most four visuals per section.** Every chart has a "data table" disclosure rendering the **same rows** the chart is drawn from.

| Section | Source (one response each) | Visuals |
|---|---|---|
| **Overview** | `summary`, `workflow`, `engine-runs`, `audit-integrity` | Four KPI tiles (validation status, applications in flight, last scheduler run, audit integrity) + one trend: applications submitted and decided per day. No filter; "all dates". |
| **Workflow** | `workflow` | Lifecycle funnel (with `onRoute`); status distribution; processing-time median with decided / in-flight counts; volume over time incl. the overdue series. Filter governs all four. Current overdue is on the Scheduler section, linked. |
| **Assignment** | `assignment` (+ `assignment-trace` on drill-down) | Utilisation per officer (current state, **no filter**); spread; the above-cap exceptions with their causes; recent decisions → candidate table. Coverage `traced / total` stated. A windowed group holds `openPointsAssignedInWindow` and decision counts. |
| **Scheduler & compliance** | `compliance`, `engine-runs` | *Current state* (no filter): deadline risk — at-risk / overdue / due soon / met. *Execution history* (filter, by the date the engine treated as today): run duration by run, created vs suppressed, reliability tiles (runs / failed / abandoned), recent-runs table. |
| **Alerts** | `alerts` | Volume by kind; on-time vs late; alerts per simulated day; escalations by level; one insufficient-data panel for status. Filter governs all (simulated clock). |
| **Audit** | `audit-analytics` | Events by action, by actor role, by entity (filters: date, actor, action, entity — options taken from values actually present); the integrity result with its **WHOLE_LOG** scope stated beside it and a note that filters do not change it. Counts only. |
| **ML evaluation** | `artifacts` → `formcheck/metrics.json` | Headline metrics (stored vs **DERIVED** marked); derived confusion matrix; baseline comparison across the three modes; recall per fault type. "Synthetic data" in each panel body. Methodology and limitations. |
| **Performance** | `artifacts` → `benchmark-results/*.json` | Test configuration; read latency p50 / p95 / p99 per screen; engine cycles first vs second; run comparison (insufficient-data until two same-machine runs exist). Repeat count stated; resource use stated as not measured. |

### Task 7: alerts aggregate, run totals and honest run provenance

**Files:** Create `api/src/routes/evidence/alerts.ts`. Modify `api/src/routes/evidence.ts` (mount `GET /alerts`; add `totals` to `GET /engine-runs`), `api/src/engine/cycle.ts` (`runProvenance`). Tests: `api/test/evidence-alerts.test.ts`, `api/test/engine-run.test.ts`.
**Interfaces — Produces:**

```ts
// GET /api/evidence/alerts?from&to  → EvidenceEnvelope<AlertsData>
interface AlertsData {
  engineEverRan: boolean;                       // all-time, clock-independent; false ⇒ totals are null ("none recorded")
  total: number | null;                         // AlertLog rows created in the window
  byKind: { kind: string; count: number }[];
  timing: { onTime: number; late: number } | null;      // from AlertLog.late; sums to total
  perDay: { day: string; count: number }[];             // simulated clock; days with ≥1 alert only, NEVER zero-filled
  escalationsByLevel: { level: number; count: number }[];
  notifications: { total: number; read: number; unread: number; informative: boolean }; // informative = read > 0
  notRecorded: ('acknowledgement' | 'resolution time')[];  // an explicit, tested absence
}
// GET /api/evidence/engine-runs gains:
totals: { runCount: number; failedCount: number; abandonedCount: number;
          alertsCreated: number | null; alertsSuppressed: number | null }   // null, not 0, when runCount is 0
```

`abandonedCount` is runs with `status = 'RUNNING'` and `startedAt` older than **15 minutes** (the longest measured cycle is ~140 s at 15,000 applications), per Ruling E4. `runProvenance` gains `SIMULATED` when the clock is overridden or offset; precedence is `TEST_RUN` > `BENCHMARK` > `SIMULATED` > `LIVE_DEMO`.

- [ ] **Step 1: Write the failing tests**
  1. `alerts.total` equals `prisma.alertLog.count()`; `byKind` sums to `total`; `timing.onTime + timing.late` equals `total`.
  2. `perDay` omits days with no alerts, each day's count equals an independently grouped count, and the days sum to `total`.
  3. A window containing no alerts, after the engine has run, gives `total: 0` and `perDay: []` — a **genuine zero**; with no `EngineRun` and no `AlertLog` rows ever, `total` is `null` and `engineEverRan` is `false`.
  4. The window narrows `byKind`, `timing`, `perDay` and `escalationsByLevel` together, not some of them.
  5. `escalationsByLevel` equals `AlertLog` rows of kind `ESCALATION` grouped by `offsetOrLevel`, and sums to `byKind`'s `ESCALATION`.
  6. `notifications` reports seeded `read: 0` with `informative: false`; after one notification is marked read through the API, `informative` is `true`.
  7. `notRecorded` contains both entries, and the response has **no** `acknowledged`, `resolved` or `status` key anywhere.
  8. `engine-runs.totals.alertsCreated` equals `sum(EngineRun.alertsCreated)` and, on the freshly seeded database, equals the `AlertLog` row count (both 107 in dev); `alertsSuppressed` equals the independent sum.
  9. `totals` over an empty window: `runCount: 0`, `alertsCreated: null`, `alertsSuppressed: null`.
  10. `abandonedCount` counts a `RUNNING` row backdated one hour and does **not** count a `RUNNING` row started a minute ago.
  11. Provenance: with `VITEST`/`NODE_ENV` unset and the clock overridden → `SIMULATED`; with a real, unoffset clock → `LIVE_DEMO`; `TEST_RUN` still wins under vitest; `BENCHMARK` still wins for `source: 'load-test'`. Restore all env and clock state in `finally`.
- [ ] **Step 2:** Run `cd api && npx vitest run test/evidence-alerts.test.ts test/engine-run.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Reuse the window helpers and `{ definition, provenance, data }` envelope from `aggregates.ts`; do not grow that file — it is already ~310 lines.
- [ ] **Step 4:** Re-run until green; then `npm test && npm --workspace api run typecheck`. Expected: previous count + new tests.
- [ ] **Step 5:** Reseed the dev database (`SETUP_NO_DOCKER=1 npm --workspace api run setup:db`) and confirm the 25 seeded runs now read `SIMULATED`.
- [ ] **Step 6:** Commit in two commits — provenance, then alerts + totals.

### Task 7b: definitions and a day-inclusive window for `summary` and `engine-runs`

*Added after Task 7's implementer reported that `engine-runs` returns no `definition` and its `to` bound looked wrong; confirmed by the independent review before dispatch.*

**Why it is a task and not a footnote.** The contract is that every KPI's definition is rendered verbatim from the endpoint beside its number. Four endpoints already do that. `summary` and `engine-runs` do not, yet the Overview and Scheduler sections draw their headline tiles from them: the 15-minute abandoned-run rule and the real-clock window exist only in code comments, and nothing tells a reader what `NOT_VERIFIED` means. Separately, `engine-runs` applies `to` as `lte` on a bare date, which is midnight — so choosing `to = today` **silently excludes every run that started today**, i.e. the most recent data, from a filtered view.

**Files:** Modify `api/src/routes/evidence.ts` (and `evidence/artifacts.ts` only if the summary text lives there). Test: `api/test/evidence-api.test.ts`, `api/test/evidence-alerts.test.ts`.
**Interfaces — Produces** (additive; no existing key changes):

```ts
// GET /api/evidence/summary gains
definition: { status: string; scheduler: string };
provenance: { status: Provenance | null; scheduler: Provenance };
// GET /api/evidence/engine-runs gains
definition: { window: string; rows: string; totals: string; abandoned: string; alertsCreated: string; alertsSuppressed: string };
provenance: { rows: Provenance; totals: Provenance };   // rows carry their own per-row provenance as well
```

Required wording (plain language, for a judge who has never seen the code):
- `summary.definition.status`: reads the recorded test-result artifact and **never runs tests**; names each of `PASS`, `FAIL`, `STALE` and `NOT_VERIFIED`; says `PASS` needs at least one passed check, none failed and none unverified, recorded against the current commit.
- `summary.definition.scheduler`: the most recent *recorded* cycle (from the run history, whoever ran it) **and**, separately, the scheduler process's own heartbeat from `SchedulerHeartbeat` when one has reported; `heartbeat: null` means no scheduler process has reported to this database, which does **not by itself** mean one is down. *(An earlier version of this line said no heartbeat is recorded. That was false — the table exists and is written by `scheduler.ts` and `serverless.ts` — and was caught by review.)*
- `engine-runs.definition.window`: the dates apply to **the date the engine treated as today** when the cycle ran (`simulatedToday`) — the same calendar the alerts, deadlines and applications use. It equals the real date on a system running in real time and is the simulated date in this demo's back-dated history. Both end dates are included. *(Ruling E22 — an earlier version windowed by real start time.)*
- `engine-runs.definition.abandoned`: a run still marked running after 15 minutes is counted abandoned, not in progress, because a crash cannot update its own row.
- `alertsCreated` / `alertsSuppressed`: summed over the runs in the window; equal to the alert log total only when every alert was raised by a recorded run.

- [ ] **Step 1: Write the failing tests**
  1. `summary` has a non-empty `definition.status` that mentions each of the four statuses, and a non-empty `definition.scheduler` that explains the heartbeat.
  2. `engine-runs` has a non-empty string for every key listed above, and `definition.window` says the dates apply to the date the engine treated as today.
  3. **Inclusive window on the shared calendar:** a run whose `simulatedToday` is a given date is returned by `from=<that date>&to=<that date>`, and for any window `alerts.total === engine-runs.totals.alertsCreated` when every alert was raised by a recorded run.
  4. `rows`, `total` and `totals` agree under the same window — `total === totals.runCount` for every window tested.
  5. No response string contains "fair", "tamper-proof", "exactly-once" or "production-ready".
- [ ] **Step 2:** Run the two test files; expect FAIL.
- [ ] **Step 3:** Implement. Compute the upper bound as the start of the day after `to`, using a strict `<`, in both the rows query and the totals query so they cannot drift.
- [ ] **Step 4:** Re-run until green, then the full suite and the typecheck. Expect 225 plus the new tests.
- [ ] **Step 5:** Commit.

### Task 4a: Foundation — test runner, primitives, shell, route

**Files:**
- Modify `web/package.json` (devDependencies `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`; script `"test": "vitest run"`), root `package.json` (`"test:web"`), `.github/workflows/ci.yml` (a `npm --workspace web run test` step in the web job), `web/src/App.tsx` (routes `/admin/evidence` and `/admin/evidence/:section` inside `RequireRole roles={['ADMIN']}`), `web/src/pages/admin/Admin.tsx` (a link), `web/src/api/types.ts`, `web/src/strings/en.ts`, `hi.ts`.
- Create `web/vitest.config.ts`, `web/src/test/setup.ts`, and under `web/src/pages/admin/evidence/`: `EvidenceCenter.tsx`, `sections.ts`, `Panel.tsx`, `Provenance.tsx`, `DateRange.tsx`, `ChartFrame.tsx`, `format.ts`, `useEvidence.ts`; tests beside them.

**Reuse, do not rebuild.** The app already has `Card`, `StatTile`, `EmptyState`, `ErrorState`, `Skeleton`, `PageHeader`, `Badge`, `Button`, `Table`, `Tabs` (ARIA roles and arrow-key navigation) and `SegmentedControl` in `web/src/components/ui`, the `api` / `qs` client, and `formatNumber` / `formatDate` in `lib/format`. Chart colours come from `web/src/lib/chartTokens.ts`. **No new chart or UI library.**

**Interfaces — Produces (exact):**

```ts
export type Provenance = 'MEASURED' | 'DERIVED' | 'SYNTHETIC' | 'TARGET' | 'LIVE_DEMO' | 'TEST_RUN' | 'BENCHMARK' | 'SIMULATED';
export interface EvidenceEnvelope<T> { definition: Record<string, string>; provenance: Record<string, Provenance | null>; data: T }
export type PanelState = 'ready' | 'loading' | 'error' | 'empty' | 'insufficient';

export function Panel(p: {
  title: string;                      // names the measure AND its unit
  provenance: Provenance | null;
  scope: string;                      // always visible: "n = 192 applications · all dates"
  definition: string | undefined;     // the endpoint's text, rendered verbatim in a <details>
  state: PanelState;
  emptyMessage?: string; insufficientMessage?: string;
  error?: { message?: string; onRetry?: () => void };
  children: ReactNode;
}): JSX.Element;

export function ChartFrame(p: {
  label: string;                      // aria-label summarising what the chart shows
  height?: number;
  columns: { key: string; header: string; format?: (v: unknown) => string }[];
  rows: Record<string, unknown>[];    // the SAME rows the chart is drawn from
  children: ReactElement;             // the recharts chart
}): JSX.Element;

export function DateRange(p: { from?: string; to?: string; onChange: (r: { from?: string; to?: string }) => void; clockLabel: string }): JSX.Element;
export function useEvidence<T>(path: string, params?: Record<string, string | undefined>): UseQueryResult<T>;
export const fmtInt: (v: number | null | undefined) => string;   // null/undefined → 'Unavailable'; 0 → '0'
export const fmtPct: (v: number | null | undefined, dp?: number) => string;
export const fmtMs: (v: number | null | undefined) => string;
```

**Behaviour that makes the page honest rather than decorative** (each is tested):
- `Panel` in the `ready` state with an empty or missing `definition` renders an error state ("This measure has no definition and is not shown") and **not** its children — an unstated KPI never displays.
- `insufficient` renders `insufficientMessage` and never the children; `empty` renders `emptyMessage` and never the children.
- A provenance chip is always a **text label with an icon**, never colour alone; `TARGET` reads "Target — not a measurement".
- `ChartFrame` renders a `role="img"` with the label and a "Data table" `<details>` with exactly `rows.length` body rows; a `null` cell reads "Unavailable", never "0".
- `DateRange` rejects `from > to` with a visible message and does not call `onChange`; has labelled "From" and "To" inputs; "Clear" resets; the range is held in the URL (`?from=&to=`) and cleared on section change. It displays `clockLabel`.
- The shell shows `Tabs` from `md` up and a labelled native `<select>` below it; both list the same eight sections. An unknown `:section` redirects to Overview.
- Recharts renders nothing under jsdom (zero-width container), so **tests assert the data table, text and states, never SVG internals.**

- [ ] **Step 1:** Write the failing tests for every behaviour above, in files beside the components.
- [ ] **Step 2:** Add the runner; confirm the suite FAILS because the components do not exist.
- [ ] **Step 3:** Implement; run `npm --workspace web run test`, `npm --workspace web run build`, and the root `npm test` (API suite must be unchanged).
- [ ] **Step 4:** Add the web step to `ci.yml` and confirm both workflow files still parse as YAML.
- [ ] **Step 5:** Screenshot `/admin/evidence` at 1280 px and 390 px (chromium is preinstalled; `require('playwright')` resolves from `/opt/node-tools`) and confirm the section nav does not overflow on mobile.
- [ ] **Step 6:** Commit.

### Tasks 4b–4e: the section tasks

Each follows the same loop: read the **final** shape of the endpoint it draws (call it against the dev database as `admin@demo.in`; do not infer from this plan), add its types to `web/src/api/types.ts`, build its panels from `Panel` / `ChartFrame`, write failing tests first, then verify against the running app with screenshots at desktop and mobile widths. Each section's tests must cover: **the empty state; the insufficient-data state; that every panel receives a non-empty definition; that a chart's data table equals the API response for the same measure; and that the filter reaches every panel it governs** (assert the query key and URL params, since SVG is not testable).

- **4b — Overview + Workflow.** The four Overview tiles must be built from the **same query keys** as the Workflow section so a tile and its detail cannot disagree. "Validation status" is `NOT_VERIFIED` today and must read that way: warning emphasis plus the words, never green. "Last scheduler run" states real start time, duration and status, and counts `abandoned` runs. Workflow's overdue series carries the note that its x-axis is due date, not the From/To range.
- **4c — Assignment.** Utilisation is current state and takes no filter. Render the coverage as a stated figure ("221 of 221 assignments have an explanation") and the above-cap list with its three causes in words. Add `recentDecisions` (last 10 traces: application number, task, outcome, chosen officer, decided at) to the `assignment` aggregate if it is not there, so the drill-down is selectable without a UUID; the drill-down shows the candidate table from `assignment-trace/:applicationId`. The word "fair" appears nowhere.
- **4d — Scheduler & compliance, and Alerts.** One date filter on the Scheduler section (simulated-day window for engine runs and alerts); the "open deadlines now" group is current state, takes no filter, and says so. Created vs suppressed comes from `engine-runs.totals`, not from client-side summing of a paged list. The Alerts status panel is the explicit insufficient-data state naming `notRecorded`, and shows read state only when `informative`.
- **4e — Audit, ML evaluation, Performance.** Audit filter options come from values present in the response. The integrity result sits beside its `WHOLE_LOG` definition and says filters do not change it. ML shows stored metrics and DERIVED ones distinctly, derives the confusion matrix with the formula visible, and carries "synthetic data" in every panel body; the evaluation date is `generatedAt`, defined as *when the figures last changed*, not when the evaluation last ran. Performance compares runs only when their `machine` blocks match; with one run it shows the insufficient-data panel; it states repeat count 1 and resource use as not measured.

### Task 8: independent verification script

**Create** `api/scripts/verify-evidence.ts` and an `evidence:verify` npm script. It authenticates as the administrator through `createApp()`, calls every aggregate, and compares each headline number to an independent raw-SQL ground truth — funnel stage counts, status distribution total, alerts total and by kind, escalations by level, suppressed total, trace coverage, officer count and utilisation spread, audit event total. It prints a table of `measure | endpoint | SQL | agrees` and **exits non-zero on any disagreement**. It must name the cluster and row counts it ran against. Test it by confirming it fails when a number is deliberately perturbed.

### Task 9: screenshots and documentation

Screenshots of all eight sections at 1280 px and 390 px into `docs/screens/evidence/`; update `docs/evidence/README.md` (the Evidence Center is now built — replace the design-intent wording), `docs/evidence/INITIAL_AUDIT.md` status rows, and the root README's link table.

### Task 10: final verification and whole-branch review

Run the complete API, web, pytest and node suites, both typechecks and both builds; run `evidence:verify`; run the final whole-branch review on the most capable model; fix every Critical and Important finding in one wave and re-review it once. Report actual output.
