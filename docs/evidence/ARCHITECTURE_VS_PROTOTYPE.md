# Architecture versus prototype

Formerly `demo-production/FEATURE_INVENTORY.md`, moved here so it can be found.

What the full design contains, what this repository builds, and how each built feature is checked. Re-sourced on 2026-11-03 at commit `c40339c` on branch `claude/new-session-35imia`; the measured baseline comes from [`INITIAL_AUDIT.md`](INITIAL_AUDIT.md) and is listed below. All data in the prototype, the form check and the benchmarks is synthetic.

## What is built, and the scope that was chosen

The submission describes a nine-phase design (phases 0 to 8). This repository builds phases 0 to 4, the yearly rule packs and the government-style public interface, which is about 40% of the full design, counted by scope (phases 0 to 4 plus the rule-pack and interface add-ons) rather than by line count. That is deliberate scope: the core of an approval platform (who holds a case, the clocks, the audit trail and the rules that govern it) was built and tested before anything that needs production infrastructure.

| Phase | Contents (phases 5 to 8 as listed in the submission abstract) | In this repository |
|---|---|---|
| 0 Foundation | Schema, roles, authentication, audit chain | Built, tested |
| 1 Workflow and assignment | Case lifecycle, transition table, explained automatic assignment | Built, tested |
| 2 Deadline engine and scheduler | One clock engine, reminders, escalation, leader-elected schedulers | Built, tested |
| 3 Action Center and dashboards | Ordered work lists with reasons, team roll-ups, workforce views | Built, tested |
| 4 Post-approval and form check | Undertakings, evidence, document expiry, advisory form check | Built, tested |
| Add-on: yearly rule packs | Versioned rules, maker-checker, diff, impact preview, publish | Built, tested |
| Add-on: government-style interface | Public portal shell, English and Hindi, accessibility controls | Built; screens recorded, no automated UI test (see below) |
| 5 | Rebalancing suggestions with approval, committee expertise and independence rules, delegation grants, conflict-of-interest editor, case locks | Not built |
| 6 | Versioned assignment policies and model governance, letter templates, case summary PDFs, CSV and PDF reports | Not built |
| 7 | Offline OCR cross-check of uploaded documents against form values | Not built |
| 8 | Production hardening: PgBouncer, read replica, audit partitions, stateless replicas, backups with point-in-time recovery, monitoring, two-factor sign-in, AICTE single sign-on, encryption at rest, virus scanning, row-level security, SMS and e-mail gateways, full Hindi and regional languages, security and accessibility audits, DPDP Act review, AICTE portal adapter | Not built. Nothing here is production-ready. |

Also absent, and stated so that nothing below is read as covering it: there is no lint configuration (CI exists since this pack: `.github/workflows/ci.yml` runs typecheck, both test suites and the web build, and has not yet been observed running on GitHub), no Evidence Center screen, no persisted scheduler run history, and no external notification channel (e-mail or SMS), so there is no external delivery to be exactly-once or otherwise.

### How to read the Status column

Measured baseline on this branch, run by the controller: 183 API tests pass (Vitest, against a real PostgreSQL 16.15), 99 form-check tests pass (pytest), `tsc --noEmit` is clean, `tsc -b && vite build` is clean, and `python3 -m training.evaluate` regenerates `formcheck/EVALUATION.md` byte-identically.

* **Tested** means a named test in those suites exercises the behaviour end to end and passes in that baseline.
* **Recorded demo** means the Playwright demo script (`demo-production/automation/record.mjs`) and the screenshots in `docs/screens/` show it, but no automated assertion checks it and the script was not re-run for the baseline. [`INITIAL_AUDIT.md`](INITIAL_AUDIT.md) classes the screens as implemented but not verified: no automated UI test or accessibility assertion runs in this repository.
* A demo step number such as "demo 11" refers to a step of that recorded script.

## Architecture

