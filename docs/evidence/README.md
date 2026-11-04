# Verification API and artifacts

The former ADMIN Evidence Center page has been removed from the application. The read-only `/api/evidence/*` endpoints remain mounted for the repository verification CLI, automated API coverage, and technical inspection. They use existing audit, assignment-trace, engine-run, alert, and evidence artifact data. This cleanup does not delete API behavior, database records, models, migrations, or audit history.

## Verification tooling

Run `npm run evidence:verify` from the repository root with the demo database available. The CLI compares API aggregates with independent raw SQL queries. Its output describes the database state and code revision used for that run; it is not a browser or deployment check.

`npm run evidence:record-tests` records a local test snapshot for the current revision. Benchmark JSON files and model evaluation figures under this directory remain technical artifacts; they are not application UI data.

## Archived screenshots

Screens in [`../screens/evidence/`](../screens/evidence/) are historical captures of the former UI, retained as review records. They do not describe the current application navigation.

## Related references

- [Architecture and prototype boundary](ARCHITECTURE_VS_PROTOTYPE.md)
- [Benchmark results](benchmark-results/)
- [Historical implementation plan](../engineering/plans/2026-11-03-evidence-center.md)
