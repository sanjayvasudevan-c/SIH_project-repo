import { X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { AuditAnalyticsData, EvidenceEnvelope } from '../../../../api/types';
import { Badge, Field, Select } from '../../../../components/ui';
import { HorizontalBars, wrapLabel } from '../charts';
import { DateRange, useRange, type Range } from '../DateRange';
import { fmtInt, list } from '../format';
import { Panel, panelState } from '../Panel';
import { useEnvelope } from '../useEvidence';

const RETRY_MESSAGE = 'These figures could not be loaded.';
const NO_EVENTS = 'No audit events match this date range and these filters.';
const rangeText = ({ from, to }: Range) => (from && to ? `${from} to ${to}` : from ? `from ${from}` : to ? `up to ${to}` : 'all dates');
/** "FORM_CHECK_JUSTIFIED" -> "Form check justified". */
const words = (v: string) => {
  const s = v.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

type FilterKey = 'actor' | 'action' | 'entity';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'actor', label: 'Actor role' },
  { key: 'action', label: 'Action' },
  { key: 'entity', label: 'Entity' },
];

/**
 * The filters live in the URL as their own params. A value the response does not contain (a stale or hand-made link)
 * is ignored: never sent to the API, never shown as a chip. Moving to another section drops every param.
 */
function useFilters(options: AuditAnalyticsData | undefined) {
  const [params, setParams] = useSearchParams();
  const present: Record<FilterKey, string[]> = {
    actor: list(options?.byActorRole).map((r) => r.actorRole),
    action: list(options?.byAction).map((r) => r.action),
    entity: list(options?.byEntity).map((r) => r.entity),
  };
  const active: Partial<Record<FilterKey, string>> = {};
  let ignored = false;
  for (const { key } of FILTERS) {
    const v = params.get(key);
    if (v && present[key].includes(v)) active[key] = v;
    else if (v && options) ignored = true; // a link naming a value this period does not have: said so, not silently dropped
  }
  const set = (key: FilterKey, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  return { present, active, set, ignored };
}

export function AuditSection() {
  const { range, setRange, invalid } = useRange();
  const rangeParams = { from: range.from, to: range.to };
  // The unfiltered answer for this range supplies the select options, so a filter can always be changed again.
  const base = useEnvelope<EvidenceEnvelope<AuditAnalyticsData>>('audit-analytics', rangeParams);
  const { present, active, set, ignored } = useFilters(base.data?.data);
  const filtered = Object.keys(active).length > 0;
  const narrowed = useEnvelope<EvidenceEnvelope<AuditAnalyticsData>>('audit-analytics', { ...rangeParams, ...active }, { enabled: base.isSuccess && filtered });
  const q = filtered ? narrowed : base;
  const env = q.data;
  const a = env?.data;
  const def = env?.definition;
  const prov = env?.provenance;
  const error = { message: RETRY_MESSAGE, onRetry: () => void q.refetch() };
  const scope = `n = ${fmtInt(a?.total)} audit events · ${rangeText(range)} · audit event dates${filtered ? ' · filtered' : ''}`;
  const empty = !!a && a.total === 0;
  const common = { scope, emptyMessage: NO_EVENTS, error };
  const state = (rows: unknown) => panelState(q, empty || (!!a && list(rows as unknown[]).length === 0));
  const integrity = a?.integrity;
  const labelOf = (key: FilterKey, v: string) => (key === 'entity' || key === 'action' || key === 'actor' ? words(v) : v);

  return (
    <div className="flex flex-col gap-4">
      <DateRange from={range.from} to={range.to} onChange={setRange} invalid={invalid} clockLabel="Dates are audit event dates: when each event was recorded, by the real clock. They select the events in the three breakdowns; the integrity check always covers the whole log." />
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {FILTERS.map(({ key, label }) => (
            <Field key={key} label={label}>
              {({ id }) => (
                <Select id={id} value={active[key] ?? ''} onChange={(e) => set(key, e.target.value)}>
                  <option value="">All</option>
                  {present[key].map((v) => (
                    <option key={v} value={v}>
                      {labelOf(key, v)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ))}
        </div>
        {filtered ? (
          <ul className="flex flex-wrap gap-2" aria-label="Active filters">
            {FILTERS.filter(({ key }) => active[key]).map(({ key, label }) => (
              <li key={key}>
                <button type="button" className="hit inline-flex items-center gap-1 rounded-full border bg-surface px-3 text-sm" aria-label={`Remove filter: ${label} ${labelOf(key, active[key]!)}`} onClick={() => set(key, '')}>
                  {label}: {labelOf(key, active[key]!)}
                  <X size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {ignored ? (
          <p role="status" className="text-sm text-warning">
            A filter in the link is not present in this period and was ignored.
          </p>
        ) : null}
        <p className="text-xs text-secondary">The choices are the values present in the audit log for these dates. Only counts are shown; no case content is exposed here.</p>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Panel title="Events by action (count of audit events)" provenance={prov?.events ?? null} definition={def?.events} {...common} state={state(a?.byAction)}>
          <HorizontalBars
            label="Number of audit events of each action"
            rows={list(a?.byAction).map((r) => ({ ...r, word: words(r.action) }))}
            categoryKey="word"
            categoryHeader="Action"
            valueKey="count"
            valueHeader="Events"
            rowHeight={34}
            lines={(r) => wrapLabel(String(r.word), 18)}
          />
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title="Events by actor role (count of audit events)" provenance={prov?.events ?? null} definition={def?.events} {...common} state={state(a?.byActorRole)}>
            <HorizontalBars
              label="Number of audit events by the role that acted"
              rows={list(a?.byActorRole).map((r) => ({ ...r, word: words(r.actorRole) }))}
              categoryKey="word"
              categoryHeader="Actor role"
              valueKey="count"
              valueHeader="Events"
              rowHeight={34}
              lines={(r) => wrapLabel(String(r.word), 18)}
            />
          </Panel>
          <Panel title="Events by entity (count of audit events)" provenance={prov?.events ?? null} definition={def?.events} {...common} state={state(a?.byEntity)}>
            <HorizontalBars
              label="Number of audit events on each kind of entity"
              rows={list(a?.byEntity).map((r) => ({ ...r, word: words(r.entity) }))}
              categoryKey="word"
              categoryHeader="Entity"
              valueKey="count"
              valueHeader="Events"
              rowHeight={40}
              lines={(r) => wrapLabel(String(r.word), 18)}
            />
          </Panel>
        </div>
      </div>

      <Panel
        title="Audit log integrity"
        provenance={prov?.integrity ?? null}
        scope="Whole audit log, checked now · filters and dates do not change it"
        definition={def?.integrity}
        state={panelState(q, false, !!a && !integrity)}
        insufficientMessage="The integrity check was not returned, so no result is shown."
        error={error}
      >
        {integrity ? (
          <div className="flex max-w-prose flex-col gap-3 text-base">
            <p>
              {integrity.rowsChecked === 0 ? (
                <Badge tone="neutral">Nothing to check — the audit log is empty</Badge>
              ) : integrity.ok ? (
                <Badge tone="success">No broken chain found</Badge>
              ) : (
                <Badge tone="danger">{`${fmtInt(integrity.brokenChainCount)} ${integrity.brokenChainCount === 1 ? 'chain does' : 'chains do'} not verify`}</Badge>
              )}
            </p>
            <p className="tnum">
              Recomputed over {fmtInt(integrity.chainsChecked)} chains and {fmtInt(integrity.rowsChecked)} events.
            </p>
            <p className="text-sm text-secondary">Checked over the whole audit log. Filters and dates do not change it.</p>
            {def?.integrity ? <p className="whitespace-pre-line text-sm">{def.integrity}</p> : null}
            <p className="text-sm text-secondary">
              The check detects edits that do not recompute the whole forward hash chain. The application role cannot update or delete audit rows, but a person who owns the database table can disable that guard, so this is not tamper-proof against a database administrator.
            </p>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
