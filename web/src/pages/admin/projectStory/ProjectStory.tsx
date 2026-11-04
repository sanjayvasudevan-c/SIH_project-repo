import { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleAlert, ExternalLink, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../../components/ui';
import { filterFindings, projectReview, resolveReviewSelection, type Finding, type ReviewFilters } from '../../../data/projectReview';
import { useTitle } from '../../../lib/useTitle';

const chapterById = (id: string) => projectReview.chapters.find((chapter) => chapter.id === id)!;
const evidenceById = (id: string) => projectReview.evidence.find((item) => item.id === id);
const suiteById = (id: string) => projectReview.suites.find((item) => item.id === id);
const componentById = (id: string) => projectReview.components.find((item) => item.id === id);
const latestRun = projectReview.runs[0]!;
const historicalRun = projectReview.runs[1]!;
const latestTotals = latestRun.suites.reduce((totals, suite) => ({ passed: totals.passed + suite.passed, failed: totals.failed + suite.failed, skipped: totals.skipped + suite.skipped }), { passed: 0, failed: 0, skipped: 0 });

function StatusTag({ children, tone = 'neutral', className = '' }: { children: string; tone?: 'neutral' | 'good' | 'warning' | 'bad'; className?: string }) {
  const color = tone === 'good' ? 'border-success/30 bg-success/10 text-success' : tone === 'warning' ? 'border-warning/40 bg-warning/10 text-warning' : tone === 'bad' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-subtle bg-subtle text-secondary';
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${color} ${className}`}>{children}</span>;
}

function Panel({ children, className = '', ariaLabel }: { children: React.ReactNode; className?: string; ariaLabel?: string }) {
  return <section role={ariaLabel ? 'region' : undefined} aria-label={ariaLabel} className={`rounded-lg border border-subtle bg-surface p-5 shadow-sm ${className}`}>{children}</section>;
}

export function ProjectStory() {
  useTitle('Project review');
  const [params, setParams] = useSearchParams();
  const selection = resolveReviewSelection({ chapter: params.get('chapter'), component: params.get('component'), finding: params.get('finding') });
  const [filters, setFilters] = useState<ReviewFilters>({ query: '', suiteId: 'all', category: 'all', severity: 'all', status: 'all', componentId: 'all' });
  const [period, setPeriod] = useState<'all' | 'latest' | 'historical'>('all');

  const findings = useMemo(() => {
    const rows = filterFindings(projectReview.findings, filters);
    return rows.filter((finding) => period === 'all' || (period === 'latest' ? finding.revision === latestRun.revision : finding.revision !== latestRun.revision));
  }, [filters, period]);
  const selectedFinding = findings.find((finding) => finding.id === selection.finding) ?? (selection.finding ? undefined : findings[0]);
  const selectedComponent = componentById(selection.component)!;
  const active = chapterById(selection.chapter);

  const selectChapter = (chapter: string) => {
    const next = new URLSearchParams(params);
    next.set('chapter', chapter);
    if (chapter !== 'findings') next.delete('finding');
    setParams(next);
  };
  const selectComponent = (component: string) => {
    const next = new URLSearchParams(params);
    next.set('chapter', 'system');
    next.set('component', component);
    next.delete('finding');
    setParams(next);
  };
  const selectFinding = (finding: string) => {
    const next = new URLSearchParams(params);
    next.set('chapter', 'findings');
    next.set('finding', finding);
    setParams(next);
  };

  return <div className="mx-auto w-full max-w-content px-4 py-6 md:px-6">
    <PageHeader title={`${projectReview.problem.id} · Project review`} description="Explore the approval workflow, how its parts work together, what has been built, and where it still needs work." breadcrumb={[{ label: 'Administration', to: '/admin' }, { label: 'Project review' }]} />

    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm" role="status">
      <CircleAlert size={17} className="shrink-0 text-warning" aria-hidden />
      <span><strong>Latest recorded test run:</strong> {latestRun.revision} · {latestTotals.passed} passed, {latestTotals.failed} failed, {latestTotals.skipped} skipped.</span>
      <a className="font-semibold text-accent hover:underline" href={evidenceById('ci-main')!.href} target="_blank" rel="noreferrer">View CI run</a>
    </div>

    <nav aria-label="Project review chapters" className="mb-6 -mx-1 flex gap-1 overflow-x-auto border-b border-subtle px-1 pb-2">
      {projectReview.chapters.map((chapter) => <button key={chapter.id} type="button" aria-current={selection.chapter === chapter.id ? 'page' : undefined} onClick={() => selectChapter(chapter.id)} className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium ${selection.chapter === chapter.id ? 'bg-gov-nav text-white' : 'text-secondary hover:bg-subtle hover:text-primary'}`}>
        {chapter.title}
      </button>)}
    </nav>

    <div key={active.id} className="space-y-6 transition-opacity duration-200">
      <ChapterHeading chapter={active.title} />
      {selection.chapter === 'overview' ? <Overview selectChapter={selectChapter} selectComponent={selectComponent} /> : null}
      {selection.chapter === 'problem' ? <Problem /> : null}
      {selection.chapter === 'solution' ? <Solution selectComponent={selectComponent} /> : null}
      {selection.chapter === 'system' ? <Architecture selected={selectedComponent} selectComponent={selectComponent} selectSuite={(id) => { setFilters({ ...filters, suiteId: id }); selectChapter('findings'); }} /> : null}
      {selection.chapter === 'built' ? <Built selectComponent={selectComponent} /> : null}
      {selection.chapter === 'findings' ? <Findings filters={filters} setFilters={setFilters} period={period} setPeriod={setPeriod} findings={findings} selected={selectedFinding} selectFinding={selectFinding} selectSuite={(id) => setFilters({ ...filters, suiteId: id })} /> : null}
      {selection.chapter === 'remaining' ? <Remaining /> : null}
      {selection.chapter === 'progress' ? <Progress /> : null}
    </div>
  </div>;
}

