import type { AuditAnalysis, AuditScore, AuditStep } from "@shared/audits";
import {
  formatCost,
  formatDuration,
  groupFindings,
  isApifyMissing,
  orderedSteps,
  SECTION_LABEL,
  SECTIONS,
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

export function ScoreBars({ score }: { score: AuditScore }) {
  return (
    <ul className="zui-audit-bars" aria-label="Section scores">
      {SECTIONS.map((id) => {
        const section = score.sections[id];
        const value = Math.round(Math.max(0, Math.min(100, section.score)));
        return (
          <li key={id} className="zui-audit-bar">
            <div className="zui-audit-bar__top">
              <span className="zui-audit-bar__label">{SECTION_LABEL[id]}</span>
              <span className="zui-audit-bar__weight">{Math.round(section.weight * 100)}% weight</span>
              <span className="zui-audit-bar__value">{value}</span>
            </div>
            <div
              className="zui-audit-bar__track"
              role="meter"
              aria-label={`${SECTION_LABEL[id]} score`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={value}
            >
              <span className={`zui-audit-bar__fill zui-audit-bar__fill--${value >= 70 ? "good" : value >= 45 ? "mid" : "low"}`} style={{ width: `${value}%` }} />
            </div>
            {section.drivers.length > 0 && (
              <ul className="zui-audit-bar__drivers">
                {section.drivers.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Level({ kind, value }: { kind: "severity" | "impact"; value: "high" | "medium" | "low" }) {
  return <span className={`zui-level zui-level--${value}`}>{kind === "severity" ? value : `${value} impact`}</span>;
}

export function Findings({ findings }: { findings: AuditAnalysis["findings"] }) {
  const groups = groupFindings(findings);
  if (groups.length === 0) return <p className="zui-hint">No findings.</p>;
  return (
    <div className="zui-audit-findings">
      {groups.map((g) => (
        <section key={g.section} aria-label={`${SECTION_LABEL[g.section]} findings`}>
          <h4 className="zui-audit-group">{SECTION_LABEL[g.section]}</h4>
          <ul className="zui-audit-cards">
            {g.findings.map((f) => (
              <li key={f.title} className={`zui-audit-card zui-audit-card--${f.severity}`}>
                <div className="zui-audit-card__top">
                  <strong>{f.title}</strong>
                  <Level kind="severity" value={f.severity} />
                </div>
                <p>{f.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
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
            <Level kind="impact" value={o.impact} />
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

export function Competitors({ items }: { items: AuditAnalysis["competitors"] }) {
  if (items.length === 0) return <p className="zui-hint">No competitors found.</p>;
  return (
    <ul className="zui-audit-competitors" aria-label="Competitors">
      {items.map((c) => (
        <li key={c.name}>
          <strong>{c.name}</strong>
          {c.domain && <span className="zui-mono"> {c.domain}</span>}
          <p>{c.note}</p>
        </li>
      ))}
    </ul>
  );
}
