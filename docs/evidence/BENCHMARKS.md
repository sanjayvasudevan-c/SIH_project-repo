# Benchmarks

Measured on 3 November 2026 at commit `565c210`. Every 3 November benchmark figure in this document is taken from [`benchmark-results/565c210.json`](benchmark-results/565c210.json), the output of the command in [Reproduce](#reproduce), and those charts are generated from that file (the one exception is `duplicate-prevention.svg`, generated from the 4 November run described in [Second run](#second-run-4-november-f78d82e)); the tables are transcribed from it by hand. The 26 October figures come from [`../LOAD_TEST.md`](../LOAD_TEST.md), the form-check figures from `formcheck/metrics.json`, and the run time in Reproduce was read from the shell's `time`. All data is synthetic.

## Method

**What it proves:** the prototype's deadline engine and main read screens were timed at 15,000 applications in one cycle, with no request errors and no duplicate alerts on a repeat cycle.

Source: `api/scripts/load-test.ts`. It resets the demo database, copies the seeded applications with their deadline items and assignments until there are 15,000 applications (due dates spread about 20 days either side of today), times two full deadline-engine cycles back to back, then times five read screens at 20 concurrent requests (400 requests per screen). It resets the demo database again at the end. Percentiles are over those 400 requests.

Caveats:
- Single machine, synthetic data, not a production benchmark. The API, database and load generator share one host, so they compete for the same 4 cores.
- One run. There is no repeat or variance figure; the numbers are one measurement.

## Environment

Source: the `machine` and `pgVersion` fields of the JSON.

| | |
|---|---|
| CPU | 4 vCPU, Intel Xeon @ 2.10 GHz |
| Memory | 16 GB |
| Node | v22.22.0 |
| PostgreSQL | 16.15, same machine |
| Commit | `565c210` |

## Dataset

![Dataset scale](charts/dataset-scale.svg)

**What it proves:** the run was at the claimed scale, 15,000 applications.

Source: the `data` block of the JSON.

| | Count |
|---|---|
| Applications | 15,000 (191 seeded, the rest copied) |
| Deadline items | 27,412 (13,982 open) |
| Assignments | 17,279 |
| Bulk load time | 1.7 s |

Caveats:
- Copies of 191 seeded applications, not real filings, so the mix of cases is far less varied than real data would be.

## Deadline engine

![New alerts per engine cycle](charts/engine-cycle.svg)

**What it proves:** a second cycle straight after the first raises no new alerts, because `AlertLog`'s unique key makes the decision to alert exactly-once per item and level, at this scale too.

Source: the `engine` block of the JSON.

| Cycle | Time | New alerts | Notifications | Flags raised |
|---|---|---|---|---|
| First (all 13,982 open items checked) | 93.8 s | 9,321 (1,674 reminders, 1,580 late reminders, 1,742 at risk, 2,648 overdue, 3,257 escalations) | 9,778 | 9,501 |
| Second, straight after | 47.1 s | **0** | 0 | 0 |

Caveats:
- A full cycle takes longer than the demo's one-minute schedule at this scale (93.8 s and 47.1 s against 60 s). Alerts are date-based, so production needs one full cycle a day, and the advisory lock that already stops cycles overlapping covers a long one. Batching the item queries is the planned fix.
- "Exactly-once" is about the decision to alert. Alerts here are in-app notifications only; this build has no external e-mail or SMS channel, so there is no external delivery to measure.
- The chart shows alerts, not time; the times are in the table.

### Duplicate prevention, measured

![Duplicate alert prevention](charts/duplicate-prevention.svg)

**What it proves:** the 4 November run (below) measured the duplicate alerts the engine declined, instead of inferring them from "0 new alerts". In the second cycle the engine tried to write 6,490 alerts that `AlertLog`'s unique key (item, kind, level) already held, and created none.

Source: `engine.secondCycle.alertsSuppressed` in [`benchmark-results/f78d82e.json`](benchmark-results/f78d82e.json), read back from that cycle's `EngineRun` row. The 565c210 run predates the counter, so it has no such figure and none is claimed for it.

Caveats:
- 6,490 is the number of duplicate attempts the engine made, not the number of alerts created in cycle 1 (10,282); the two need not match, and the chart does not imply they do. The first cycle also declined 47 duplicates within itself.
- This is a measured count from one run on synthetic data at demo scale, not a delivery guarantee: alerts here are in-app only.

## Read screens

![Read latency, p95](charts/read-latency.svg)

**What it proves:** all five main screens answered 400 requests at 20 concurrent with zero errors, the slowest at a 95th percentile of 1.85 s.

Source: the `reads` array of the JSON.

| Screen | p50 | p95 | p99 | Max | Requests/s | Errors |
|---|---|---|---|---|---|---|
| Action Center (officer) | 276 ms | 461 ms | 572 ms | 574 ms | 70 | 0 |
| Action Center summary (senior) | 146 ms | 199 ms | 234 ms | 255 ms | 133 | 0 |
| Applications list (officer) | 756 ms | 815 ms | 849 ms | 933 ms | 26 | 0 |
| Team report (senior) | 1,648 ms | 1,851 ms | 1,946 ms | 2,000 ms | 12 | 0 |
| Authority queue | 298 ms | 348 ms | 398 ms | 399 ms | 66 | 0 |

Caveats:
- The team report and the applications list are the slowest screens. They are the reads the production plan moves to a read replica, with paging.
- Latency is measured with the database on the same machine, so there is no network time between API and database.

## Form check accuracy (for context)

![Form check recall by mode](charts/formcheck-modes.svg)

**What it proves:** the hybrid form check (rules or model) catches 86.3% of faulty synthetic forms overall (but only 31.5% of unit errors), against 85.9% for rules alone and 11.7% for the model alone.

Source: `formcheck/metrics.json` (`perFault.unit_error`), regenerated by `python3 -m training.evaluate`. At the same operating point the hybrid's precision is 0.975 and its false-alarm rate is 2.2%.

Caveats:
- Recall is not uniform across fault types: unit errors are the weak spot.
- Trained and tested on synthetic forms (4,000 to train; 1,000 normal and 1,000 faulty to test), so this says how the check behaves on generated faults, not on real filings. Advisory only.
- Reproducible from a bare checkout: the model and datasets are gitignored, but `cd formcheck && python3 -m training.generate && python3 -m training.train && python3 -m training.evaluate` in a clean copy reproduces `EVALUATION.md` and `metrics.json` byte-identically (`metrics.json` carries a `generatedAt` stamp that is kept when the figures are unchanged). Verified on this machine class only; floating-point results can differ on other CPUs.

## Against the 26 October run

The earlier figures are in [`../LOAD_TEST.md`](../LOAD_TEST.md). This run is faster on every measure; nothing regressed. The two runs may not be like-for-like, so read this as "no worse", not as an improvement.

| | 26 Oct | 3 Nov |
|---|---|---|
| First cycle | 140 s | 93.8 s |
| Second cycle | 74 s | 47.1 s |
| Applications list p95 | 1,602 ms | 815 ms |
| Team report p95 | 3,466 ms | 1,851 ms |
| Action Center p95 | 624 ms | 461 ms |
| Bulk load | 4.5 s | 1.7 s |

Caveats:
- The earlier run reported a 2.8 GHz CPU and this one 2.10 GHz, but quoted clock speeds on cloud vCPUs are not a reliable guide to relative speed. Host load, a warm cache and the slightly different seed state could each account for part of the gap. We have not isolated the cause, and a single run on each side cannot separate it from run-to-run variation.
- Slightly different counts (9,321 against 9,277 first-cycle alerts, 27,412 against 27,349 deadline items) are consistent with a different seed state, 191 seeded applications now against 192 then.

## Second run, 4 November (f78d82e)

A second run on the same machine, to give the Performance section two runs to compare. Source: [`benchmark-results/f78d82e.json`](benchmark-results/f78d82e.json), which declares `provenance: "BENCHMARK"`, `repeats: 1` and `resourceUse: null`. All data is synthetic, at demo scale (15,000 copied applications), on one host that also runs the API and database.

| | 3 Nov (565c210) | 4 Nov (f78d82e) |
|---|---|---|
| First cycle | 93.8 s | 131.5 s |
| Second cycle | 47.1 s | 68.1 s |
| New alerts, first cycle | 9,321 | 10,282 |
| New alerts, second cycle | 0 | 0 |
| Duplicates declined, second cycle | not measured | 6,490 |
| Open deadline items | 13,982 | 13,974 |
| Applications list p95 | 815 ms | 1,022 ms |
| Team report p95 | 1,851 ms | 2,296 ms |
| Action Center p95 | 461 ms | 508 ms |
| Summary (senior) p95 | 199 ms | 259 ms |
| Authority queue p95 | 348 ms | 471 ms |
| Request errors | 0 | 0 |

Caveats:
- The two runs have the same CPU model, core count, memory, Node and PostgreSQL versions, so the machine blocks match. They are still not like-for-like: the simulated date moved (3 to 4 November), so more items had crossed a threshold (10,282 against 9,321 first-cycle alerts, and 17 digests against none), and the seed state differs slightly. This run was slower on every measure; with one run per side we cannot say how much is run-to-run variation, host load or the extra work, and we have not isolated it.
- CPU and memory use during the runs were not measured (`resourceUse: null`). There is no repeat or variance figure (`repeats: 1`).
- The 565c210 file predates the `provenance`, `repeats`, `resourceUse` and `alertsSuppressed` keys and the machine block's `os`, `postgres` and `totalMemoryBytes`; it is left unedited, and the API labels it `BENCHMARK` by the directory fallback. The two runs can be compared on `cpus`, `cpuModel`, `memoryGb`, `node` and `pgVersion`, not on OS.
- The 4 November run took 4 min 44 s end to end here, against 3 min 27 s for the first.

## Reproduce

Needs a local PostgreSQL with the demo database seeded. The test resets that database at both ends, so never point it at a shared or hosted one.

```bash
cd api
npm run load:test -- --out ../docs/evidence/benchmark-results/$(git rev-parse --short HEAD).json
cd ..
node scripts/evidence-charts.mjs --bench docs/evidence/benchmark-results/$(git rev-parse --short HEAD).json \
  --metrics formcheck/metrics.json --out docs/evidence/charts
```

The first run took 3 min 27 s here, the second 4 min 44 s.