| Layer | What it is |
|---|---|
| Web | React 18 + Vite + TypeScript, Tailwind with CSS-variable tokens, TanStack Query. Public portal shell (utility bar, header, navigation, notice strip, footer) and a signed-in work shell with a left sidebar. English and Hindi, text size A- to A++, high contrast. |
| API | Node 22, Express 4, zod validation, Prisma 5 on PostgreSQL 16. 72 route handlers in 17 route files (counted by grep, so approximate). JWT bearer auth, rate limits, helmet. Every case change runs `performAction` in one database transaction with an audit row. |
| Scheduler | Two Node processes; the PostgreSQL advisory-lock holder is the leader and runs the deadline engine every minute (reminders, at-risk, overdue, escalation, flags, digests, scheduled rule publication). `AlertLog`'s unique key makes the decision to alert exactly-once per item and level; alerts are in-app notifications only. Per-cycle counters are not persisted. |
| Form check | Python FastAPI service: rules sent by the API plus an Isolation Forest trained on synthetic forms. The API falls back to the same rules in Node when the service is down (800 ms timeout). Advisory only; it never blocks filing. |
| Rules | Yearly rule packs (cycles, versions, amendments) stored in PostgreSQL with an immutability trigger; every consumer reads them through `api/src/rules/service.ts`. Pinning is partial by design: substantive rules (application types and eligibility, documents, fees, norms, programmes, form-check rules, letters, change notice) stay pinned to the version a case was filed under; operational rules (schedule, reminders, escalation, assignment, committees, calendar) follow the cycle's current published version (`mergeSections` in `api/src/rules/resolved.ts`). A published amendment can also move open cases, subject to its apply scope. |
| Audit | `AuditLog` with per-chain SHA-256 hashes (per application, `global`, `rules`). The application role cannot UPDATE or DELETE audit rows, and any edit that does not recompute the whole forward chain is detected. The table owner can disable the trigger, so this is not tamper-proof against a privileged database administrator. |
| Data | Synthetic seed, measured on the freshly seeded database: 2 regions, 207 users (of which 20 have documented demo logins), 120 institutions, 191 applications built through the real actions on a back-dated clock (the count varies between 191 and 192 between setups; see Known issues), 4 rule pack versions. Reproduce each count with `SELECT count(*) FROM "Region"` (and likewise `"User"`, `"Institution"`, `"Application"`, `"RulePackVersion"`), for example `psql "$DATABASE_URL" -c 'SELECT count(*) FROM "User"' -c 'SELECT count(*) FROM "Institution"'`. `npm run demo:reset` restores it in under a second from a template database. |

## Roles (demo accounts, password `demo1234`, synthetic data only)

COLLEGE (`college.abc@demo.in`), OFFICER (`priya@`, `arjun@`, `meena@`, `ravi@` with the EVC desk skill, `officer.west@`), SENIOR (`kumar@`), SUPER_SENIOR (`lakshmi@`), HOD (`hod.south@`), BUREAU (`bureau.head@`), COMMITTEE (`committee1@`…`6@`), AUTHORITY (`authority.south@`), ADMIN (`admin@`), RULE_EDITOR (`rules.editor@`), RULE_APPROVER (`rules.approver@`).

## Features

