# Design comparison

Six design properties of this prototype, each tied to the file that implements it, and what a generic tool would have to add to match it. This page argues from the design only. It makes no claim about what any particular existing product does or does not do; where a kind of tool appears, it is a category ("a generic workflow or ticketing engine", "a hard-coded rules implementation"), and the reader can judge the gap against whatever they use. All data in the prototype is synthetic.

Tests named below are in the API suite (Vitest, a real PostgreSQL 16.15): 183 tests when this page was written on 3 November 2026, 241 at the audited commit on 4 November; see [`ARCHITECTURE_VS_PROTOTYPE.md`](ARCHITECTURE_VS_PROTOTYPE.md) for the baseline and the per-feature status.

## 1. A filed case keeps its substantive rules when the handbook changes mid-cycle

**What it proves:** a document added to the rules after a college has filed does not invalidate that college's case, because the case stores the rule version it was filed under.

Source: `Application.rulePackVersionId` (`api/prisma/schema.prisma`) is written at filing by `api/src/rules/filing.ts`. Reads go through `api/src/rules/service.ts`.

Caveats:
- Pinning is partial by design. Substantive rules (programmes, application types and eligibility, documents, norms, form-check rules, timelines, fees, letters) stay pinned to the version the case was filed under, so stage deadlines are computed from the filed version's timelines. Operational rules (schedule, reminders, escalation, assignment, committees, calendar) follow the cycle's current published version. The line between the two is declared as `PINNED_SECTIONS` and `OPERATIONAL_SECTIONS` in `api/src/rules/schema.ts:14-15` and enforced by `mergeSections` in `api/src/rules/resolved.ts`.
- The split is a judgement: what a college must supply should not change under it, while who gets reminded and when should follow the current handbook. Whether AICTE draws the line in the same place is for AICTE to confirm.
- Open cases can additionally be moved onto a new version by a provably relaxing amendment (`rebaseAfterPublish`, within its `applyScope`); see property 2.
- Tested: `rules-api.test.ts` (a new critical document applies to new filings only; "filed cases stay pinned"; a live relaxing SLA change rebases open cases) and `rules-a11.test.ts` ("a new-cases-only document leaves filed cases pinned").

A generic workflow or ticketing engine would need a rule store with immutable versions, a per-case version reference, and an explicit decision about which settings are pinned and which are live.

## 2. Only provably relaxing changes reach live cases

**What it proves:** an amendment can move cases already in progress only when the system can show that it relaxes the rules; anything that could tighten them is refused for live cases and applies to new filings only.

Source: the `applyScope` field on an amendment (`api/src/rules/versions.ts`), the classification in `api/src/rules/diff.ts`, and `rebaseAfterPublish` in `api/src/rules/rebase.ts`.

Caveats:
- "Relaxing" is a closed list: a later date, a longer period, a document made optional or removed, a norm moved in its relaxing direction, a purview or eligibility condition that only widens. Anything else marked live is refused with the path and the reason.
- Moved cases get later due dates, never earlier, one transaction each, with an audit row and a notification.
- Tested: `rules-a11.test.ts` (a live change that flips an open case is refused) and `rules-api.test.ts` (tightening marked live is refused).

A generic engine would need a machine-readable diff of two rule versions, a classifier for direction of change, and a gate that applies it per change rather than per release.

## 3. Clocks pause while the college holds the file

**What it proves:** when an officer returns a case to the college, the stage clock stops and stores the working days remaining, and the college's reply resumes it from there.

Source: `api/src/engine/cycle.ts` (the cycle selects only items with status `OPEN`) and `pauseStageItem` / `resumeStageItem` in `api/src/workflow/deadlines.ts`.

Caveats:
- Working days skip weekends and the placeholder holiday list.
- Tested: `workflow.test.ts` (RETURN then REPLY, remaining days kept).

A generic engine with one SLA timer per ticket would need pause and resume tied to who currently holds the case, plus a working-day calendar.

## 4. The Action Center never counts the college's time against an officer

**What it proves:** a case waiting on the college is listed as the college's, with the college as owner, and does not appear as the officer's overdue work.

Source: `api/src/engine/flags.ts`. Flags owned by a college are built with the college as owner and shown under "Waiting on college" and on the college's own "What we need from you" card.

Caveats:
- The list order is fixed (escalation level, days overdue, category, days to due, filing date). There is no ranking or composite score of officers.
- Tested: `actionCenter.test.ts`.

A generic engine would need to know, for every open item, who is responsible right now, and compute per-person overdue figures from that rather than from elapsed time.

## 5. Audit is a hash chain enforced in the database

**What it proves:** the audit trail cannot be edited quietly through the application, and an edit made any other way is detectable.

Source: `api/src/lib/audit.ts` (each row stores `sha256(prevHash + canonicalJSON(row))`, chained per application, plus `global` and `rules` chains) and `api/prisma/sql/001_audit_guard.sql` (the application role has no UPDATE, DELETE or TRUNCATE on `AuditLog`, and a trigger rejects updates and deletes).

Caveats:
- The application role cannot UPDATE or DELETE audit rows, and any edit that does not recompute the whole forward chain is detected by `GET /api/admin/audit/verify`, which names the first broken row. The table owner can disable the trigger, so this is not tamper-proof against a privileged database administrator.
- Tested: `audit.test.ts` (chains verify; the application role and the table owner are both refused; `npm run demo:tamper` names the broken row).

A generic engine with an ordinary history table would need the append-only grants and trigger, a chain hash written under a per-chain lock, and a verification routine.

## 6. Every assignment carries a one-line reason

**What it proves:** when the system picks an officer, it stores in plain language why, so anyone looking at the case can see the basis.

Source: `Assignment.reasonText` (`api/prisma/schema.prisma`), composed in `api/src/assignment/engine.ts`. Example: "Assigned to Priya Raman (Officer, South): portfolio officer for ABC Engineering College; utilisation 0.15 after this task. 50 eligible; none excluded. Tier 0. Rules 2027-28 v1."

Caveats:
- The reason names the winner and counts the exclusions. The full eligible-versus-excluded breakdown is persisted in `AssignmentTrace` and viewable by ADMIN in the Evidence Center.
- Weights, capacities and thresholds are placeholders pending AICTE validation.
- Tested: `assignment.test.ts` (lowest score, exclusions listed).

A generic engine with round-robin or manual routing would need explicit eligibility filters, a stored score, and text generated at the moment of choice rather than reconstructed later.

## What this page does not claim

- That any other system lacks these properties. It does not say.
- That the prototype is production-ready. Phase 8 hardening is not built ([`FEASIBILITY.md`](FEASIBILITY.md)).
