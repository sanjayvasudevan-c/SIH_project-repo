# Evidence Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a judge an in-app Evidence Center whose every panel is drawn from real stored data — scheduler run history, assignment decisions, audit integrity and committed evidence artifacts — with provenance declared per panel and no status that a real check did not produce.

**Architecture:** Two new tables persist what the engine already computes and currently discards (`EngineRun`, `AssignmentTrace`). One ADMIN-only read-only router (`/api/evidence`) serves them alongside a live audit-integrity check and the committed JSON under `docs/evidence/`. The UI is a tabbed page under Admin built from the existing recharts + `chartTokens` house pattern. The UI is a viewer: it computes no verdicts, and a missing or stale artifact reads `STALE`, never green.

**Tech Stack:** Prisma 5 / PostgreSQL 16, Express 4 + zod, React 18 + TanStack Query 5 + react-router-dom 6, recharts 2.15.0 with `web/src/lib/chartTokens.ts`, Tailwind, lucide-react, vitest against a real database.

**Spec:** `docs/superpowers/specs/2026-11-03-github-evidence-design.md` (its "Architecture" and "Database additions" sections) and `docs/evidence/README.md` (the Evidence Center design, sections A–I).

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

### Task 4: The Evidence Center page

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

Tabs, each a section of `docs/evidence/README.md`: **Overview** (KPI cards), **Workflow** (lifecycle funnel, status distribution, processing time, volume over time), **Assignment** (workload, capacity utilisation, fairness spread, and the per-decision explanation from `assignment-trace`), **Scheduler** (run timeline, deadline monitoring, alert analytics, reliability), **Audit** (filterable event analytics and the live integrity result), **Form check** (confusion matrix, per-fault recall), **Benchmarks** (run comparison).

Rules that make the page honest rather than decorative:

- Every panel renders a `<Provenance kind=…>` chip: `LIVE_DEMO`, `TEST_RUN`, `BENCHMARK` or `SIMULATED`.
- Every KPI and axis carries a metric definition on hover **and** as text, since a tooltip is unreachable by keyboard and absent on a phone.
- Status is never colour alone: pair each with its word.
- The fairness panel reports the **spread** (standard deviation of projected utilisation) and names the policy version; it must not use the word "fair" about equal counts.
- The form-check panel states "synthetic data" in the panel body, not only in a caption, and shows the 0.315 unit-error recall beside the 0.863 overall.
- Benchmark runs are compared only within the same `machine` block; runs from different environments are shown side by side with their environments, never averaged.

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