| # | Feature | Route | Role | Prerequisites | Test steps | Observable success | Status |
|---|---|---|---|---|---|---|---|
| 1 | Public home: cycle schedule, recent changes, quick links, sign in | `/` | anyone | API up | Open `/`; sign in as any demo user | Schedule table and 3 notices visible; redirect to the role home | Recorded demo |
| 2 | Accessibility controls: A-/A/A+/A++, high contrast, English/हिंदी, skip link | every page | anyone | none | Press each control; reload | Root size changes; light high-contrast theme; Hindi labels; choice survives reload | Recorded demo. Not verified by automation: no accessibility assertion runs in this repository, and the earlier axe-core sweep claim has no committed script, so it is withdrawn |
| 3 | What changed this cycle (public notices + schedule) | `/notices`, `/college/notices` | anyone | rule packs seeded | Open page | Amendment cards (kind, ref, dates, summary, affected types) and schedule | Tested (`rules-api.test.ts`, notices and schedule served without login); page recorded demo 11.4 |
| 4 | Track an application | `/track` | anyone | application no + permanent ID | Enter both, Find | Stage, status, route, rules version; wrong pair → "No application matches" | Tested (`public-track.test.ts`) |
| 5 | Approval process, help, contact, policies, sitemap | `/process`, `/help`, … | anyone | none | Open pages | Content from current rules; "Prototype text" badge | Recorded demo |
| 6 | New application with filing context | `/college/apply` | COLLEGE | open application window | Fill the 5 steps | Header "Filing under approval cycle 2027–28 · rules v1"; checklist from the rules version the case is filed under | Tested (`rules-consumers.test.ts`: apply form header and pinned filing); screen recorded demo 1 |
| 7 | "Check my entries" form check | `/college/apply` | COLLEGE | — | Built-up > land | R1 HIGH warning; justification required; never blocks | Tested (`formcheck.test.ts`: built-up larger than plot, justification); screen recorded demo 1 |
| 8 | Hard validation: missing critical document blocks submit | `/college/apply` | COLLEGE | — | Omit land lease | Submit disabled, message names the document | Tested (`workflow.test.ts`: blocks submission without critical documents); screen recorded demo 1 |
| 9 | Purview / eligibility / schedule refusal | API on submit | COLLEGE | — | BBA at a non-technical college; file outside a window | Plain refusal naming the rule or the next window | Tested (`rules-consumers.test.ts`: purview and no-open-window refusals) |
| 10 | Automatic assignment with reasons | case view | OFFICER | new case | Open the case | "Assigned to Priya Raman … portfolio officer …; utilisation …; Rules 2027-28 v1" | Tested (`assignment.test.ts`: lowest score, exclusions listed). The full eligible-versus-excluded breakdown is not shown on any screen |
| 11 | Scrutiny: complete, return with deficiencies, reply, re-scrutiny | `/cases/:id`, `/college/applications/:id` | OFFICER, COLLEGE | assigned case | Return with items; college replies | Clock pauses (amber), resumes with remaining days to the same officer | Tested (`workflow.test.ts`: RETURN then REPLY, remaining days) |
| 12 | Action Center with reasons and fixed order | `/officer` | OFFICER, BUREAU | seeded flags | Open | Rows ordered by escalation, overdue, category, due, filing; each row says why and what next | Tested (`actionCenter.test.ts`) |
| 13 | Deadline engine: reminders, at-risk, overdue, escalation (L1–L3), digests | background | scheduler | schedulers running | Admin advances time | Escalation to the manager once per level; each reminder offset fires once (the decision to alert is exactly-once; delivery is in-app only) | Tested (`engine.test.ts`: offsets once, escalation levels 1 to 3, digest once). Catch-up after downtime has a test for missed offsets only |
| 14 | Time travel (simulated clock) | `/admin` | ADMIN | DEMO_MODE | Advance N days | Header shows "Simulated date" | Tested (`engine.test.ts`: admin advances time); header banner recorded demo 5, 7, 9 |
| 15 | Team dashboard with roll-up and drill-down | `/team` | SENIOR, SUPER_SENIOR, HOD | — | Open | Per-officer figures, ageing chart, escalated to me | Tested (roll-up and drill-down test); screen recorded demo 6 |
| 16 | Workforce: overloaded/idle, manual reassign with recommendation | `/workforce` | managers, BUREAU | — | Reassign a task | "Recommended by system" recorded | Tested (`OVERLOADED` and `IDLE`, recommendation stored on reassignment); screen recorded demo 6 |
| 17 | Availability: leave releases and reassigns open tasks | `/availability` | OFFICER, managers | — | Add leave from today | Tasks reassigned with reasons | Tested (`assignment.test.ts`: leave releases and reassigns, due dates kept) |
| 18 | EVC desk: committee proposal and scheduling | `/evc`, case view | OFFICER with skill | EVC stage | Schedule online for tomorrow | Visit scheduled; appointing authority recorded | Stage transitions tested (`workflow.test.ts`); the EVC desk screen is recorded demo 7 only |
| 19 | Committee report and SAC/SHC recommendation | `/committee` | COMMITTEE | scheduled visit | Submit report | Case moves to DECISION | Stage transition tested (`workflow.test.ts`); the committee screen is recorded demo 7 only |
| 20 | Competent authority decision with conditions | `/authority` | AUTHORITY | DECISION stage | Approve with conditions | Undertakings created with due dates | Tested (`workflow.test.ts` decision paths, separation of duties; `compliance.test.ts` undertakings) |
| 21 | Post-approval compliance: evidence, verification, auto close | `/college/compliance`, case view | COLLEGE, OFFICER | undertakings | Upload evidence; officer verifies | Case CLOSED | Tested (`compliance.test.ts`: reminder, overdue, escalation, evidence, verify, CLOSED) |
| 22 | Document expiry and renewal | `/college/compliance` | COLLEGE, OFFICER | expiring doc | Upload renewal; verify | Expiry item replaced | Tested (`compliance.test.ts`: verified renewal replaces the expiry item) |
| 23 | Notifications bell | header | all signed-in | events | Open bell | Unread count, mark read, jump to case | Notifications written in the same transaction: tested (`engine.test.ts`); the bell screen is recorded demo only |
| 24 | Rules Center: cycles and versions | `/rules` | RULE_EDITOR, RULE_APPROVER, ADMIN, HOD, BUREAU | seed | Open | Cycles, versions, maker, checker, the cases filed under each version | Tested through the API (`rules-api.test.ts`); page recorded demo 11 |
| 25 | Draft an amendment, section editors, condition builder, JSON tab | `/rules/versions/:id` | RULE_EDITOR | published version | Add a document, extend a window, save | Changed counts per section; errors shown inline | Server-side validation tested (`rules-a11.test.ts`: depth, size, unknown variable refused); editors recorded demo 11.1 |
| 26 | Apply scope enforcement (live vs new cases) | version page | RULE_EDITOR | changes | Mark a tightening change live, submit | Refused: "…can only apply to new cases." | Tested (`rules-a11.test.ts`: refusal of a live change that flips an open case; `rules-api.test.ts`: tightening marked live refused) |
| 27 | Diff with relaxing/tightening/neutral classification | `/rules/versions/:id/diff` | staff | draft | Open | Labelled changes with before/after and source | Tested (`rules-api.test.ts`: purview widening is relaxing, narrowing is tightening); screenshots in `docs/screens/` |
| 28 | Impact preview (dry run) | `…/impact` | staff | draft | Open | Sentences: cases moving, newly missing documents, form check counts, who can file | Tested (`rules-a11.test.ts`: impact preview changes R4); page recorded demo 11.2 |
| 29 | Maker-checker review, approve, reject, publish, schedule | `…/review` | RULE_APPROVER | in review | Approve, publish | Published; approver cannot approve own edits | Tested (`rules-api.test.ts`, `rules-a11.test.ts`: one audit row per action, one PUBLISHED version under concurrent publishes) |
| 30 | Partial pinning and live rebase | case view | — | live relaxing change | Publish SLA extension marked live | Substantive rules stay on the version the case was filed under; operational rules follow the cycle's current published version; a live relaxing amendment moves open cases to the new version, due dates later only | Tested (`rules-api.test.ts`: live relaxing SLA change rebases open cases and moves due dates later) |
| 31 | College "changes since your last visit" banner | `/college` | COLLEGE | new publish | Sign in | "1 change to the 2027–28 rules since your last visit · View" | Tested (`rules-a11.test.ts`, demo step 11). This test failed on any date from 2026-11-03 until the seed fix in `api/prisma/seed/rulepacks.ts`; it passes now. Banner screen recorded demo 11.4 |
| 32 | Rollback, export, import | version page | RULE_EDITOR | versions | Roll back to v1 | New draft with v1 content | Tested (`rules-a11.test.ts`: rollback; `rules-api.test.ts`: export and import) |
| 33 | Audit log, filters, Verify integrity, tamper detection (application role cannot edit; any edit that does not recompute the forward chain is detected) | `/admin` | ADMIN | — | Verify; run `demo:tamper`; verify | OK, then "Broken: row N in chain …" | Tested (`audit.test.ts`: chains verify, app role and table owner both refused, `demo:tamper` names the broken row). See the audit caveat in the Architecture table |
| 34 | Access control: scope and ACCESS_DENIED logging | any case URL | wrong-region officer | — | Open a West case as a South officer | No access page; audit row | Tested (`matrix.test.ts` and `workflow.test.ts`: 403 plus `ACCESS_DENIED` row, scope) |
| 35 | Scheduler leader election and failover | background | — | 2 schedulers | Stop the leader | Standby takes over, no alert repeats | Tested (`scheduler.test.ts`: leader only, hand-over) |
| 36 | Demo reset | `/admin`, `npm run demo:reset` | ADMIN | DEMO_MODE | Reset | Seed restored in under 1 s | Tested (`reset.test.ts`) |
| 37 | Style guide (both themes, languages, text sizes) | `/styleguide` | ADMIN | — | Open | Components in standard and contrast | Screenshot only; no automated check |