function ChapterHeading({ chapter }: { chapter: string }) {
  return <div className="flex flex-wrap items-end justify-between gap-3">
    <div><p className="text-xs font-bold uppercase tracking-[0.15em] text-accent">SIH 2026 · Project overview</p><h2 className="mt-1 text-2xl font-semibold text-primary">{chapter}</h2></div>
    <p className="text-sm text-muted">Project snapshot as of {new Date(projectReview.asOf).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })} IST</p>
  </div>;
}

function Overview({ selectChapter, selectComponent }: { selectChapter: (id: string) => void; selectComponent: (id: string) => void }) {
  const openCount = projectReview.findings.filter((item) => item.status === 'open').length;
  const implemented = projectReview.features.filter((item) => item.status === 'Implemented').length;
  return <>
    <Panel className="overflow-hidden border-gov-nav/20 bg-gradient-to-br from-gov-nav/[0.04] via-surface to-accent/[0.04]">
      <div className="grid gap-6 md:grid-cols-[1.5fr_1fr] md:items-end">
        <div><p className="text-sm font-semibold text-accent">Team GeoLogics · SIH26262</p><h3 className="mt-2 max-w-3xl text-3xl font-semibold leading-tight">A clearer way to move approval work forward.</h3><p className="mt-3 max-w-3xl text-secondary">Follow an application through role-based review, assignment, deadlines, and compliance. Explore the system architecture, implemented features, and the remaining work.</p></div>
        <div className="rounded-md border border-subtle bg-surface/80 p-4"><div className="flex items-center justify-between gap-3"><span className="font-semibold">Current verification</span><StatusTag tone="bad">1 open CI failure</StatusTag></div><p className="mt-2 text-sm text-secondary">The latest merged-main CI run passed the web and form-check suites; one assignment assertion failed. The earlier PR run is shown separately as history.</p><button type="button" onClick={() => selectChapter('findings')} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">Review the failing case <ArrowRight size={14} aria-hidden /></button></div>
      </div>
    </Panel>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricButton label="Implemented features" value={`${implemented} / ${projectReview.features.length}`} detail="What the prototype can do" onClick={() => selectChapter('built')} />
      <MetricButton label="Latest test cases" value={`${latestTotals.passed} pass · ${latestTotals.failed} fail`} detail="Run 41791850558 · b931f21" onClick={() => selectChapter('findings')} tone="bad" />
      <MetricButton label="Open findings" value={`${openCount}`} detail="Unresolved from recorded runs" onClick={() => selectChapter('findings')} tone="bad" />
      <MetricButton label="Architecture components" value={`${projectReview.components.length}`} detail="Select a component to explore" onClick={() => selectChapter('system')} />
    </div>

    <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
      <Panel><PanelTitle>What the system covers</PanelTitle><p className="mt-2 max-w-3xl text-sm leading-6 text-secondary">Application routing, stage ownership, assignment, deadline monitoring, compliance evidence, document validity, role-specific work queues, and an audit trail are represented in the prototype. Automated actions support authorized officials; regulatory decisions remain with competent people.</p><div className="mt-4 flex flex-wrap gap-2">{['Workflow', 'Compliance', 'Alerts', 'Role access', 'Evidence'].map((label) => <StatusTag key={label}>{label}</StatusTag>)}</div></Panel>
      <Panel><PanelTitle>Start exploring</PanelTitle><div className="mt-3 grid gap-2">{[['system', 'Inspect the architecture'], ['findings', 'Read the latest test finding'], ['remaining', 'Review known gaps']].map(([id, label]) => <button key={id} type="button" onClick={() => selectChapter(id!)} className="flex items-center justify-between rounded-md border border-subtle px-3 py-3 text-left text-sm font-semibold hover:bg-subtle">{label}<ArrowRight size={16} aria-hidden /></button>)}</div></Panel>
    </div>

    <div className="grid gap-3 md:grid-cols-3">{projectReview.components.slice(0, 3).map((component) => <button key={component.id} type="button" onClick={() => selectComponent(component.id)} className="rounded-lg border border-subtle bg-surface p-4 text-left hover:border-accent/50 hover:shadow-sm"><span className="text-xs font-bold uppercase tracking-wide text-muted">{component.layer}</span><span className="mt-1 block font-semibold">{component.name}</span><span className="mt-2 block text-sm text-secondary">{component.status}</span></button>)}</div>
  </>;
}

