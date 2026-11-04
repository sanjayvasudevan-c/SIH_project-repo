# Methodology

[← Evidence visualizations](README.md) · [Inventory](INVENTORY.md)

How every figure in this package was produced, what kind of figure it is, how to regenerate it, and what it cannot tell you.

## The rule

A figure is drawn only from a committed file, by a script, with its provenance stated in the chart footer. Nothing is typed into a chart. If a measure is missing from the inputs, the chart shows a "Not available: <reason>" panel; it is never drawn as zero.

## Three sources, no others

| Source | Files | Produced by |
|---|---|---|
| Snapshot of the system's aggregates | [`data/*.json`](data/) and [`data/manifest.json`](data/manifest.json) | `npm run evidence:snapshot` |
| Benchmark runs | [`../benchmark-results/*.json`](../benchmark-results/) | `npm run load:test` (in `api/`) |
| Form-check evaluation | [`formcheck/metrics.json`](../../../formcheck/metrics.json) | `python3 -m training.evaluate` (in `formcheck/`) |

**The snapshot.** The files in `data/` are the aggregate responses exactly as the system computed them, each with its `definition` (how the number is measured, in words), its `provenance` and its `data`. They are not edited. The manifest records the commit that produced them, the database (cluster, host, port and name; no credentials), the row counts at the time, the reproduce command, the statement that this is a synthetic demo dataset, and a `verification` block.

**The verification gate.** Before it writes anything, the snapshot command runs the same comparison as `npm run evidence:verify`: every headline number from the aggregates is recomputed with separate raw SQL, on four date windows, and compared. If any check disagrees, nothing is written and the command exits non-zero. The manifest records the result as "N checks, N agree". The code is imported from [`api/src/evidence-verify.ts`](../../../api/src/evidence-verify.ts), not re-implemented.

## Provenance classes (named in every chart footer)

| Label | Meaning here |
|---|---|
| MEASURED | Counted or timed from stored rows or a recorded run. |
| DERIVED | Computed from measured values by a stated formula (a share, a median, a confusion matrix rebuilt from rates, a histogram of an existing list). The chart or the text beside it says how. |
| SYNTHETIC | The underlying data is generated or seeded, not real AICTE data. This applies to every chart in the package. |

No chart is labelled TARGET or ESTIMATE, because the package contains no target or estimate that has a citable source. "Not available" panels are labelled as such.

## How the charts are produced

[`scripts/evidence-visualizations.mjs`](../../../scripts/evidence-visualizations.mjs) reads the three sources and writes every SVG, every category README and the worked example. It is deterministic: the same inputs give byte-identical files (no clock, no randomness; the only dates are the data's own). `npm run evidence:visualize` writes; `node scripts/evidence-visualizations.mjs --check` rebuilds in memory and fails if a file on disk differs. The drawing primitives and the input validators are in [`scripts/evidence-charts.mjs`](../../../scripts/evidence-charts.mjs).

Rendering rules, tested in `scripts/evidence-visualizations.test.mjs`:

- GitHub shows a linked SVG as an image, where inherited colours render black. Every chart therefore paints its own opaque white background with a border and gives every text, line and bar an explicit colour, so it reads the same in light and dark mode.
- Width 800, text 13 units or larger, bar axes start at zero, no 3D, no truncated axes. Text width is measured while drawing and a label that would run outside the chart stops the build.
- Colour-blind-safe palette of at most five hues with a fixed meaning (blue main series, orange the thing to look at, green good, amber warning, grey neutral). Colour is never the only signal: values are printed on the marks and the second series of a pair is hatched.
- The numbers plotted equal the numbers in the source files; the tests compare each chart's plotted values with the JSON.

## Reproduce

```bash
npm run demo:reset          # LOCAL demo database only: it rebuilds the seeded data and the simulated-clock history
npm run evidence:snapshot   # verify against independent SQL, then write data/ and manifest.json
npm run evidence:visualize  # regenerate every chart and README from the committed files
npm run evidence:verify     # re-run the API-vs-SQL comparison on its own
npm run evidence:links      # check that every relative link in the evidence documents resolves
node --test scripts/*.test.mjs
```

Never run `demo:reset` against a shared or hosted database. The snapshot command is read-only against the database (a read-only session, and it writes no audit row).

## Limitations

- **Synthetic.** The dataset is a seed script plus a simulated clock. The figures describe this demo, not AICTE's caseload, and no chart supports a statement about real applications.
- **A snapshot is a moment.** The data files describe the database when the snapshot was taken, at the commit in the manifest. They do not update themselves.
- **Verification proves agreement, not truth.** It shows the aggregate code and an independent query agree on the same rows. It does not prove the rows are true, that the SQL is right (two queries by the same team can share a misunderstanding), or that a definition's wording is right.
- **Benchmarks are single runs.** Each benchmark file is one run on one shared machine, with no variance measured and no CPU or memory use recorded. Two runs on matching machine specifications are not a controlled comparison.
- **Machine-learning figures are synthetic.** Precision, recall and the false-alarm rate were measured on generated forms. There is no claim about real-world accuracy, and the weakness on unit errors is shown.
- **The audit integrity check is not tamper-proof.** It detects edits that do not recompute the whole forward hash chain; the application role cannot update or delete audit rows; a database owner can disable that guard.
- **No external delivery.** Alerts are logged decisions. This build has no channel that sends them outside the system, so nothing here is a delivery guarantee.
- **Not production-ready.** The package says what was measured on a prototype.
