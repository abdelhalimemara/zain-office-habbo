import type { AuditAnalysis, AuditStep } from "@shared/audits";
import {
  formatCost,
  formatDuration,
  isApifyMissing,
  orderedSteps,
  STEP_LABEL,
  STEP_STATUS_LABEL,
  stepDuration,
} from "./auditModel";

export function ApifyHint() {
  return (
    <div className="zui-audit-hint" role="note">
      <strong>Apify is not connected.</strong> Add <code>APIFY_TOKEN</code> to <code>~/.hermes/.env</code>, restart Zain HQ, then retry the audit.
    </div>
  );
}

export function StepTimeline({ steps, now }: { steps: readonly AuditStep[]; now: number }) {
  return (
    <ol className="zui-audit-timeline" aria-label="Steps">
      {orderedSteps(steps).map((s) => {
        const took = stepDuration(s, now);
        return (
          <li key={s.id} className={`zui-audit-step zui-audit-step--${s.status}`}>
            <span className="zui-audit-step__mark" aria-hidden="true" />
            <div className="zui-audit-step__body">
              <div className="zui-audit-step__top">
                <span className="zui-audit-step__label">{STEP_LABEL[s.id]}</span>
                <span className="zui-audit-step__status">{STEP_STATUS_LABEL[s.status]}</span>
                {took !== null && <span className="zui-audit-step__time">{formatDuration(took)}</span>}
                {s.costUsd !== undefined && <span className="zui-audit-step__cost">{formatCost(s.costUsd)}</span>}
              </div>
              {s.note && <p className={`zui-audit-step__note${isApifyMissing(s.note) ? " zui-audit-step__note--warn" : ""}`}>{s.note}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Level({ value }: { value: "high" | "medium" | "low" }) {
  return <span className={`zui-level zui-level--${value}`}>{value} impact</span>;
}

const EFFORT_LABEL = { S: "Small effort", M: "Medium effort", L: "Large effort" } as const;

export function Opportunities({ items }: { items: AuditAnalysis["opportunities"] }) {
  if (items.length === 0) return <p className="zui-hint">No opportunities listed.</p>;
  return (
    <ul className="zui-audit-cards" aria-label="Opportunities">
      {items.map((o) => (
        <li key={o.title} className="zui-audit-card">
          <div className="zui-audit-card__top">
            <strong>{o.title}</strong>
          </div>
          <div className="zui-row zui-audit-card__tags">
            <span className="zui-chip">{o.service}</span>
            <Level value={o.impact} />
            <span className="zui-level zui-level--effort" title={EFFORT_LABEL[o.effort]}>
              <span aria-hidden="true">Effort {o.effort}</span>
              <span className="zui-sr-only">{EFFORT_LABEL[o.effort]}</span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
