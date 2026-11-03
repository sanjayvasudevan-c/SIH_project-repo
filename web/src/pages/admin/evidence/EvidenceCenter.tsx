import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { PageHeader, Select, Tabs } from '../../../components/ui';
import { useTitle } from '../../../lib/useTitle';
import { isSectionId, SECTIONS, type SectionId } from './sections';

const BASE = '/admin/evidence';

/**
 * The Evidence Center shell: one section at a time, chosen by tabs (md and up) or a native select (below md),
 * both driven by the URL. Moving between sections drops the date range, whose meaning is per section.
 */
export function EvidenceCenterPage() {
  useTitle('Evidence Center');
  const { section } = useParams();
  const navigate = useNavigate();
  if (!isSectionId(section)) return <Navigate to={`${BASE}/overview`} replace />;

  const current = SECTIONS.find((s) => s.id === section)!;
  const go = (id: SectionId, replace = false) => navigate({ pathname: `${BASE}/${id}`, search: '' }, { replace });
  const Body = current.Component;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Evidence Center"
        description="Figures drawn from the data stored by this system. Each shows where it comes from, what it covers and how it is measured."
        breadcrumb={[{ label: 'Administration', to: '/admin' }, { label: 'Evidence Center' }]}
      />
      <div>
        <div className="hidden md:block">
          <Tabs label="Evidence sections" tabs={SECTIONS.map((s) => ({ id: s.id, label: s.label }))} value={section} onChange={(id) => go(id, true)} idPrefix="evidence" />
        </div>
        <div className="flex flex-col gap-1 md:hidden">
          <label htmlFor="evidence-section" className="text-base font-medium">
            Section
          </label>
          <Select id="evidence-section" value={section} onChange={(e) => go(e.target.value as SectionId)}>
            {SECTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <section role="tabpanel" id="evidence-panel" aria-labelledby={`evidence-tab-${section}`} className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">
            {current.label}
          </h2>
          <p className="text-base text-secondary">{current.description}</p>
        </div>
        <Body key={section} />
      </section>
    </div>
  );
}