function Problem() {
  return <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
    <Panel><p className="text-xs font-bold uppercase tracking-wide text-accent">Problem statement · {projectReview.problem.id}</p><h3 className="mt-2 text-xl font-semibold leading-snug">{projectReview.problem.title}</h3><p className="mt-4 text-base leading-7 text-secondary">{projectReview.problem.summary}</p><p className="mt-4 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm leading-6 text-secondary">{projectReview.problem.sourceNote}</p></Panel>
    <Panel><PanelTitle>Who the workflow connects</PanelTitle><ul className="mt-4 space-y-3">{[['Institutions', 'Submit applications, respond to deficiencies, and provide undertaking or renewal evidence.'], ['Processing officials', 'Review cases, manage stage queues, and follow deadlines.'], ['Committees and authorities', 'Complete EVC/recommendation steps and make decisions within their authority.']].map(([name, description]) => <li key={name} className="border-l-2 border-accent/40 pl-3"><h4 className="font-semibold">{name}</h4><p className="mt-1 text-sm leading-6 text-secondary">{description}</p></li>)}</ul></Panel>
  </div>;
}

function Solution({ selectComponent }: { selectComponent: (id: string) => void }) {
  return <><Panel><PanelTitle>Proposed system behavior</PanelTitle><p className="mt-2 max-w-4xl text-sm leading-6 text-secondary">A configurable, role-aware workflow keeps the case history, current owner, deadlines, and evidence together. Automated routing and alerts reduce manual coordination; human review and regulatory authority remain part of the process.</p></Panel><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{projectReview.features.map((feature) => <button key={feature.id} type="button" onClick={() => selectComponent(feature.componentIds[0]!)} className="rounded-lg border border-subtle bg-surface p-4 text-left hover:border-accent/50"><div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{feature.title}</h3><StatusTag tone={feature.status === 'Implemented' ? 'good' : 'warning'}>{feature.status}</StatusTag></div><p className="mt-2 text-sm leading-6 text-secondary">{feature.summary}</p><span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent">Explore implementation <ArrowRight size={14} aria-hidden /></span></button>)}</div></>;
}

function Architecture({ selected, selectComponent, selectSuite }: { selected: (typeof projectReview.components)[number]; selectComponent: (id: string) => void; selectSuite: (id: string) => void }) {
  return <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.7fr)_1.3fr]">
    <ArchitectureMap selectComponent={selectComponent} />
    <Panel><PanelTitle>System components</PanelTitle><p className="mt-1 text-sm text-secondary">Choose a component. The textual details remain available without the diagram.</p><ul aria-label="Architecture components" className="mt-3 flex flex-col gap-1">{projectReview.components.map((component) => <li key={component.id}><button type="button" onClick={() => selectComponent(component.id)} aria-pressed={component.id === selected.id} className={`w-full rounded-md px-3 py-3 text-left ${component.id === selected.id ? 'bg-gov-nav text-white' : 'hover:bg-subtle'}`}><span className="block font-semibold">{component.name}</span><span className={`mt-0.5 block text-xs ${component.id === selected.id ? 'text-white/75' : 'text-muted'}`}>{component.layer} · {component.status}</span></button></li>)}</ul></Panel>
    <Panel ariaLabel="Component details"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-accent">{selected.layer}</p><h3 className="mt-1 text-xl font-semibold">{selected.name}</h3></div><StatusTag tone={selected.status.startsWith('Implemented') ? (selected.status.includes('failure') || selected.status.includes('gap') ? 'warning' : 'good') : 'warning'}>{selected.status}</StatusTag></div><p className="mt-3 text-sm leading-6 text-secondary">{selected.purpose}</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><InfoList title="Inputs" values={[selected.inputs]} /><InfoList title="Outputs" values={[selected.outputs]} /><InfoList title="API routes" values={selected.apiRoutes.length ? selected.apiRoutes : ['No direct HTTP route']} /><InfoList title="Data models" values={selected.models.length ? selected.models : ['No direct database model']} /><InfoList title="Dependencies" values={selected.dependsOn.map((id) => componentById(id)?.name ?? id)} /><div className="rounded-md bg-subtle/60 p-3"><h4 className="text-xs font-bold uppercase tracking-wide text-muted">Related tests</h4><div className="mt-1 flex flex-col items-start gap-1">{selected.suiteIds.map((id) => <button key={id} type="button" onClick={() => selectSuite(id)} className="text-left text-sm font-medium text-accent hover:underline">{suiteById(id)?.name ?? id}</button>)}</div></div></div><div className="mt-4"><h4 className="text-sm font-semibold">Known limitations</h4><ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-secondary">{selected.limitations.map((item) => <li key={item}>{item}</li>)}</ul></div></Panel>
  </div>;
}

