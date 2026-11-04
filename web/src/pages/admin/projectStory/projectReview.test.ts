import { describe, expect, it } from 'vitest';
import { filterFindings, projectReview, resolveReviewSelection } from '../../../data/projectReview';

describe('project review data', () => {
  it('keeps the latest failed CI snapshot separate from historical passing runs', () => {
    expect(projectReview.runs[0]).toMatchObject({
      revision: 'b931f21',
      workflowRun: '41791850558',
      suites: expect.arrayContaining([
        expect.objectContaining({ id: 'api', passed: 241, failed: 1, status: 'FAIL' }),
        expect.objectContaining({ id: 'formcheck', passed: 99, failed: 0, status: 'PASS' }),
      ]),
    });
    expect(projectReview.runs.some((run) => run.revision === '9e0e018')).toBe(true);
  });

  it('relates every feature, component, suite, finding and evidence reference', () => {
    const featureIds = new Set<string>(projectReview.features.map((item) => item.id));
    const componentIds = new Set<string>(projectReview.components.map((item) => item.id));
    const suiteIds = new Set<string>(projectReview.suites.map((item) => item.id));
    const findingIds = new Set<string>(projectReview.findings.map((item) => item.id));
    const evidenceIds = new Set<string>(projectReview.evidence.map((item) => item.id));

    for (const item of projectReview.features) {
      expect(item.componentIds.every((id) => componentIds.has(id))).toBe(true);
      expect(item.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true);
    }
    for (const item of projectReview.components) {
      expect(item.dependsOn.every((id) => componentIds.has(id))).toBe(true);
      expect(item.featureIds.every((id) => featureIds.has(id))).toBe(true);
      expect(item.suiteIds.every((id) => suiteIds.has(id))).toBe(true);
      expect(item.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true);
    }
    for (const item of projectReview.findings) {
      expect(suiteIds.has(item.suiteId)).toBe(true);
      expect(componentIds.has(item.componentId)).toBe(true);
      expect(item.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true);
    }
    for (const run of projectReview.runs) {
      expect(evidenceIds.has(run.sourceId)).toBe(true);
      expect(run.suites.every((suite) => suiteIds.has(suite.id))).toBe(true);
    }
    for (const item of projectReview.milestones) expect(evidenceIds.has(item.evidenceId)).toBe(true);
    expect(findingIds.size).toBe(projectReview.findings.length);
  });

  it('applies search and every selected filter together', () => {
    const result = filterFindings(projectReview.findings, {
      query: 'over capacity',
      suiteId: 'api',
      category: 'integration',
      severity: 'medium',
      status: 'open',
      componentId: 'assignment',
    });
    expect(result.map((item) => item.id)).toEqual(['assignment-capacity-exclusion']);
    expect(filterFindings(projectReview.findings, { ...emptyFilters, status: 'resolved' })).toEqual([]);
  });

  it('uses valid defaults for unknown chapter, component, and finding links', () => {
    expect(resolveReviewSelection({ chapter: 'unknown', component: 'missing', finding: 'missing' })).toEqual({
      chapter: 'overview',
      component: projectReview.components[0]?.id,
      finding: null,
    });
  });
});

const emptyFilters = { query: '', suiteId: 'all', category: 'all', severity: 'all', status: 'all', componentId: 'all' } as const;
