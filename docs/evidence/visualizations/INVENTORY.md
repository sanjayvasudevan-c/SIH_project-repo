# Inventory

[← Evidence visualizations](README.md) · [Methodology](METHODOLOGY.md)

Every visualization in the evaluator-facing package, the file that holds it and the data it is drawn from. Paths are relative to this folder. Each file exists; `npm run evidence:links` fails if a link here stops resolving.

## Charts (SVG, generated)

| Category | Chart | File | Source data |
|---|---|---|---|
| Benchmarks | Read latency per screen (p50, p95, p99) | [read-latency.svg](benchmarks/read-latency.svg) | newest `benchmark-results/*.json` |
| Benchmarks | p95 latency, two runs side by side (only if machine blocks match) | [read-p95-runs.svg](benchmarks/read-p95-runs.svg) | two `benchmark-results/*.json` |
| Benchmarks | Engine first vs second cycle duration | [engine-cycle-duration.svg](benchmarks/engine-cycle-duration.svg) | all `benchmark-results/*.json` |
| Benchmarks | New alerts per cycle | [engine-cycle-alerts.svg](benchmarks/engine-cycle-alerts.svg) | all `benchmark-results/*.json` |
| Benchmarks | Duplicate alert prevention | [duplicate-prevention.svg](benchmarks/duplicate-prevention.svg) | runs that measured `alertsSuppressed` |
| Benchmarks | Dataset scale | [dataset-scale.svg](benchmarks/dataset-scale.svg) | newest `benchmark-results/*.json` |
| Benchmarks | Throughput and errors | [throughput-errors.svg](benchmarks/throughput-errors.svg) | newest `benchmark-results/*.json` |
| Workflow | Stage funnel | [stage-funnel.svg](workflow/stage-funnel.svg) | `data/workflow.json` |
| Workflow | Status distribution | [status-distribution.svg](workflow/status-distribution.svg) | `data/workflow.json` |
| Workflow | Submitted, decided, overdue over time | [volume-over-time.svg](workflow/volume-over-time.svg) | `data/workflow.json` |
| Workflow | Median working days to decision | [processing-time.svg](workflow/processing-time.svg) | `data/workflow.json` |
| Workflow | Stage and status transitions | [stage-transitions.svg](workflow/stage-transitions.svg) | `data/workflow.json` |
| Assignment | Utilisation by officer, with cap | [utilisation-by-officer.svg](assignment/utilisation-by-officer.svg) | `data/assignment.json` |
| Assignment | Utilisation distribution | [utilisation-distribution.svg](assignment/utilisation-distribution.svg) | `data/assignment.json` |
| Assignment | Decisions by outcome | [decisions-by-outcome.svg](assignment/decisions-by-outcome.svg) | `data/assignment.json` |
| Assignment | Candidates considered, eligible, excluded | [candidates.svg](assignment/candidates.svg) | `data/assignment.json` |
| Scheduler and compliance | Open deadline states and closed-out states | [deadline-states.svg](scheduler-compliance/deadline-states.svg) | `data/compliance.json` |
| Scheduler and compliance | Escalations by level | [escalations.svg](scheduler-compliance/escalations.svg) | `data/compliance.json` |
| Scheduler and compliance | Engine run duration per run | [engine-run-duration.svg](scheduler-compliance/engine-run-duration.svg) | `data/engine-runs.json` |
| Scheduler and compliance | Alerts created vs suppressed per run | [alerts-per-run.svg](scheduler-compliance/alerts-per-run.svg) | `data/engine-runs.json` |
| Scheduler and compliance | Reminder timing | [reminder-timing.svg](scheduler-compliance/reminder-timing.svg) | `data/compliance.json` |
| Alerts and audit | Alerts by kind | [alerts-by-kind.svg](alerts-audit/alerts-by-kind.svg) | `data/alerts.json` |
| Alerts and audit | Alerts per day | [alerts-per-day.svg](alerts-audit/alerts-per-day.svg) | `data/alerts.json` |
| Alerts and audit | Audit events by action | [audit-by-action.svg](alerts-audit/audit-by-action.svg) | `data/audit-analytics.json` |
| Alerts and audit | Audit events by actor role | [audit-by-role.svg](alerts-audit/audit-by-role.svg) | `data/audit-analytics.json` |
| Alerts and audit | Audit events by entity | [audit-by-entity.svg](alerts-audit/audit-by-entity.svg) | `data/audit-analytics.json` |
| Alerts and audit | Audit integrity card | [audit-integrity.svg](alerts-audit/audit-integrity.svg) | `data/audit-analytics.json` |
| Alerts and audit | What the alert data cannot say (acknowledgement, alert-to-close time) | [alert-handling-status.svg](alerts-audit/alert-handling-status.svg) | `data/alerts.json` |
| ML | Headline metrics | [headline-metrics.svg](ml/headline-metrics.svg) | `formcheck/metrics.json` |
| ML | Confusion matrix, derived | [confusion-matrix.svg](ml/confusion-matrix.svg) | `formcheck/metrics.json` |
| ML | Rules only vs model only vs hybrid | [baseline-modes.svg](ml/baseline-modes.svg) | `formcheck/metrics.json` |
| ML | Recall by fault type | [recall-by-fault.svg](ml/recall-by-fault.svg) | `formcheck/metrics.json` |
| ML | Methodology panel | [methodology.svg](ml/methodology.svg) | `formcheck/metrics.json` |

## Diagrams (Mermaid, drawn by GitHub)

| Diagram | Where |
|---|---|
| System architecture | [architecture/README.md](architecture/README.md#system-architecture) |
| Application workflow state machine (from code) | [architecture/README.md](architecture/README.md#application-workflow-state-machine) |
| Assignment decision flow | [architecture/README.md](architecture/README.md#assignment-decision-flow) |
| Deadline engine cycle and alert idempotency | [architecture/README.md](architecture/README.md#deadline-engine-cycle-and-alert-idempotency) |
| Evidence generation pipeline | [architecture/README.md](architecture/README.md#evidence-generation-pipeline) |
| Case lifecycle, assignment decision, escalation ladder, rule-pack publish | [../WORKFLOW.md](../WORKFLOW.md) (four earlier diagrams, linked, not repeated) |

## Worked example

[assignment/WORKED_EXAMPLE.md](assignment/WORKED_EXAMPLE.md): a stored assigned decision, a stored blocked decision and the stored explanation for the officer above the cap, each with its candidate table and reason text verbatim.

## Earlier charts, now regenerated here

Five SVGs used to live in `docs/evidence/charts/`. They were drawn with `currentColor`, which renders black on GitHub's dark theme, so they are replaced by charts from this pipeline with explicit colours:

| Earlier file | Now |
|---|---|
| `read-latency.svg` (p95 only) | [benchmarks/read-latency.svg](benchmarks/read-latency.svg) (p50, p95, p99) |
| `engine-cycle.svg` | [benchmarks/engine-cycle-alerts.svg](benchmarks/engine-cycle-alerts.svg) and [benchmarks/engine-cycle-duration.svg](benchmarks/engine-cycle-duration.svg) |
| `dataset-scale.svg` | [benchmarks/dataset-scale.svg](benchmarks/dataset-scale.svg) |
| `duplicate-prevention.svg` | [benchmarks/duplicate-prevention.svg](benchmarks/duplicate-prevention.svg) |
| `formcheck-modes.svg` (recall only) | [ml/baseline-modes.svg](ml/baseline-modes.svg) (precision, recall, false alarm) |