function ArchitectureMap({ selectComponent }: { selectComponent: (id: string) => void }) {
  const lanes = [
    { title: 'Interface', ids: ['web'] },
    { title: 'Application API', ids: ['api'] },
    { title: 'Domain processing', ids: ['assignment', 'workflow', 'formcheck'] },
    { title: 'Persistence and reporting', ids: ['database', 'evidence'] },
  ];
  return <Panel className="lg:col-span-2"><div className="flex flex-wrap items-end justify-between gap-3"><div><PanelTitle>Implementation flow</PanelTitle><p className="mt-1 text-sm text-secondary">Select a node to inspect its interfaces, dependencies, related tests, and limitations.</p></div><span className="text-xs text-muted">Authenticated requests → policy-backed processing → persisted records</span></div><div role="group" aria-label="Interactive architecture diagram" className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1.3fr_auto_1.2fr] md:items-stretch">
    {lanes.map((lane, index) => <div key={lane.title} className="contents">
      <div className="rounded-md border border-subtle bg-subtle/30 p-3"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{lane.title}</p><div className="flex flex-col gap-2">{lane.ids.map((id) => { const node = componentById(id)!; return <button key={id} type="button" onClick={() => selectComponent(id)} className="rounded-md border border-subtle bg-surface px-3 py-2 text-left text-sm font-semibold hover:border-accent/50 hover:bg-accent/5">{node.name}<span className="mt-0.5 block text-xs font-normal text-muted">{node.layer}</span></button>; })}</div></div>
      {index < lanes.length - 1 ? <div aria-hidden className="hidden items-center px-1 text-accent md:flex">→</div> : null}
    </div>)}
  </div><p className="mt-3 text-xs leading-5 text-muted">The diagram summarizes the code-grounded component relationships. Component details below identify concrete routes, models, tests, and known gaps.</p></Panel>;
}

