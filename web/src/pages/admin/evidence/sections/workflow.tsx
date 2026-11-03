import { Link } from "react-router-dom";
import type {
  EvidenceEnvelope,
  Status,
  WorkflowData,
} from "../../../../api/types";
import { daySpan, HorizontalBars, VolumeBars, wrapLabel } from "../charts";
import { DateRange, useRange, type Range } from "../DateRange";
import { fmtInt, fmtPct } from "../format";
import { Panel, panelState } from "../Panel";
import { ProvenanceChip } from "../Provenance";
import { useEvidence } from "../useEvidence";

/** The words the rest of the app uses for these statuses (components/AppStatus.tsx, ui/Badge.tsx). */
export const STATUS_WORDS: Record<Status, string> = {
  IN_STAGE: "In progress",
  RETURNED: "Waiting on college",
  APPROVED: "Approved",
  APPROVED_WITH_CONDITIONS: "Approved with conditions",
  REJECTED: "Rejected",
  CLOSED: "Closed",
};

const rangeText = ({ from, to }: Range) =>
  from && to
    ? `${from} to ${to}`
    : from
      ? `from ${from}`
      : to
        ? `up to ${to}`
        : "all dates";
const NONE_SUBMITTED = "No applications were submitted in this date range.";
const RETRY_MESSAGE = "These figures could not be loaded.";

export function WorkflowSection() {
  const { range, setRange, invalid } = useRange();
  // One query for the whole group, and the same key the Overview tile reads when no range is chosen.
  const q = useEvidence<EvidenceEnvelope<WorkflowData>>("workflow", {
    from: range.from,
    to: range.to,
  });
  const w = q.data?.data;
  const def = q.data?.definition;
  const prov = q.data?.provenance;
  const error = { message: RETRY_MESSAGE, onRetry: () => void q.refetch() };
  const n = w?.submittedTotal ?? 0;
  const scope = `n = ${fmtInt(w?.submittedTotal)} applications · ${rangeText(range)}`;
  const none = !!w && n === 0;
  const points = w?.volumeOverTime ?? [];
  const pt = w?.processingTime;

  return (
    <div className="flex flex-col gap-4">
      <DateRange
        from={range.from}
        to={range.to}
        onChange={setRange}
        invalid={invalid}
        clockLabel="Dates are application dates: the day each application was submitted. They select which applications are counted in all four panels."
      />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Panel
          title="Where applications got to (count of applications that reached each stage)"
          provenance={prov?.funnel ?? null}
          scope={scope}
          definition={def?.funnel}
          state={panelState(q, none || (!!w && w.funnel.length === 0))}
          emptyMessage={NONE_SUBMITTED}
          error={error}
        >
          <p className="mb-2 text-sm text-secondary">
            Stages are not a steady drop-off: routes differ, so a later stage
            can be reached by more applications than an earlier one. Compare
            each bar with its own route count.
          </p>
          <HorizontalBars
            label="Applications that reached each stage, with the number whose route includes that stage"
            rows={(w?.funnel ?? []) as unknown as Record<string, unknown>[]}
            categoryKey="label"
            categoryHeader="Stage"
            valueKey="reached"
            valueHeader="Reached"
            rowHeight={64}
            lines={(r) => [
              String(r.label),
              `of ${fmtInt(r.onRoute as number)} on this route`,
              `${fmtPct(r.share as number | null)} of submitted`,
            ]}
            extraColumns={[
              {
                key: "onRoute",
                header: "On this route",
                format: (v) => `of ${fmtInt(v as number)} on this route`,
              },
              {
                key: "share",
                header: "Share of submitted",
                format: (v) => fmtPct(v as number | null),
              },
            ]}
          />
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-secondary">
            Share of submitted:{" "}
            <ProvenanceChip provenance={prov?.funnelShare ?? null} />
          </p>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel
            title="Current status of submitted applications (count of applications)"
            provenance={prov?.statusDistribution ?? null}
            scope={scope}
            definition={def?.statusDistribution}
            state={panelState(
              q,
              none || (!!w && w.statusDistribution.length === 0),
            )}
            emptyMessage={NONE_SUBMITTED}
            error={error}
          >
            <HorizontalBars
              label="Number of applications in each current status"
              rows={
                (w?.statusDistribution ?? []).map((r) => ({
                  ...r,
                  word: STATUS_WORDS[r.status] ?? r.status,
                })) as unknown as Record<string, unknown>[]
              }
              categoryKey="word"
              categoryHeader="Current status"
              valueKey="count"
              valueHeader="Applications"
              rowHeight={44}
              lines={(r) => wrapLabel(String(r.word), 18)}
              extraColumns={[
                {
                  key: "share",
                  header: "Share of submitted",
                  format: (v) => fmtPct(v as number | null, 1),
                },
              ]}
            />
            <p className="mt-2 text-sm text-secondary">
              These are the only statuses an application can have. Overdue is a
              property of a deadline item, not of an application: see{" "}
              <Link
                to="/admin/evidence/scheduler"
                className="text-accent hover:underline"
              >
                Scheduler &amp; compliance
              </Link>
              .
            </p>
          </Panel>

          <Panel
            title="Time to decision (median working days, decided applications only)"
            provenance={prov?.processingTime ?? null}
            scope={scope}
            definition={def?.processingTime}
            state={panelState(q, false, !!pt && pt.medianWorkingDays === null)}
            insufficientMessage="No application in this scope has been decided yet, so there is no median to show."
            error={error}
          >
            {pt ? (
              <>
                <p className="tnum text-2xl font-semibold">
                  {pt.medianWorkingDays === null
                    ? "Unavailable"
                    : `${fmtInt(pt.medianWorkingDays)} ${pt.unit} (median)`}
                </p>
                <p className="mt-1 text-sm text-secondary">
                  {fmtInt(pt.decidedCount)} decided · {fmtInt(pt.inFlightCount)}{" "}
                  still in progress (not counted)
                </p>
              </>
            ) : null}
          </Panel>
        </div>

        <div className="lg:col-span-2">
          <Panel
            title="Applications over time (count of applications and deadline items per day)"
            provenance={prov?.volumeOverTime ?? null}
            scope={`${scope}${points.length ? ` · ${daySpan(points)} · days with no events are not shown` : ""}`}
            definition={def?.volumeOverTime}
            state={panelState(
              q,
              none || (!!w && points.length === 0),
              !!w && n > 0 && points.length === 1,
            )}
            emptyMessage={NONE_SUBMITTED}
            insufficientMessage="A trend needs at least two days with events; only one has been recorded."
            error={error}
          >
            <p className="mb-2 text-sm text-secondary">
              The day axis is not the date range chosen above. Submitted and
              decided are placed on the day they happened; overdue is placed on
              the item&apos;s due date, which can fall outside the range.
            </p>
            <VolumeBars
              label={`Applications submitted, decided and deadline items overdue per day, ${daySpan(points)}`}
              points={points}
              series={["submitted", "decided", "overdue"]}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
