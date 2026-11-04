import type { AlertKind, AlertsData, EvidenceEnvelope } from '../../../../api/types';
import { DayCountBars, HorizontalBars, wrapLabel } from '../charts';
import { DateRange, useRange, type Range } from '../DateRange';
import { fmtInt, list } from '../format';
import { Kpi, Panel, panelState } from '../Panel';
import { useEnvelope } from '../useEvidence';

const RETRY_MESSAGE = 'These figures could not be loaded.';
const NO_ACTIVITY = 'No engine activity recorded: the deadline engine has not run and no alert has been logged, so there is nothing to count.';
const KIND_WORDS: Record<AlertKind, string> = { REMINDER: 'Reminder', AT_RISK: 'Deadline at risk', OVERDUE: 'Deadline overdue', ESCALATION: 'Escalation', DIGEST: 'Daily digest' };
const rangeText = ({ from, to }: Range) => (from && to ? `${from} to ${to}` : from ? `from ${from}` : to ? `up to ${to}` : 'all dates');
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function AlertsSection() {
  const { range, setRange, invalid } = useRange();
  const q = useEnvelope<EvidenceEnvelope<AlertsData>>('alerts', { from: range.from, to: range.to });
  const a = q.data?.data;
  const def = q.data?.definition;
  const prov = q.data?.provenance;
  const error = { message: RETRY_MESSAGE, onRetry: () => void q.refetch() };
  const noActivity = !!a && a.total === null;
  const scope = `${noActivity ? 'no engine activity recorded' : `${fmtInt(a?.total)} alerts`} · ${rangeText(range)} · alert dates`;
  const state = (empty = false) => panelState(q, !noActivity && !!a && empty, noActivity);
  const common = { scope, state: state(), insufficientMessage: NO_ACTIVITY, error };
  const byKind = list(a?.byKind);
  const perDay = list(a?.perDay);
  const levels = list(a?.escalationsByLevel);
  const escalations = byKind.find((k) => k.kind === 'ESCALATION')?.count ?? 0;
  const rt = a?.reminderTiming;
  const n = a?.notifications;

  return (
    <div className="flex flex-col gap-4">
      <DateRange from={range.from} to={range.to} onChange={setRange} invalid={invalid} clockLabel="Dates are alert dates — the system's own calendar (the simulated date in this demo), not the real date. They select the alerts in every panel here except the notification counts, which are never windowed." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi label="Alerts raised" value={fmtInt(a?.total)} hint="Alerts the engine logged: the decision to alert, not delivery" provenance={prov?.total ?? null} definition={def?.total} {...common} />
        <Kpi label="Escalations" value={fmtInt(escalations)} hint={a?.total ? `of ${fmtInt(a.total)} alerts raised` : undefined} provenance={prov?.byKind ?? null} definition={def?.byKind} {...common} />
        <Kpi
          label="Reminders raised late"
          value={rt ? `${fmtInt(rt.late)} of ${fmtInt(rt.reminders)} reminders` : ''}
          hint="reminders only; the other alert kinds have no timeliness measure"
          emphasis={rt && rt.late > 0 ? 'warning' : undefined}
          provenance={prov?.reminderTiming ?? null}
          definition={def?.reminderTiming}
          {...common}
          state={panelState(q, false, noActivity || (!!a && !rt))}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Panel title="Alerts by kind (count of alerts)" provenance={prov?.byKind ?? null} definition={def?.byKind} emptyMessage="No alert was logged in this date range." {...common} state={state(!!a && byKind.length === 0)}>
          <HorizontalBars
            label="Number of alerts of each kind"
            rows={byKind.map((k) => ({ ...k, word: KIND_WORDS[k.kind] ?? k.kind }))}
            categoryKey="word"
            categoryHeader="Kind"
            valueKey="count"
            valueHeader="Alerts"
            rowHeight={44}
            lines={(r) => wrapLabel(String(r.word), 18)}
          />
        </Panel>

        <Panel title="Escalations by level (count of escalation alerts)" provenance={prov?.escalationsByLevel ?? null} definition={def?.escalationsByLevel} emptyMessage="No escalation was raised in this date range." {...common} state={state(!!a && levels.length === 0)}>
          <p className="mb-2 text-sm text-secondary">A higher level is raised as a deadline item becomes more overdue. Only levels with at least one alert are listed.</p>
          <HorizontalBars
            label="Number of escalation alerts at each level"
            rows={levels.map((e) => ({ ...e, word: `Level ${e.level}` }))}
            categoryKey="word"
            categoryHeader="Level"
            valueKey="count"
            valueHeader="Alerts"
            rowHeight={44}
            lines={(r) => [String(r.word)]}
          />
        </Panel>

        <div className="lg:col-span-2">
          <Panel title="Alerts per day (count of alerts, days with at least one alert)" provenance={prov?.perDay ?? null} definition={def?.perDay} emptyMessage="No alert was logged in this date range." {...common} state={state(!!a && perDay.length === 0)}>
            <p className="mb-2 text-sm text-secondary">These are the days the deadline engine ran; a missing day means it did not run, not that there were no alerts. This is not a workload trend.</p>
            <DayCountBars label={`Alerts logged on each of ${perDay.length} days the engine ran`} points={perDay} seriesName="Alerts" />
          </Panel>
        </div>

        <div className="lg:col-span-2">
          <Panel
            title="Alert status (acknowledgement is not recorded)"
            provenance={prov?.notifications ?? null}
            scope="Notifications: all ever created · not affected by the dates"
            definition={[def?.notRecorded, def?.notComputed, def?.notifications].filter(Boolean).join('\n\n') || undefined}
            state={panelState(q, false)}
            error={error}
          >
            {a && n ? (
              <div className="flex max-w-prose flex-col gap-2 text-base">
                <p>
                  Insufficient data: this system does not record {list(a.notRecorded).length ? list(a.notRecorded).join(' or ') : 'whether alerts were seen'}, so there is no figure for how many alerts were acknowledged. Absent is not zero.
                </p>
                <p>
                  How long an alert took to be followed by its deadline item closing is recorded per item (when the item was closed), but this page does not compute or chart it. A closed item does not show that the alert prompted anyone to act.
                </p>
                <p>
                  {n.informative
                    ? `${fmtInt(n.read)} of ${fmtInt(n.total)} notifications have been opened (${fmtInt(n.unread)} not yet).`
                    : `None of the ${fmtInt(n.total)} notifications has been opened, so notification read state says nothing about whether anyone responded to alerts.`}
                </p>
                <p className="text-sm text-secondary">{sentence('notification counts cover every notification ever created, whatever the dates above.')}</p>
              </div>
            ) : null}
          </Panel>
        </div>
      </div>
    </div>
  );
}
