# Project documentation

Use this page to find the project overview, implementation evidence, and developer instructions.

## For SIH evaluators

- [Interactive benchmark explorer](index.html): run JSON-backed engine and screen results locally with `python3 -m http.server 8000 --directory docs`. To publish it, set repository **Settings → Pages → Build and deployment → Source** to **GitHub Actions**, then manually run the `Deploy evaluator documentation` workflow. The workflow is prepared, but Pages is not currently configured or deployed.
- [Evaluation guide](evaluation/README.md): problem, implementation claims, measured results, and limitations.
- [Architecture versus prototype scope](evidence/ARCHITECTURE_VS_PROTOTYPE.md): what is built and what remains outside the prototype.
- [Workflow diagrams](evidence/WORKFLOW.md): case lifecycle, assignment, escalation, and rule publication.
- [Benchmark methodology and results](evidence/BENCHMARKS.md): machine-readable runs, measurements, and caveats.
- [Evidence API and verification records](evidence/README.md): retained ADMIN-only endpoints, verification tooling, and archived screenshots.

## Technical reference

- [Decision log](../DECISIONS.md)
- [Feasibility and production gaps](evidence/FEASIBILITY.md)
- [Initial audit](evidence/INITIAL_AUDIT.md): a dated baseline, not a description of the current app.
- [Engineering plans](engineering/README.md): retained historical plans and specifications.
- [Local setup and verification](development/LOCAL_SETUP.md)
- [Demo walkthrough](development/DEMO_SCRIPT.md)
- [Historical 26 October load test](LOAD_TEST.md)

## Screens and artifacts

- [Workflow screenshots](screens/)
- [Archived verification screenshots](screens/evidence/): historical views of the removed Evidence Center UI, retained for technical review.
- [Benchmark JSON and charts](evidence/benchmark-results/)
- [Presentation](presentation/GeoLogics_SIH2026_Presentation.pptx)
