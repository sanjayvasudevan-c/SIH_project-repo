# Project Reviewer Journey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an evidence-led, interactive project story and review dashboard inside the existing SIH application.

**Architecture:** Add one ADMIN-only project story route using existing React Router, shell, and UI components. Feed it from a typed, version-controlled evidence dossier because current CI artifacts are not persisted to the application database; link to existing API-backed Evidence Center sections and repository evidence rather than creating a duplicate backend or database model.

**Tech Stack:** React 18, TypeScript, React Router 6, Tailwind, Vitest, Testing Library; existing Express/Prisma Evidence Center remains the source for its current live records.

**Spec:** `docs/evidence/PROJECT_REVIEWER_JOURNEY.md`

## Global Constraints

- Keep the feature in the existing app and preserve current routes, role guards, Action Center, and Evidence Center.
- Do not invent results, historical trends, coverage, user impact, or completion dates.
- Distinguish latest merged-main evidence (`b931f21`, run `41791850558`) from PR #14 history (`9e0e018`, run `41790535759`).
- Identify synthetic/model and benchmark evidence explicitly.
- Do not add a database model or migration for static project-level CI findings.
- Do not run API integration tests against an unverified developer database; use an isolated disposable PostgreSQL target.

## Review Focus

- Empty or malformed dossier collections: show an honest unavailable state; test it.
- Old CI snapshots: show revision and observation time and do not imply current pass; test stale labeling.
- Multiple filters/search at once: apply all selected constraints; test combined filtering.
- URL deep links to unknown chapter/component/finding: fall back to a valid selection; test invalid state.
- Role mismatch: non-admin users cannot access the route; test the route guard.

## File Map

- Create `web/src/data/projectReview.ts`: typed project facts, feature/component graph, CI snapshots, findings, gaps, evidence references, and provenance.
- Create `web/src/pages/admin/projectStory/ProjectStory.tsx`: story layout, chapter navigation, overview, architecture explorer, findings search/filter/detail, and evidence cross-links.
- Create `web/src/pages/admin/projectStory/ProjectStory.test.tsx`: interaction and source grounding tests.
- Modify `web/src/App.tsx`: lazy route under existing ADMIN guard.
- Modify `web/src/components/Layout.tsx` and `web/src/strings/{en,hi}.ts`: ADMIN navigation item and labels.
- Modify `web/src/pages/admin/evidence/EvidenceCenter.tsx`: add a project dossier entry point without changing existing evidence tabs or APIs.
- Modify `web/src/pages/admin/evidence/EvidenceCenter.test.tsx` if its route/navigation tests cover new entry point.
- Add only focused page styles if the existing Tailwind and UI primitives are insufficient.

### Task 1: Add typed evidence dossier

**Files:** create `web/src/data/projectReview.ts`; test in `ProjectStory.test.tsx`.

- [ ] Define discriminated provenance types and records with `id`, `title`, `summary`, `status`, `source`, `revision`, `observedAt`, and relevant relationship IDs.
- [ ] Record latest API 241/1, form-check 99/0, frontend 237/0, typechecks/build/chart checks from the actual merged-main CI run; associate run URL and exact commit.
- [ ] Add the single failed assignment test as OPEN, expected/actual explanation, component/API test source, and workflow evidence.
- [ ] Keep PR #14 counts only as a separate historical snapshot; add coverage/test gaps and synthetic-data limitations with documented sources.
- [ ] Test dataset referential integrity: every feature/component/test/finding/evidence relationship ID resolves, all counts reconcile, timestamps and revisions are present.

### Task 2: Add ADMIN-only story route and entry points

**Files:** modify `App.tsx`, `Layout.tsx`, `strings/en.ts`, `strings/hi.ts`; modify Evidence Center entry point; route/UI tests.

- [ ] Add lazy `/admin/project-story` route inside `RequireRole` for `ADMIN`.
- [ ] Add localized nav item and Evidence Center link.
- [ ] Test ADMIN access, non-admin denial, and direct link navigation.

### Task 3: Build chapters and overview drill-downs

**Files:** create `ProjectStory.tsx`, extend `ProjectStory.test.tsx`.

- [ ] Render seven chapters with accessible chapter navigation and persistent URL selection.
- [ ] Use the dossier's problem summary, implemented feature states, verified milestones, latest test state, open finding, limitations, and recent sourced activity.
- [ ] Make overview metrics/features/milestones navigate to the right chapter/detail.
- [ ] Test chapter navigation, URL state, correct evidence links, and empty-data labels.

### Task 4: Build architecture explorer and findings dashboard

**Files:** `ProjectStory.tsx`, `ProjectStory.test.tsx`.

- [ ] Render architecture component selector plus textual detail for role, dependencies, APIs/models, tests, evidence, status, and limitations.
- [ ] Add real search and combined suite/category/severity/status/component filters over dossier records.
- [ ] Add keyboard-operable finding selection and a detail panel with actual failure text and source/workflow links.
- [ ] Test selection, combined filters, no-result state, deep links, and invalid identifiers.

### Task 5: Integrate Evidence Center and polish responsive behavior

**Files:** story page, Evidence Center page/tests, focused styles if needed.

- [ ] Add navigation among feature, suite, finding, evidence source, and existing Evidence Center section only where a real relationship exists.
- [ ] Ensure synthetic model metrics and benchmark results retain provenance labels and caveats.
- [ ] Verify keyboard focus, visible labels, responsive layout, text alternatives, and no inactive controls.

### Task 6: Verify implementation and update dossier

- [ ] Run focused tests, all web tests, web typecheck/build, API typecheck/build, chart tests, and formcheck tests as applicable.
- [ ] Run API integration tests only with a disposable database; document if environment prevents it.
- [ ] Browser-check story chapters, filters, evidence navigation, ADMIN guard, and desktop/tablet/mobile widths.
- [ ] Update the dossier only with test results actually obtained for the implementation commit; do not change the historical merged-main result.

## Execution Notes

The user explicitly requested implementation, verification, and an in-app reviewer experience; implement natively in this isolated worktree and retain an auditable branch/patch. Do not push directly to `main` or change production settings.
