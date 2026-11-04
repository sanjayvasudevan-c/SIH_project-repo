# Feasibility

What it would take to run this beyond a laptop, and what is still unproven. Everything here is a plan or a target unless marked otherwise. The prototype is not production-ready: phase 8 hardening is absent.

## Licence cost

**What it proves:** the stack needs no paid software licence.

Source: the stack described in [`ARCHITECTURE_VS_PROTOTYPE.md`](ARCHITECTURE_VS_PROTOTYPE.md): Node.js, Express, React, Vite, Prisma, PostgreSQL 16, Python with scikit-learn and FastAPI. The submitted SIH abstract (held outside this repository) states the same ("fully open source, with no licence cost").

Caveats:
- This is about licences only. Hosting, operations staff and support are real costs and are not estimated here.
- No automated audit of transitive dependency licences was run.

## Rollout

Source: the SIH abstract we submitted, which is held outside this repository, so this table is the only copy a reader here can check. This is the plan we submitted, not an observed schedule.

| Stage | Months | What happens |
|---|---|---|
| MVP | 0 to 3 | Phases 0 to 4 plus rule packs and interface, which this repository builds as a prototype, taken to a usable first release alongside the existing portal |
| Single-region pilot | 4 to 9 | One region on real cases; phases 5 to 7 (rebalancing, policy governance and reports, OCR cross-check) |
| National | 10 to 18 | All regions, with phase 8 hardening done before real data is held |

Caveats:
- Nothing past the prototype has started. The prototype covers about 40% of the full design by scope, not by line count.
- The month ranges have no effort estimate behind them beyond the submission.

## Hosting

Planned: NIC or MeghRaj (per the submitted abstract). Not tested. The prototype ran natively in the audit and on Vercel with Neon for the public demo; the Docker Compose stack is defined but was not exercised in the audit ([`INITIAL_AUDIT.md`](INITIAL_AUDIT.md)).

## Security and production work that is absent

Phase 8 is not built. Specifically missing: PgBouncer, a read replica, audit partitions, backups with point-in-time recovery, monitoring, two-factor sign-in, AICTE single sign-on, encryption at rest, virus scanning, row-level security, SMS and e-mail gateways, security and accessibility audits, a DPDP Act review, and an AICTE portal adapter. There is no lint configuration. GitHub Actions has run: API typecheck and form-check jobs passed on `d898896`; web and API test jobs were cancelled, and the chart test job failed because dependencies were not installed in that job. This revision adds the missing install step; a fresh branch check is still needed. Until the production gaps and checks are addressed, the system should not hold real applicant data.

Related limits already stated elsewhere: audit is not tamper-proof against a privileged database administrator, and there is no external notification channel, so no external delivery exists to be exactly-once. The decision to alert is exactly-once (`AlertLog` unique key).

## Scale

At 15,000 applications on a single 4-core machine, the 4 November run took 131.5 s on the first deadline-engine cycle and 68.1 s on the second; the second cycle created no new alerts and recorded 6,490 duplicate attempts suppressed. Both cycles exceed the demo's one-minute schedule. Details and the command to reproduce: [`BENCHMARKS.md`](BENCHMARKS.md). One run, synthetic data, not a production benchmark.

## What needs real AICTE validation

Every rule value in the seeded packs is a placeholder.

- **The 2026-27 timelines:** scrutiny, SAC/SHC, decision, EVC scheduling, EVC report and verification periods, reminder offsets and the at-risk percentage.
- **The escalation titles and thresholds:** who is escalated to at 3, 7 and 14 days overdue, and what they are called.
- **The application windows:** the 2026-27 windows are placeholders, and the 2027-28 window is set relative to the seed date so the demo can file.
- Also unverified: routes, document lists and which documents are critical, norms, fees, committee sizes, holidays, assignment weights and capacities.

Versions 2 and 3 of 2026-27 are "modelled on" publicly reported addenda and notices. They are not copies of them.

## Impact targets

**These are pilot targets. There is no measured baseline.** The submission text states about 50% less manual follow-up and a median pendency of 60 to 40 days. Nobody has measured current follow-up effort or pendency at AICTE, and the prototype has run only on synthetic data, so neither figure is a result. A pilot would have to measure the baseline first.

The form-check figures (precision 0.975, recall 0.863, false-alarm rate 2.2%) are synthetic-data results only; recall on unit errors is 0.315. See `formcheck/EVALUATION.md`.
