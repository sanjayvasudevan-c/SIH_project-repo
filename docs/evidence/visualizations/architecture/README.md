# Architecture diagrams

[← Evidence visualizations](../README.md) · [Methodology](../METHODOLOGY.md)

Five diagrams, drawn by GitHub from the Mermaid below. Each one is derived from the code it cites, not from how such systems are usually built, and each lists what it leaves out. The existing [workflow diagrams](../../WORKFLOW.md) (case lifecycle, assignment decision, escalation ladder, rule-pack publish) are linked rather than repeated.

## System architecture

**Source:** [`docker-compose.yml`](../../../../docker-compose.yml), [`api/src/app.ts`](../../../../api/src/app.ts), [`api/src/scheduler.ts`](../../../../api/src/scheduler.ts), [`formcheck/app/main.py`](../../../../formcheck/app/main.py), and the hosted-variant table in the [root README](../../../../README.md#live-demo-vercel--neon).

```mermaid
flowchart LR
  U(["Browser: college, officer,<br/>senior, authority, admin"]) --> W["Web app<br/>React + Vite"]
  W -->|"HTTPS, token auth"| A["API<br/>Express + Prisma"]
  A -->|"SQL, app role"| D[("PostgreSQL 16<br/>cases, deadlines, alerts,<br/>hash-chained audit log")]
  A -->|"score request,<br/>800 ms timeout"| F["Form-check service<br/>Python: rules + anomaly model"]
  S1["Scheduler replica 1"] -->|"advisory lock:<br/>leader runs the engine"| D
  S2["Scheduler replica 2<br/>(standby)"] -.->|"retries the lock"| D
  S1 --> E["Deadline engine cycle"]
  E --> D
```

Leaves out: the rule-pack versioning flow, file storage and the Hindi/English interface layer. In the hosted variant the API is one serverless function and the engine runs after requests and from a daily cron instead of two scheduler processes. There is no external alert delivery channel in this build.

## Application workflow state machine

**Source:** the `TRANSITIONS` table in [`api/src/workflow/transitions.ts`](../../../../api/src/workflow/transitions.ts) (actions, roles, from-states), the handlers in [`api/src/workflow/actions.ts`](../../../../api/src/workflow/actions.ts) (what each action writes), and the stage and status enums in [`api/prisma/schema.prisma`](../../../../api/prisma/schema.prisma). Per-case permission checks are in `api/src/policy/can.ts`.

```mermaid
stateDiagram-v2
  [*] --> SCRUTINY : SUBMIT (college)
  [*] --> EVC : SUBMIT on a route that starts at EVC
  state "SCRUTINY / IN_STAGE" as SCRUTINY
  state "SCRUTINY / RETURNED (held by college)" as RETURNED
  state "EVC / IN_STAGE" as EVC
  state "SAC_SHC / IN_STAGE" as SAC
  state "DECISION / IN_STAGE" as DECISION
  state "APPROVED" as APPROVED
  state "APPROVED_WITH_CONDITIONS" as CONDITIONS
  state "REJECTED" as REJECTED
  state "CLOSED" as CLOSED

  SCRUTINY --> RETURNED : RETURN (officer, bureau)
  RETURNED --> SCRUTINY : REPLY (college)
  SCRUTINY --> EVC : COMPLETE_STAGE (officer, bureau)
  SCRUTINY --> DECISION : COMPLETE_STAGE when the route has no EVC
  EVC --> EVC : SCHEDULE_EVC (officer, bureau)
  EVC --> SAC : SUBMIT_EVC_REPORT (committee)
  EVC --> DECISION : SUBMIT_EVC_REPORT when the route has no SAC_SHC
  SAC --> SAC : FORWARD_SAC_SHC (bureau)
  SAC --> DECISION : SUBMIT_RECOMMENDATION (committee)
  EVC --> SCRUTINY : REVERT (officer, senior)
  SAC --> SCRUTINY : REVERT (officer, senior)
  DECISION --> APPROVED : DECIDE (authority)
  DECISION --> CONDITIONS : DECIDE with conditions
  DECISION --> REJECTED : DECIDE (authority)
  CONDITIONS --> CLOSED : last undertaking verified
  APPROVED --> [*]
  REJECTED --> [*]
  CLOSED --> [*]
```

Reading notes:
- Stage order is the case's stored `route`, resolved from the rule pack when the case is filed. `COMPLETE_STAGE`, `SUBMIT_EVC_REPORT` and `SUBMIT_RECOMMENDATION` move to the next stage on that route, so a route need not include every stage; the diagram draws the two shortcuts the recorded data actually shows ([transition counts](../workflow/README.md#recorded-stage-and-status-changes-by-action)).
- `SCHEDULE_EVC` and `FORWARD_SAC_SHC` do not change stage: they change who holds the case (the committee) within the stage.
- `CLOSED` is reached from an approval with conditions when every undertaking is verified (`actions.ts`, the verification handler).
- Only `DECIDE` approves or rejects, and only for the authority role.

## Assignment decision flow

**Source:** [`api/src/assignment/engine.ts`](../../../../api/src/assignment/engine.ts): `selectOfficer` (tier loop, continuity preference, score), `filterCandidates` (exclusions), `byScore` (tie-break) and `assign` (the blocked branch). A worked example with real stored decisions: [`WORKED_EXAMPLE.md`](../assignment/WORKED_EXAMPLE.md).

```mermaid
flowchart TD
  T(["A stage needs an officer"]) --> L["Take the region lock<br/>(Bureau lock too when a Bureau tier exists)"]
  L --> TIER["Next tier, starting at tier 0"]
  TIER --> LOAD["Load that tier's candidates<br/>with live load from open assignments"]
  LOAD --> FILT["Filter each candidate, in this order:<br/>unavailable, barred for this institution,<br/>recused, over capacity"]
  FILT --> CONT{"Is there a preferred officer who still passes<br/>at the continuity cap?<br/>(returning officer, or portfolio officer)"}
  CONT -->|yes| ASSIGN["Assign the preferred officer"]
  CONT -->|no| ANY{"Did anyone pass the filters?"}
  ANY -->|yes| SCORE["Assign the lowest load score<br/>ties: longest since last assignment, then id"]
  ANY -->|no| MORE{"Another tier?<br/>(Bureau overflow)"}
  MORE -->|yes| TIER
  MORE -->|no| BLOCKED["BLOCKED: no assignment is made.<br/>Case held by nobody, BLOCKED flag for the<br/>region head, ASSIGN_FAILED audit row,<br/>manual-assignment queue"]
  ASSIGN --> TRACE["Store the decision table:<br/>every candidate, why excluded,<br/>score, chosen, reason text"]
  SCORE --> TRACE
  BLOCKED --> TRACE
```

Leaves out: the urgent-task cap (a higher ceiling for urgent tasks), and the score weights, which come from the rule pack. A later tier assigned to a Bureau officer is recorded as `BUREAU_OVERFLOW`. Manual assignments and reassignments bypass this flow and write no decision table.

## Deadline engine cycle and alert idempotency

**Source:** [`api/src/engine/cycle.ts`](../../../../api/src/engine/cycle.ts) (`alertOnce`, the cycle and its advisory lock), [`api/src/scheduler.ts`](../../../../api/src/scheduler.ts), and the `@@unique([itemId, kind, offsetOrLevel])` constraint on `AlertLog` in [`schema.prisma`](../../../../api/prisma/schema.prisma). The [escalation ladder](../../WORKFLOW.md#3-escalation-ladder) is drawn separately.

```mermaid
flowchart TD
  TICK(["Scheduler leader, every minute<br/>(or the API after a clock change)"]) --> LOCK{"Take the cycle<br/>advisory lock?"}
  LOCK -->|no| SKIP["Another cycle is running: do nothing"]
  LOCK -->|yes| RUN["Record an EngineRun row"]
  RUN --> CHECK["For each open deadline item:<br/>reminder, at risk, overdue, escalation level"]
  CHECK --> INS["INSERT INTO AlertLog<br/>(itemId, kind, offsetOrLevel)<br/>ON CONFLICT DO NOTHING"]
  INS -->|"new row"| SEND["Count as created, notify the people concerned"]
  INS -->|"conflict: already logged"| SUP["Count as suppressed (a duplicate prevented)"]
  SEND --> FIN["Finish the EngineRun with<br/>created, suppressed, duration"]
  SUP --> FIN
  FIN --> REL["Release the lock"]
```

What it establishes: the decision to alert is made at most once per item, kind and level, enforced by a database unique key and not by the engine remembering. What it does not: delivery. There is no external channel, so "exactly once" applies to the logged decision only. The suppressed counter is what the [duplicate-prevention charts](../benchmarks/README.md#duplicate-alert-prevention-created-vs-suppressed) plot.

## Evidence generation pipeline

**Source:** [`api/scripts/snapshot-evidence.ts`](../../../../api/scripts/snapshot-evidence.ts), [`api/src/evidence-verify.ts`](../../../../api/src/evidence-verify.ts), [`scripts/evidence-visualizations.mjs`](../../../../scripts/evidence-visualizations.mjs), [`scripts/check-doc-links.mjs`](../../../../scripts/check-doc-links.mjs).

```mermaid
flowchart LR
  DB[("Demo database<br/>(seeded, simulated clock)")] --> AGG["Aggregate computation<br/>in the API code"]
  DB --> SQL["Independent raw SQL<br/>(evidence-verify)"]
  AGG --> GATE{"Every check<br/>agrees?"}
  SQL --> GATE
  GATE -->|"no: refuse to write"| STOP(["Stop with the disagreements"])
  GATE -->|yes| SNAP["data/*.json + manifest.json<br/>(responses unmodified, commit, row counts)"]
  BENCH["benchmark-results/*.json"] --> VIS
  ML["formcheck/metrics.json"] --> VIS
  SNAP --> VIS["evidence:visualize<br/>deterministic generator"]
  VIS --> OUT["SVG charts + category READMEs<br/>+ WORKED_EXAMPLE.md"]
  OUT --> LINKS["evidence:links<br/>every relative link resolves"]
  LINKS --> GH(["Read on GitHub"])
```

Leaves out: how the benchmark and the ML evaluation files are produced (`npm run load:test`, `python3 -m training.evaluate`); both are committed inputs. Regenerating with unchanged inputs gives byte-identical files.
