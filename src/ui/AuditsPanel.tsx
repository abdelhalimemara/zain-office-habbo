import type { ProspectAudit } from "@shared/audits";
import { useAudits } from "../api/auditHooks";
import { useUiStore } from "../state/store";
import { AuditDetail } from "./AuditDetail";
import { AuditStatusChip, GradeBadge, StepDots } from "./AuditBits";
import { auditCost, AUDITS_COLOR, domainOf, formatCost, isAuditActive, prospectLabel, sortAudits } from "./auditModel";
import { ErrorNote } from "./common";
import { absoluteTime, relativeTime } from "./mandates";
import { NewAuditForm } from "./NewAuditForm";
import { Panel } from "./Panel";

function AuditItem({ audit, now }: { audit: ProspectAudit; now: number }) {
  const openPanel = useUiStore((s) => s.openPanel);
  const name = prospectLabel(audit.prospect);
  const active = isAuditActive(audit);
  const cost = auditCost(audit);
  return (
    <li className={`zui-audit-item${active ? " zui-audit-item--active" : ""}`}>
      <button type="button" className="zui-audit-item__open" onClick={() => openPanel({ kind: "audits", id: audit.id })}>
        <span className="zui-audit-item__main">
          <span className="zui-audit-item__name">{name}</span>
          <span className="zui-audit-item__domain">{domainOf(audit.prospect.website)}</span>
        </span>
        {audit.score && (
          <span className="zui-audit-item__score">
            <GradeBadge grade={audit.score.grade} score={audit.score.overall} />
            <span className="zui-audit-item__points" aria-hidden="true">
              {Math.round(audit.score.overall)}
            </span>
          </span>
        )}
        <span className="zui-audit-item__meta">
          <AuditStatusChip status={audit.status} />
          <span title={absoluteTime(audit.createdAt)}>{relativeTime(audit.createdAt, now)}</span>
          {cost !== undefined && <span title="Apify spend">{formatCost(cost)}</span>}
        </span>
      </button>
      {active && <StepDots steps={audit.steps} />}
    </li>
  );
}

function AuditsList() {
  const { data, error, isPending } = useAudits();
  const openPanel = useUiStore((s) => s.openPanel);
  const audits = sortAudits(data?.audits ?? []);
  const now = Date.now() / 1000;
  return (
    <div className="zui-audits">
      <div className="zui-audits__intro">
        <p className="zui-hint">Scrape a prospect's website, search, social and ads, score them A to E and get a branded PDF filed in the CRM and Notion.</p>
        <button type="button" className="zui-btn zui-btn--primary" onClick={() => openPanel({ kind: "audits", compose: true })}>
          New audit
        </button>
      </div>
      <ErrorNote error={error} />
      {isPending && <p className="zui-hint">Loading audits…</p>}
      {data && audits.length === 0 && (
        <div className="zui-empty">
          <p>No prospect audits yet.</p>
          <p className="zui-hint">Start one from a CRM prospect or a website address.</p>
        </div>
      )}
      {audits.length > 0 && (
        <ul className="zui-audit-list" aria-label="Prospect audits">
          {audits.map((a) => (
            <AuditItem key={a.id} audit={a} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Zain Growth prospect audits: the list, the new-audit form (`compose`), or one audit (`id`). */
export function AuditsPanel({ id, compose }: { id?: string; compose?: boolean }) {
  const closePanel = useUiStore((s) => s.closePanel);
  const title = id ? "Prospect audit" : compose ? "New prospect audit" : "Prospect audits";
  return (
    <Panel title={title} accent={AUDITS_COLOR} onClose={closePanel} className="zui-panel--audits">
      {id ? <AuditDetail id={id} /> : compose ? <NewAuditForm /> : <AuditsList />}
    </Panel>
  );
}
