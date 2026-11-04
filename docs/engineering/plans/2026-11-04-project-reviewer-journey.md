# Project Reviewer Journey

> Historical implementation brief. The separate Evidence Center UI described below was removed in Stage 1; the `/api/evidence/*` endpoints and verification artifacts remain. The Project Story page remains at `/admin/project-story`.

## Purpose

Add an authenticated, in-app technical review path that explains SIH26262 from its problem context through the current implementation, test evidence, known gaps, and project history. It supplements the existing role-specific workspaces.

## Product shape

One reviewer journey page at `/admin/project-story`, linked from the ADMIN navigation. Eight chapters are reachable by keyboard-accessible chapter navigation: Project overview, Problem, Solution, System, Built, Test findings, Remaining work, and Progress. The architecture explorer, test/finding filters, and evidence links are sections in that journey rather than separate analytics pages.

The architecture explorer has a selectable component list and a textual detail panel. The findings section supports search and filters over the actual available suite/finding records, with a detail view for the current merged-main failure. The evidence section links to available API references and source files. URL hash/query state preserves the selected chapter and selected component/finding for direct links.

## Data and provenance

Use a typed, version-controlled project review dataset because the current schema has no test-run/finding entities and CI does not persist them to the API. Every observation carries a source, revision, observed time, and provenance (`MEASURED`, `DERIVED`, `SYNTHETIC`, or `DOCUMENTED`). Do not add a database migration or treat local `test-results.json` as CI evidence.

The latest available merged-main CI snapshot is commit `b931f21` / workflow run `41791850558`: API integration tests 241 passed and 1 failed; form-check tests 99 passed; frontend tests/build, typechecks, and chart script tests passed. The single failure is `api/test/assignment.test.ts`, test `[21]`: it expected an `over capacity (1.xx)` exclusion, while the assignment explanation returned a different eligible candidate and did not include that exclusion. Keep this finding open until a later execution verifies resolution. The earlier PR #14 run is historical evidence only (API 242/0; form-check 99/0; web 237/0); do not merge it into the latest snapshot.

Synthetic model metrics and benchmark measurements remain explicitly synthetic/benchmark evidence with their existing caveats. Test coverage gaps, absent CI-to-app synchronization, absence of end-to-end browser automation, missing lint configuration, and unverified production-hardening phases are documented as gaps, not passing tests.

The repository contains the problem ID/title and project documentation but not the complete official statement text. The story must label its short problem framing as a summary and link the project documentation; it must not present invented impact measurements or claim the full statement is reproduced.

## Interaction and accessibility

- Chapter navigation updates the selected chapter and supports keyboard operation.
- Overview metrics and feature rows navigate to the corresponding chapter/detail.
- Search and filters update the visible records.
- Selecting a component or finding updates an adjacent detail panel and URL state.
- Evidence references open the corresponding repository source or verification API documentation.
- All status visualizations have a text equivalent; color is never the only state cue.
- Existing role guard remains ADMIN-only.
- Layout follows the app shell, existing type scale, spacing, and reusable UI components; it adapts to narrow, tablet, and desktop widths.

## Architecture

The frontend consumes a typed static dossier under `web/src/data` and uses existing React Router/auth/layout patterns. This keeps historical evidence deterministic and avoids a new persistence model. The page points to repository artifacts and retained verification API data where applicable. A short data contract records source URLs/paths, revision, timestamps, and limitations; any later CI ingestion can replace the snapshot without changing the page's interaction model.

## Acceptance

1. `/admin/project-story` is ADMIN-protected and discoverable from the existing navigation.
2. Eight chapters render real project context and source-backed claims.
3. Architecture selection exposes purpose, dependencies, interfaces, tests, evidence, status, and limitations in text.
4. Findings filters/search operate on the dossier records; the latest CI failure opens with its expected/actual evidence and source.
5. Evidence links resolve to the verification API documentation or source artifact.
6. Current and historical results are distinct, timestamped, and labeled with provenance; missing history is stated plainly.
7. Existing role-specific dashboards remain available; verification endpoints are independent of this page.
8. Unit/UI tests cover navigation, filters, source links, role guard, and URL state; requested typecheck, tests, build, CI, and browser review are run where the environment permits.
