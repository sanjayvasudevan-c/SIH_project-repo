export type Provenance = 'MEASURED' | 'DERIVED' | 'SYNTHETIC' | 'DOCUMENTED';
export type FindingStatus = 'open' | 'resolved';

export type Evidence = {
  id: string;
  title: string;
  href: string;
  kind: string;
  provenance: Provenance;
  revision?: string;
  observedAt?: string;
  note?: string;
};

export type Suite = {
  id: string;
  name: string;
  category: 'unit' | 'integration' | 'static' | 'model' | 'script';
  componentId: string;
  command: string;
  purpose: string;
};

export type Finding = {
  id: string;
  title: string;
  description: string;
  expected: string;
  actual: string;
  category: Suite['category'];
  severity: 'low' | 'medium' | 'high' | 'critical';
  severityBasis: string;
  status: FindingStatus;
  suiteId: string;
  componentId: string;
  firstObservedAt: string;
  lastObservedAt: string;
  verificationNote: string;
  revision: string;
  evidenceIds: string[];
  resolution: string | null;
};

export type ReviewFilters = {
  query: string;
  suiteId: string;
  category: string;
  severity: string;
  status: string;
  componentId: string;
};

export const projectReview = {
  asOf: '2026-11-04T07:24:38Z',
  problem: {
    id: 'SIH26262',
    title: 'Integrated AICTE Approval Workflow Automation, Compliance Monitoring and Alert Management System',
    summary: 'The project addresses the coordination required to move AICTE approval applications through scrutiny and decision stages while tracking EVC scheduling, institutional undertakings, compliance submissions, document validity, deadlines, and escalations.',
    sourceNote: 'The repository records the SIH problem ID and title, but does not include the complete official statement. This is a concise framing from the project brief and implementation documentation, not a reproduced official statement.',
    sourceIds: ['readme', 'feasibility', 'evaluation'],
  },
  chapters: [
    { id: 'overview', title: 'Project overview' },
    { id: 'problem', title: 'The problem' },
    { id: 'solution', title: 'The solution' },
    { id: 'system', title: 'How it works' },
    { id: 'built', title: 'What is built' },
    { id: 'findings', title: 'Test findings' },
    { id: 'remaining', title: 'What remains' },
    { id: 'progress', title: 'Project progress' },
  ],
  evidence: [
    { id: 'readme', title: 'Project README and SIH identity', href: 'https://github.com/sanjayvasudevan-c/SIH_project-repo/blob/b931f21/README.md', kind: 'Project documentation', provenance: 'DOCUMENTED', revision: 'b931f21' },
    { id: 'feasibility', title: 'Feasibility and project scope', href: 'https://github.com/sanjayvasudevan-c/SIH_project-repo/blob/b931f21/docs/evidence/FEASIBILITY.md', kind: 'Project documentation', provenance: 'DOCUMENTED', revision: 'b931f21' },
    { id: 'evaluation', title: 'Evaluation and model limitations', href: 'https://github.com/sanjayvasudevan-c/SIH_project-repo/blob/b931f21/docs/evaluation/README.md', kind: 'Evaluation documentation', provenance: 'DOCUMENTED', revision: 'b931f21' },
    { id: 'workflow', title: 'Code-grounded workflow diagrams', href: 'https://github.com/sanjayvasudevan-c/SIH_project-repo/blob/b931f21/docs/evidence/WORKFLOW.md', kind: 'Architecture documentation', provenance: 'DOCUMENTED', revision: 'b931f21' },
    { id: 'architecture', title: 'Prototype boundary and deployment limitations', href: 'https://github.com/sanjayvasudevan-c/SIH_project-repo/blob/b931f21/docs/evidence/ARCHITECTURE_VS_PROTOTYPE.md', kind: 'Architecture documentation', provenance: 'DOCUMENTED', revision: 'b931f21' },
    { id: 'assignment-test', title: 'Assignment test [21], expected exclusion', href: 'https://github.com/sanjayvasudevan-c/SIH_project-repo/blob/b931f21/api/test/assignment.test.ts#L57', kind: 'Test source', provenance: 'DOCUMENTED', revision: 'b931f21' },
    { id: 'assignment-engine', title: 'Assignment eligibility and explanation code', href: 'https://github.com/sanjayvasudevan-c/SIH_project-repo/blob/b931f21/api/src/assignment/engine.ts', kind: 'Implementation source', provenance: 'DOCUMENTED', revision: 'b931f21' },
    { id: 'ci-main', title: 'Merged-main CI run 41791850558', href: 'https://github.com/sanjayvasudevan-c/SIH_project-repo/actions/runs/41791850558', kind: 'GitHub Actions JUnit artifacts', provenance: 'MEASURED', revision: 'b931f21', observedAt: '2026-11-04T07:24:38Z', note: 'Actual CI execution. API suite has one failing assignment assertion.' },
    { id: 'ci-pr14', title: 'PR #14 CI run 41790535759', href: 'https://github.com/sanjayvasudevan-c/SIH_project-repo/actions/runs/41790535759', kind: 'GitHub Actions JUnit artifacts', provenance: 'MEASURED', revision: '9e0e018', observedAt: '2026-11-04T07:13:09Z', note: 'Historical PR run; not the latest merged-main result.' },
    { id: 'commit-evidence-route', title: 'Commit 0082c24: expose ADMIN Evidence Center', href: 'https://github.com/sanjayvasudevan-c/SIH_project-repo/commit/0082c24', kind: 'Git commit', provenance: 'DOCUMENTED', revision: '0082c24', observedAt: '2026-11-04T06:50:12Z' },
    { id: 'commit-header-fix', title: 'Commit 9e0e018: header title truncation', href: 'https://github.com/sanjayvasudevan-c/SIH_project-repo/commit/9e0e018', kind: 'Git commit', provenance: 'DOCUMENTED', revision: '9e0e018', observedAt: '2026-11-04T07:11:22Z' },
    { id: 'commit-merge', title: 'Merge commit b931f21: PR #14', href: 'https://github.com/sanjayvasudevan-c/SIH_project-repo/commit/b931f21', kind: 'Git commit', provenance: 'DOCUMENTED', revision: 'b931f21', observedAt: '2026-11-04T07:22:43Z' },
    { id: 'formcheck', title: 'Synthetic form-check model evaluation', href: 'https://github.com/sanjayvasudevan-c/SIH_project-repo/blob/b931f21/formcheck/EVALUATION.md', kind: 'Evaluation report', provenance: 'SYNTHETIC', revision: 'b931f21', note: 'Model metrics use generated data; they do not establish real-world AICTE accuracy.' },
    { id: 'benchmark', title: 'Synthetic performance benchmark', href: 'https://github.com/sanjayvasudevan-c/SIH_project-repo/blob/b931f21/docs/evidence/benchmark-results/f78d82e.json', kind: 'Benchmark artifact', provenance: 'SYNTHETIC', revision: 'b931f21', note: 'Single-machine synthetic workload; not a production service-level result.' },
    { id: 'ci-workflow', title: 'CI workflow and uploaded reports', href: 'https://github.com/sanjayvasudevan-c/SIH_project-repo/blob/b931f21/.github/workflows/ci.yml', kind: 'CI configuration', provenance: 'DOCUMENTED', revision: 'b931f21', note: 'CI uploads API and form-check JUnit artifacts. The app does not ingest them automatically.' },
  ] satisfies Evidence[],
  suites: [
    { id: 'api', name: 'API integration tests', category: 'integration', componentId: 'api', command: 'npm --workspace api run test', purpose: 'Exercise API behavior, workflow, assignment, authorization, scheduling, and persistence against PostgreSQL.' },
    { id: 'web', name: 'Web component tests', category: 'unit', componentId: 'web', command: 'npm run test:web', purpose: 'Exercise React pages and components with Vitest and Testing Library; no browser E2E suite is configured.' },
    { id: 'formcheck', name: 'Form-check tests and model evaluation', category: 'model', componentId: 'formcheck', command: 'npm run test:formcheck', purpose: 'Validate form-check rules and reproducibility; evaluation data is synthetic.' },
    { id: 'api-types', name: 'API TypeScript check', category: 'static', componentId: 'api', command: 'npm --workspace api run typecheck', purpose: 'Check API TypeScript types.' },
    { id: 'web-build', name: 'Web typecheck and production build', category: 'static', componentId: 'web', command: 'npm --workspace web run build', purpose: 'Type-check and bundle the existing frontend.' },
    { id: 'charts', name: 'Chart and evidence script tests', category: 'script', componentId: 'verification', command: 'node --test scripts/*.test.mjs', purpose: 'Check static chart and test-evidence helpers.' },
  ] satisfies Suite[],
  components: [
    { id: 'web', name: 'React web application', layer: 'Frontend', status: 'Implemented', purpose: 'Role-specific application screens, Action Center, Rules Center, and administration tools.', inputs: 'Authenticated user, API responses, current route.', outputs: 'Accessible forms, queues, dashboards, and workflows.', apiRoutes: ['/api/auth/me', '/api/applications'], models: ['Application', 'AlertLog'], dependsOn: ['api'], featureIds: ['workflow', 'roles'], suiteIds: ['web', 'web-build'], evidenceIds: ['readme', 'architecture'], limitations: ['No configured browser end-to-end suite.'] },
    { id: 'api', name: 'Express API', layer: 'Backend', status: 'Implemented', purpose: 'Authentication, role and region authorization, application workflows, verification endpoints, and configuration APIs.', inputs: 'HTTP requests and authenticated identity.', outputs: 'JSON responses, audit records, and workflow updates.', apiRoutes: ['/api/auth/*', '/api/applications/*', '/api/evidence/*'], models: ['Application', 'Assignment', 'AlertLog', 'EngineRun'], dependsOn: ['database', 'assignment', 'workflow', 'formcheck'], featureIds: ['workflow', 'roles'], suiteIds: ['api', 'api-types'], evidenceIds: ['architecture', 'ci-workflow'], limitations: ['Email and SMS delivery are not implemented.'] },
    { id: 'assignment', name: 'Assignment engine', layer: 'Domain service', status: 'Implemented; CI discrepancy not reproduced locally', purpose: 'Selects eligible officers using capacity, availability, role, region, and rule-pack policy, and records an explanation.', inputs: 'Task, application policy, candidate load, availability.', outputs: 'Assignment or blocked outcome, decision trace, reason text.', apiRoutes: ['/api/applications'], models: ['Assignment', 'AssignmentTrace', 'OfficerProfile'], dependsOn: ['database'], featureIds: ['workflow', 'roles'], suiteIds: ['api'], evidenceIds: ['assignment-test', 'assignment-engine', 'ci-main', 'workflow'], limitations: ['Latest merged-main CI run has an unresolved expected over-capacity exclusion assertion.'] },
    { id: 'workflow', name: 'Workflow and deadline engine', layer: 'Domain service', status: 'Implemented', purpose: 'Moves cases through configured stages, pauses/resumes deadlines, generates alerts and escalations.', inputs: 'Workflow actions, pinned and operational rule packs, simulated clock.', outputs: 'Stage transitions, deadline items, alerts, audit trail.', apiRoutes: ['/api/applications/*/actions', '/api/alerts/*'], models: ['Application', 'DeadlineItem', 'AlertLog', 'AuditLog'], dependsOn: ['assignment', 'database'], featureIds: ['workflow', 'compliance', 'alerts'], suiteIds: ['api'], evidenceIds: ['workflow', 'architecture'], limitations: ['Notifications are in-app only.'] },
    { id: 'database', name: 'PostgreSQL and Prisma', layer: 'Persistence', status: 'Implemented', purpose: 'Stores applications, assignments, rules, audit, deadlines, users, and operational records.', inputs: 'Prisma queries and transactional writes.', outputs: 'Persisted project and workflow state.', apiRoutes: [], models: ['Application', 'Assignment', 'EngineRun', 'AlertLog', 'AuditLog'], dependsOn: [], featureIds: ['workflow', 'roles'], suiteIds: ['api'], evidenceIds: ['architecture', 'ci-workflow'], limitations: ['Test integration requires PostgreSQL; local verification artifacts are files, not database records.'] },
    { id: 'formcheck', name: 'Form-check model', layer: 'Python evaluation', status: 'Partial; synthetic evaluation only', purpose: 'Combines deterministic checks with an Isolation Forest anomaly score for application forms.', inputs: 'Synthetic and submitted form fields.', outputs: 'Rule and anomaly flags to support human review.', apiRoutes: ['/api/form-check/*'], models: [], dependsOn: [], featureIds: ['formcheck'], suiteIds: ['formcheck'], evidenceIds: ['formcheck', 'evaluation'], limitations: ['Evaluation is synthetic; human regulatory review remains required.'] },
    { id: 'verification', name: 'Verification scripts and artifacts', layer: 'Verification', status: 'Implemented', purpose: 'Compares operational API aggregates with independent database queries and stores synthetic benchmark and model artifacts.', inputs: 'API responses, database rows, and committed JSON artifacts.', outputs: 'Verification summaries and reproducible benchmark data.', apiRoutes: ['/api/evidence/*'], models: ['EngineRun', 'AssignmentTrace', 'AlertLog'], dependsOn: ['api', 'database'], featureIds: [], suiteIds: ['charts'], evidenceIds: ['ci-main', 'ci-pr14', 'ci-workflow'], limitations: ['GitHub CI artifacts are not automatically imported into repository artifacts.'] },
  ],
  features: [
    { id: 'workflow', title: 'Approval workflow and assignment', status: 'Implemented', summary: 'Role-scoped stages, rule-pack routing, explainable assignment, and audit-backed actions.', componentIds: ['api', 'assignment', 'workflow', 'database'], evidenceIds: ['workflow', 'assignment-engine'], limitations: ['One latest-main assignment assertion remains open.'] },
    { id: 'roles', title: 'Role-based workspaces and access', status: 'Implemented', summary: 'College, officer, manager, committee, authority, rules, and admin experiences use existing authentication and route guards.', componentIds: ['web', 'api', 'database'], evidenceIds: ['architecture', 'readme'], limitations: ['Production identity-provider integration is not demonstrated by the available evidence.'] },
    { id: 'compliance', title: 'Undertakings and document validity', status: 'Implemented', summary: 'Institutions can view conditions, upload supporting evidence, and renew tracked documents.', componentIds: ['web', 'api', 'workflow', 'database'], evidenceIds: ['readme', 'workflow'], limitations: ['Uploaded seed documents are placeholders; external storage is not demonstrated.'] },
    { id: 'alerts', title: 'Deadlines, alerts, and escalation', status: 'Implemented', summary: 'Engine tracks due dates, in-app reminders, and escalation levels using configured rules.', componentIds: ['api', 'workflow', 'database'], evidenceIds: ['workflow', 'architecture'], limitations: ['No email/SMS delivery.'] },
    { id: 'formcheck', title: 'Form-check assistance', status: 'Partial', summary: 'Deterministic checks and a synthetic-data anomaly model assist human review.', componentIds: ['formcheck', 'api'], evidenceIds: ['formcheck', 'evaluation'], limitations: ['No real AICTE corpus; metrics do not establish production accuracy.'] },
  ],
  runs: [
    { id: 'main-41791850558', revision: 'b931f21', workflowRun: '41791850558', observedAt: '2026-11-04T07:24:38Z', sourceId: 'ci-main', provenance: 'MEASURED', suites: [{ id: 'api', passed: 241, failed: 1, skipped: 0, status: 'FAIL' }, { id: 'web', passed: 237, failed: 0, skipped: 0, status: 'PASS' }, { id: 'formcheck', passed: 99, failed: 0, skipped: 0, status: 'PASS' }, { id: 'charts', passed: 21, failed: 0, skipped: 0, status: 'PASS' }], checks: [{ name: 'API TypeScript check', status: 'PASS' }, { name: 'Web typecheck and production build', status: 'PASS' }, { name: 'Lint', status: 'NOT CONFIGURED' }] },
    { id: 'pr14-41790535759', revision: '9e0e018', workflowRun: '41790535759', observedAt: '2026-11-04T07:13:09Z', sourceId: 'ci-pr14', provenance: 'MEASURED', suites: [{ id: 'api', passed: 242, failed: 0, skipped: 0, status: 'PASS' }, { id: 'web', passed: 237, failed: 0, skipped: 0, status: 'PASS' }, { id: 'formcheck', passed: 99, failed: 0, skipped: 0, status: 'PASS' }, { id: 'charts', passed: 21, failed: 0, skipped: 0, status: 'PASS' }], checks: [{ name: 'API TypeScript check', status: 'PASS' }, { name: 'Web typecheck and production build', status: 'PASS' }, { name: 'Lint', status: 'NOT CONFIGURED' }] },
  ],
  findings: [
    { id: 'assignment-capacity-exclusion', title: 'Assignment test did not report expected over-capacity exclusion', description: 'GitHub Actions run 41791850558 failed assignment test [21] on merged commit b931f21. The test selected its synthetic over-capacity candidate by generated-ID order, although the seed includes one officer with 20 capacity points while the fixture assumes 10. The fixture now names the officers and fixes the candidate capacity at 10. The run log does not expose the selected officer profile, so this is a verified test fragility and a plausible cause, not a proven explanation for that historical run. Keep the CI discrepancy open until a newer GitHub execution confirms the result.', expected: 'Reason text matching /over capacity (1.xx/ for the synthetic officer load.', actual: 'Assigned to Naveen Thomas (Officer, South): lowest load score (0.20) among eligible officers; utilisation 0.25 after this task. 49 eligible; excluded 1 on leave until 12 Nov. Tier 0. Rules 2027-28 v1.', category: 'integration', severity: 'medium', severityBasis: 'Reviewer triage for this dossier; not an upstream issue label.', status: 'open', suiteId: 'api', componentId: 'assignment', firstObservedAt: '2026-11-04T07:24:38Z', lastObservedAt: '2026-11-04T07:24:38Z', verificationNote: 'After stabilizing the fixture on this branch, the targeted assignment file passed (5 tests) and the full API suite passed (242 tests) on Node 22 with disposable PostgreSQL 16. The recorded GitHub run remains the latest hosted CI result.', revision: 'b931f21', evidenceIds: ['assignment-test', 'assignment-engine', 'ci-main'], resolution: null },
  ] satisfies Finding[],
  gaps: [
    { id: 'no-e2e', title: 'No automated browser end-to-end suite', status: 'not tested', summary: 'UI behavior is covered by component tests; no Playwright/Cypress end-to-end suite was found.' },
    { id: 'no-coverage', title: 'No coverage report configured', status: 'not measured', summary: 'The repository has no configured coverage threshold or report in the reviewed CI workflow.' },
    { id: 'ci-ingestion', title: 'CI test artifacts are not imported into repository records', status: 'known limitation', summary: 'GitHub Actions stores JUnit artifacts; repository verification snapshots must be recorded separately.' },
    { id: 'no-lint', title: 'No configured lint gate', status: 'not configured', summary: 'No ESLint, Prettier, or Ruff configuration was found in the repository.' },
    { id: 'synthetic-model', title: 'Form-check metrics use synthetic data', status: 'known limitation', summary: 'The evaluation does not establish accuracy on real AICTE applications.' },
    { id: 'prototype-scope', title: 'Production hardening and later workflow phases remain incomplete', status: 'partial', summary: 'See the implementation boundary and phase table in the architecture-versus-prototype evidence.' },
  ],
  milestones: [
    { date: '2026-11-04T06:50:12Z', revision: '0082c24', title: 'ADMIN Evidence Center route exposed', evidenceId: 'commit-evidence-route' },
    { date: '2026-11-04T07:11:22Z', revision: '9e0e018', title: 'Header title truncation fixed for tablet widths', evidenceId: 'commit-header-fix' },
    { date: '2026-11-04T07:22:43Z', revision: 'b931f21', title: 'PR #14 merged into main', evidenceId: 'commit-merge' },
  ],
} as const;

export function filterFindings(findings: readonly Finding[], filters: ReviewFilters): Finding[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return findings.filter((finding) => {
    const text = `${finding.title} ${finding.description} ${finding.expected} ${finding.actual}`.toLocaleLowerCase();
    return (!query || text.includes(query))
      && (filters.suiteId === 'all' || finding.suiteId === filters.suiteId)
      && (filters.category === 'all' || finding.category === filters.category)
      && (filters.severity === 'all' || finding.severity === filters.severity)
      && (filters.status === 'all' || finding.status === filters.status)
      && (filters.componentId === 'all' || finding.componentId === filters.componentId);
  });
}

export function resolveReviewSelection(input: { chapter?: string | null; component?: string | null; finding?: string | null }) {
  const chapter = projectReview.chapters.some((item) => item.id === input.chapter) ? input.chapter! : 'overview';
  const component = projectReview.components.some((item) => item.id === input.component) ? input.component! : projectReview.components[0]?.id;
  const finding = projectReview.findings.some((item) => item.id === input.finding) ? input.finding! : null;
  return { chapter, component, finding };
}