function Built({ selectComponent }: { selectComponent: (id: string) => void }) {
  return <><Panel><PanelTitle>Implementation status</PanelTitle><p className="mt-2 text-sm leading-6 text-secondary">“Implemented” means the repository contains working code and supporting documentation or tests. It does not claim production deployment, regulatory validation, or external-service integration.</p></Panel><div className="space-y-3">{projectReview.features.map((feature) => <Panel key={feature.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{feature.title}</h3><p className="mt-1 max-w-4xl text-sm text-secondary">{feature.summary}</p></div><StatusTag tone={feature.status === 'Implemented' ? 'good' : 'warning'}>{feature.status}</StatusTag></div><div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]"><div><p className="text-xs font-bold uppercase text-muted">Components</p><p className="mt-1 text-sm">{feature.componentIds.map((id) => componentById(id)?.name).filter(Boolean).join(' · ')}</p></div><div><p className="text-xs font-bold uppercase text-muted">Limitations</p><p className="mt-1 text-sm text-secondary">{feature.limitations.join(' ')}</p></div><button type="button" onClick={() => selectComponent(feature.componentIds[0]!)} className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">Explore <ArrowRight size={14} aria-hidden /></button></div></Panel>)}</div></>;
}

function Findings({ filters, setFilters, period, setPeriod, findings, selected, selectFinding, selectSuite }: { filters: ReviewFilters; setFilters: (filters: ReviewFilters) => void; period: 'all' | 'latest' | 'historical'; setPeriod: (period: 'all' | 'latest' | 'historical') => void; findings: Finding[]; selected: Finding | undefined; selectFinding: (id: string) => void; selectSuite: (id: string) => void }) {
  const update = (key: keyof ReviewFilters, value: string) => setFilters({ ...filters, [key]: value });
  return <>
    <Panel><div className="flex flex-wrap items-start justify-between gap-3"><div><PanelTitle>Latest available CI execution</PanelTitle><p className="mt-1 text-sm text-secondary">{latestRun.revision} · observed {new Date(latestRun.observedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })} IST</p></div><a className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline" href={evidenceById(latestRun.sourceId)!.href} target="_blank" rel="noreferrer">Open workflow run <ExternalLink size={14} aria-hidden /></a></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">{latestRun.suites.map((suite) => { const descriptor = suiteById(suite.id)!; const total = suite.passed + suite.failed + suite.skipped; return <button key={suite.id} type="button" onClick={() => selectSuite(suite.id)} className="rounded-md border border-subtle p-3 text-left hover:border-accent/50 hover:bg-subtle"><div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{descriptor.name}</span><StatusTag tone={suite.status === 'PASS' ? 'good' : 'bad'}>{suite.status}</StatusTag></div><p className="mt-2 text-lg font-semibold tabular-nums">{suite.passed} pass · {suite.failed} fail</p><p className="text-xs text-muted">{total} recorded test cases · {suite.skipped} skipped</p><span className="mt-2 block text-xs font-semibold text-accent">Filter findings by suite →</span></button>; })}</div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">{latestRun.checks.map((check) => <div key={check.name} className="flex items-center justify-between gap-2 rounded-md bg-subtle/60 px-3 py-2 text-sm"><span>{check.name}</span><StatusTag tone={check.status === 'PASS' ? 'good' : 'neutral'}>{check.status}</StatusTag></div>)}</div>
    </Panel>

    <Panel><div className="flex flex-wrap items-end justify-between gap-3"><div><PanelTitle>Findings and test inventory</PanelTitle><p className="mt-1 text-sm text-secondary">Filters combine across suite, category, severity, status, component, time period, and text.</p></div><span className="text-sm font-semibold" aria-live="polite">{findings.length} {findings.length === 1 ? 'finding' : 'findings'} match</span></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs font-semibold">Search findings<span className="relative"><Search size={15} className="absolute left-3 top-2.5 text-muted" aria-hidden /><input value={filters.query} onChange={(event) => update('query', event.target.value)} className="w-full rounded-md border border-subtle bg-surface py-2 pl-9 pr-3 text-sm font-normal" placeholder="Text in title or description…" /></span></label>
        <FilterSelect label="Test suite" value={filters.suiteId} onChange={(value) => update('suiteId', value)} options={[['all', 'All suites'], ...projectReview.suites.map((suite) => [suite.id, suite.name] as [string, string])]} />
        <FilterSelect label="Category" value={filters.category} onChange={(value) => update('category', value)} options={['all', 'unit', 'integration', 'static', 'model', 'script'].map((value) => [value, value === 'all' ? 'All categories' : value])} />
        <FilterSelect label="Severity" value={filters.severity} onChange={(value) => update('severity', value)} options={['all', 'low', 'medium', 'high', 'critical'].map((value) => [value, value === 'all' ? 'All severities' : value])} />
        <FilterSelect label="Status" value={filters.status} onChange={(value) => update('status', value)} options={['all', 'open', 'resolved'].map((value) => [value, value === 'all' ? 'All statuses' : value])} />
        <FilterSelect label="Component" value={filters.componentId} onChange={(value) => update('componentId', value)} options={[['all', 'All components'], ...projectReview.components.map((component) => [component.id, component.name] as [string, string])]} />
        <FilterSelect label="Time period" value={period} onChange={(value) => setPeriod(value as typeof period)} options={[["all", 'All available history'], ['latest', 'Latest run'], ['historical', 'Historical runs']]} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-2" aria-label="Filtered test findings">{findings.length ? findings.map((finding) => <button key={finding.id} type="button" aria-pressed={selected?.id === finding.id} onClick={() => selectFinding(finding.id)} className={`w-full rounded-md border p-3 text-left ${selected?.id === finding.id ? 'border-accent bg-accent/5' : 'border-subtle hover:bg-subtle'}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{finding.title}</span><StatusTag tone={finding.status === 'open' ? 'bad' : 'good'}>{finding.status}</StatusTag></div><p className="mt-1 text-sm text-secondary">{suiteById(finding.suiteId)?.name} · {finding.category} · {finding.severity} · {finding.revision}</p></button>) : <p className="rounded-md border border-dashed border-subtle p-5 text-sm text-secondary">No findings match these filters. This does not mean the selected suites have no test failures; check the execution inventory above.</p>}</div>
        {selected ? <div role="region" aria-label="Finding details" className="rounded-md border border-subtle bg-subtle/40 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-danger">{selected.severity} · reviewer triage · {selected.status}</p><h3 className="mt-1 font-semibold">{selected.title}</h3></div><StatusTag tone="bad" className="shrink-0 whitespace-nowrap">CI FINDING OPEN</StatusTag></div><p className="mt-3 text-sm leading-6 text-secondary">{selected.description}</p><p className="mt-2 text-xs text-muted">{selected.severityBasis}</p><div className="mt-3 rounded-md border border-success/30 bg-success/5 p-3 text-sm text-secondary"><strong>Local verification:</strong> {selected.verificationNote}</div><dl className="mt-3 space-y-2 text-sm"><div><dt className="font-semibold">Expected</dt><dd className="mt-0.5 text-secondary">{selected.expected}</dd></div><div><dt className="font-semibold">Observed in CI</dt><dd className="mt-0.5 break-words text-secondary">{selected.actual}</dd></div><div><dt className="font-semibold">Component / suite</dt><dd className="mt-0.5 text-secondary">{componentById(selected.componentId)?.name} · {suiteById(selected.suiteId)?.name}</dd></div><div><dt className="font-semibold">Verification</dt><dd className="mt-0.5 text-secondary">Observed {new Date(selected.lastObservedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })} IST at {selected.revision}. No newer GitHub CI run is recorded.</dd></div></dl></div> : <div className="rounded-md border border-dashed border-subtle p-5 text-sm text-secondary">Choose a finding to inspect its expected behavior, actual result, component, and CI run.</div>}
      </div>
      <div className="mt-5 border-t border-subtle pt-4"><PanelTitle>Historical comparison</PanelTitle><p className="mt-1 text-sm text-secondary">The prior PR #14 run is separate historical evidence: API {historicalRun.suites.find((suite) => suite.id === 'api')?.passed} passed / 0 failed at {historicalRun.revision}. It is not a trend line and does not replace the merged-main result.</p><a href={evidenceById(historicalRun.sourceId)!.href} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">Open historical run <ExternalLink size={14} aria-hidden /></a></div>
    </Panel>
  </>;
}

