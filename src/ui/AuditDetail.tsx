import type { ReactNode } from "react";
import { AUDITS_API, type ProspectAudit } from "@shared/audits";
import { useAudit, useCancelAudit, useRetryAudit } from "../api/auditHooks";
import { useUiStore } from "../state/store";
import { AuditStatusChip, GradeBadge, ScoreDial } from "./AuditBits";
import {
  apifyMissing,
  auditDate,
  auditCost,
  canCancel,
  canRetry,
  domainOf,
  formatCost,
  GRADE_HINT,
  isAuditActive,
  prospectLabel,
  safeHref,
  websiteHref,
} from "./auditModel";
import { AtAGlance, Benchmark, ExecutiveSummary, FixPhases, Gaps } from "./AuditReport";
import { SeoBlock } from "./AuditSeo";
import { ApifyHint, Opportunities, StepTimeline } from "./AuditSections";
import { ErrorNote } from "./common";
import { absoluteTime } from "./mandates";

/** A link styled as a button, or the same button disabled with the reason as its tooltip. */
function LinkButton({ href, children, missing }: { href: string | undefined; children: ReactNode; missing: string }) {
  if (!href) {
    return (
      <button type="button" className="zui-btn" disabled title={missing}>
        {children}
      </button>
    );
  }
  return (
    <a className="zui-btn" href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

function Actions({ audit }: { audit: ProspectAudit }) {
  const retry = useRetryAudit(audit.id);
  const cancel = useCancelAudit(audit.id);
  return (
    <>
      <div className="zui-row zui-audit-actions" aria-label="Audit actions" role="group">
        <LinkButton href={audit.pdfPath ? AUDITS_API.pdf(audit.id) : undefined} missing="The PDF is not ready yet">
          Open PDF
        </LinkButton>
        <LinkButton href={safeHref(audit.crmUrl)} missing="Not filed in the CRM yet">
          Open in CRM
        </LinkButton>
        <LinkButton href={safeHref(audit.notionPageUrl)} missing="No Notion row yet">
          Open in Notion
        </LinkButton>
        {canRetry(audit) && (
          <button type="button" className="zui-btn zui-btn--primary" onClick={() => retry.mutate()} disabled={retry.isPending}>
            {retry.isPending ? "Retrying…" : "Retry"}
          </button>
        )}
        {canCancel(audit) && (
          <button type="button" className="zui-btn zui-btn--danger" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            {cancel.isPending ? "Cancelling…" : "Cancel"}
          </button>
        )}
      </div>
      <ErrorNote error={retry.error ?? cancel.error} />
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="zui-audit-section" aria-label={title}>
      <h3 className="zui-subheading">{title}</h3>
      {children}
    </section>
  );
}

function Header({ audit }: { audit: ProspectAudit }) {
  const name = prospectLabel(audit.prospect);
  const cost = auditCost(audit);
  const meta = [audit.prospect.category, audit.prospect.city].filter(Boolean).join(" · ");
  return (
    <header className="zui-audit-head">
      <div className="zui-audit-head__text">
        <h3 className="zui-audit-head__name">{name}</h3>
        <a className="zui-audit-head__site" href={websiteHref(audit.prospect.website)} target="_blank" rel="noreferrer noopener">
          {domainOf(audit.prospect.website)}
        </a>
        {meta && <span className="zui-hint">{meta}</span>}
        <span className="zui-row zui-audit-head__meta">
          <AuditStatusChip status={audit.status} />
          <span className="zui-hint" title={absoluteTime(audit.createdAt)}>
            {auditDate(audit.createdAt)}
          </span>
          {cost !== undefined && <span className="zui-hint">Apify {formatCost(cost)}</span>}
        </span>
      </div>
      {audit.score && (
        <div className="zui-audit-head__score">
          <ScoreDial score={audit.score.overall} grade={audit.score.grade} />
          <div className="zui-audit-head__grade">
            <GradeBadge grade={audit.score.grade} size="lg" />
            <span className="zui-hint">{GRADE_HINT[audit.score.grade]}</span>
          </div>
        </div>
      )}
    </header>
  );
}

export function AuditBody({ audit, now }: { audit: ProspectAudit; now: number }) {
  const analysis = audit.analysis;
  const pipeline = (
    <Section title="Pipeline">
      <StepTimeline steps={audit.steps} now={now} />
    </Section>
  );
  const pipelineFirst = !analysis || isAuditActive(audit);
  return (
    <div className="zui-audit">
      <Header audit={audit} />
      {apifyMissing(audit) && <ApifyHint />}
      {audit.error && !apifyMissing(audit) && (
        <p className="zui-error" role="alert">
          {audit.error}
        </p>
      )}
      <Actions audit={audit} />
      {pipelineFirst && pipeline}
      {analysis?.pitchAngle && (
        <div className="zui-audit-pitch">
          <span className="zui-audit-pitch__label">Pitch angle</span>
          <p>{analysis.pitchAngle}</p>
        </div>
      )}
      {analysis && (
        <Section title="Executive summary">
          <ExecutiveSummary audit={audit} analysis={analysis} />
        </Section>
      )}
      {audit.score && (
        <Section title="The seven areas, at a glance">
          <AtAGlance score={audit.score} />
        </Section>
      )}
      {audit.benchmark && audit.benchmark.length > 0 && (
        <Section title="The competitive gap">
          <Benchmark rows={audit.benchmark} bottomLine={analysis?.bottomLines.competitive} />
        </Section>
      )}
      {audit.seo && (
        <Section title="SEO (Semrush)">
          <SeoBlock seo={audit.seo} />
        </Section>
      )}
      {analysis && (
        <>
          <Section title="The gaps">
            <Gaps findings={analysis.findings} score={audit.score} />
          </Section>
          {analysis.fix.length > 0 && (
            <Section title="The fix">
              <FixPhases analysis={analysis} />
            </Section>
          )}
          {analysis.opportunities.length > 0 && (
            <Section title="Opportunities">
              <Opportunities items={analysis.opportunities} />
            </Section>
          )}
        </>
      )}
      {!pipelineFirst && pipeline}
    </div>
  );
}

export function AuditDetail({ id }: { id: string }) {
  const { data, error, isPending } = useAudit(id);
  const openPanel = useUiStore((s) => s.openPanel);
  return (
    <>
      <button type="button" className="zui-link zui-audit-back" onClick={() => openPanel({ kind: "audits" })}>
        ‹ All audits
      </button>
      <ErrorNote error={error} />
      {isPending && <p className="zui-hint">Loading audit…</p>}
      {data && <AuditBody audit={data.audit} now={Date.now() / 1000} />}
    </>
  );
}