## Partial, mocked or planned

| Item | State |
|---|---|
| Statistical model in the form check | Real Isolation Forest, trained and evaluated on synthetic data only (`formcheck/EVALUATION.md`). Hybrid result on the synthetic test set: precision 0.975, recall 0.863, false-alarm rate 2.2%, regenerated byte-identically by `python3 -m training.evaluate` (no train and test overlap was found). Locally the Python service is often not running, and the app then shows "Model unavailable: rules only". Whether the in-app panel carries a synthetic-data caveat was not verified in the audit. |
| Uploaded documents | Real uploads stored on disk; seed documents are generated placeholder PDFs. |
| Fees | Shown only; no payment is taken. |
| Email and SMS | Not built. Only in-app notifications exist, so there is no external delivery to qualify. The decision to alert is exactly-once per item and level (`AlertLog` unique key); that is a different guarantee from delivery. |
| Hindi | Shell, navigation, public pages, notices, sign in, Rules Center labels, roles and status badges. Work-screen bodies stay English. |
| Rule values | Every value in the seeded packs is a placeholder or "modelled on" public reports, not verified against the official handbook. |
| Phases 5 to 8 | Not built; see the phase table above. |
| Docker compose stack | Defined, but never exercised: the audit ran the services natively (a PostgreSQL service, `tsx` API, Vite dev server, schedulers via npm scripts). |
| Hosted mode (Vercel and Neon) | Implemented per earlier sessions; not tested in the 2026-11-03 audit, which made no network calls to the live site. |
| CI, lint | CI added with this pack (`.github/workflows/ci.yml`: typecheck, API tests, form-check tests, web build, chart tests; first GitHub run not yet observed). Lint is absent: no ESLint, Prettier or Ruff configuration, so `tsc --noEmit` and `tsc -b` are the only static gates. |
| Scheduler run history, decision trace, Evidence Center screen | Not built. |

## Known issues

- Fixed on 2026-11-03: the seed stamped each user's `noticesSeenAt` with wall-clock time while rule-pack `publishedAt` comes from the simulated clock. From 2026-11-03 onward a newly published amendment therefore counted as already seen and colleges stopped seeing new change notices. The seed now anchors `noticesSeenAt` to the newest seeded `publishedAt` (`api/prisma/seed/rulepacks.ts`). The API suite went from 182 passed and 1 failed to 183 passed and 0 failed (`INITIAL_AUDIT.md`).
- The demo seed's application count has varied between 191 and 192 between setups: the assignment tie-break compares random UUIDs. It is harmless and predates the add-on.
- "Track application" had no automated test; `api/test/public-track.test.ts` now covers it (both numbers required, same message for either wrong value).