function Remaining() {
  return <><Panel><PanelTitle>Known limitations and review priorities</PanelTitle><p className="mt-2 text-sm leading-6 text-secondary">These items are grounded in repository configuration and documentation. “Not tested” or “not measured” describes an evidence gap, not a passing result.</p></Panel><div className="grid gap-3 md:grid-cols-2">{projectReview.gaps.map((gap) => <Panel key={gap.id}><div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{gap.title}</h3><StatusTag tone={gap.status === 'partial' ? 'warning' : 'neutral'}>{gap.status}</StatusTag></div><p className="mt-2 text-sm leading-6 text-secondary">{gap.summary}</p></Panel>)}</div><Panel className="border-danger/25 bg-danger/5"><div className="flex items-center gap-2"><CircleAlert className="text-danger" size={18} aria-hidden /><PanelTitle>Immediate engineering priority</PanelTitle></div><p className="mt-2 text-sm leading-6 text-secondary">Reproduce and resolve the open assignment capacity-exclusion test, then capture a newer CI run. Until a successful run exists, the finding remains open.</p><a className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline" href={evidenceById('ci-main')!.href} target="_blank" rel="noreferrer">View recorded CI run <ExternalLink size={14} aria-hidden /></a></Panel></>;
}

function Progress() {
  return <Panel><PanelTitle>Project milestones</PanelTitle><p className="mt-1 text-sm text-secondary">Dates are commit and merge timestamps from repository history; they do not imply deployment.</p><ol className="mt-5 space-y-0">{projectReview.milestones.map((item, index) => <li key={item.revision} className="relative flex gap-4 pb-6 last:pb-0"><div className="flex w-5 flex-col items-center"><span className={`mt-1 h-3 w-3 rounded-full ${index === projectReview.milestones.length - 1 ? 'bg-accent' : 'bg-success'}`} />{index < projectReview.milestones.length - 1 ? <span className="mt-1 h-full w-px bg-subtle" /> : null}</div><div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-wide text-muted">{new Date(item.date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })} IST · {item.revision}</p><h3 className="mt-1 font-semibold">{item.title}</h3></div></li>)}</ol></Panel>;
}

function MetricButton({ label, value, detail, onClick, tone = 'neutral' }: { label: string; value: string; detail: string; onClick: () => void; tone?: 'neutral' | 'bad' }) {
  return <button type="button" onClick={onClick} className="rounded-lg border border-subtle bg-surface p-4 text-left transition-colors hover:border-accent/50 hover:bg-subtle"><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-secondary">{label}</span>{tone === 'bad' ? <CircleAlert size={16} className="text-danger" aria-hidden /> : <CheckCircle2 size={16} className="text-success" aria-hidden />}</div><span className={`mt-2 block text-xl font-semibold tabular-nums ${tone === 'bad' ? 'text-danger' : 'text-primary'}`}>{value}</span><span className="mt-1 block text-xs text-muted">{detail}</span></button>;
}

function PanelTitle({ children }: { children: React.ReactNode }) { return <h3 className="text-base font-semibold text-primary">{children}</h3>; }
function InfoList({ title, values }: { title: string; values: readonly string[] }) { return <div className="rounded-md bg-subtle/60 p-3"><h4 className="text-xs font-bold uppercase tracking-wide text-muted">{title}</h4><ul className="mt-1 space-y-1 break-words text-sm text-secondary">{values.map((value) => <li key={value}>{value}</li>)}</ul></div>; }
function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) { return <label className="flex flex-col gap-1 text-xs font-semibold">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="rounded-md border border-subtle bg-surface px-3 py-2 text-sm font-normal">{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>; }
