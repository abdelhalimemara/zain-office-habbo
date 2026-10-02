import type { AreaStatus, AuditAnalysis, AuditScore, BenchmarkRow, ProspectAudit, Severity } from "@shared/audits";
import {
  AREA_STATUS_LABEL,
  areaLabel,
  authorityCell,
  auditKpis,
  benchmarkRows,
  EVIDENCE_LABEL,
  evidenceLine,
  followersCell,
  formatCount,
  googleAdsCell,
  metaAdsCell,
  notMeasuredAreas,
  orderedAreas,
  organicCell,
  SEVERITY_LABEL,
  sortFindings,
  visitsCell,
} from "./gapReport";

export function StatusPill({ status }: { status: AreaStatus }) {
  return <span className={`zui-gap-pill zui-gap-pill--${status}`}>{AREA_STATUS_LABEL[status]}</span>;
}

export function SeverityPill({ severity }: { severity: Severity }) {
  return <span className={`zui-gap-pill zui-gap-pill--${severity}`}>{SEVERITY_LABEL[severity]}</span>;
}

function BottomLine({ text }: { text: string | undefined }) {
  if (!text) return null;
  return <p className="zui-gap-bottom">{text}</p>;
}

function Kpis({ audit }: { audit: ProspectAudit }) {
  const kpis = auditKpis(audit);
  if (!kpis) return null;
  return (
    <dl className="zui-gap-kpis">
      <div className="zui-gap-kpi">
        <dt>Gaps identified</dt>
        <dd>{kpis.gaps}</dd>
      </div>
      <div className="zui-gap-kpi">
        <dt>Rated critical</dt>
        <dd>{kpis.critical}</dd>
      </div>
      <div className="zui-gap-kpi">
        <dt>Areas measured</dt>
        <dd className="zui-gap-kpi__measured">
          {kpis.measured} of {kpis.total}
        </dd>
        {kpis.measured < kpis.total && <span className="zui-gap-kpi__note">{kpis.total - kpis.measured} not measurable this pass</span>}
      </div>
      <div className="zui-gap-kpi">
        <dt>Est. monthly visits</dt>
        <dd>{kpis.visits ? `~${formatCount(kpis.visits.value)}` : "—"}</dd>
        <span className="zui-gap-kpi__note">{kpis.visits ? `estimated, ${kpis.visits.period}` : "not measured"}</span>
      </div>
    </dl>
  );
}

/** Executive summary: headline, what we found, the four tiles, the three key-point cards and the bottom line. */
export function ExecutiveSummary({ audit, analysis }: { audit: ProspectAudit; analysis: AuditAnalysis }) {
  return (
    <div className="zui-gap-summary">
      {analysis.headline && <p className="zui-gap-headline">{analysis.headline}</p>}
      <span className="zui-gap-eyebrow">What we found</span>
      <p className="zui-gap-found">{analysis.executiveSummary}</p>
      <Kpis audit={audit} />
      {analysis.keyPoints.length > 0 && (
        <ol className="zui-gap-points" aria-label="Key points">
          {analysis.keyPoints.map((k, i) => (
            <li key={k.title} className={`zui-gap-point zui-gap-point--${(i % 3) + 1}`}>
              <span className="zui-gap-point__num" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <strong>{k.title}</strong>
                <p>{k.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <BottomLine text={analysis.bottomLines.summary} />
    </div>
  );
}

/** "The Seven Areas, At a Glance": status and severity pills, the one-line summary and its evidence. */
export function AtAGlance({ score }: { score: AuditScore }) {
  return (
    <div className="zui-gap-glance">
      <ul className="zui-gap-areas" aria-label="Seven areas">
        {orderedAreas(score.areas).map((a) => (
          <li key={a.area} className="zui-gap-area">
            <div className="zui-gap-area__top">
              <strong>{areaLabel(a.area)}</strong>
              <span className="zui-gap-area__pills">
                <StatusPill status={a.status} />
                {a.severity && <SeverityPill severity={a.severity} />}
              </span>
            </div>
            <p>{a.summary}</p>
            {a.evidence.length > 0 && <span className="zui-gap-source">{evidenceLine(a)}</span>}
          </li>
        ))}
      </ul>
      <p className="zui-gap-legend">
        Strong: nothing material missing. Fair: real gaps, fixable inside a programme. Weak: the area is missing or broken. Not measured: no public evidence either way, this pass.
      </p>
    </div>
  );
}

/** "The Competitive Gap": the prospect first, then competitors, same public measures. */
export function Benchmark({ rows, bottomLine }: { rows: readonly BenchmarkRow[]; bottomLine?: string }) {
  return (
    <>
      <div className="zui-gap-table-wrap" role="region" aria-label="Benchmark table" tabIndex={0}>
        <table className="zui-gap-table zui-gap-table--bench">
          <thead>
            <tr>
              <th scope="col">Business</th>
              <th scope="col">Google Ads</th>
              <th scope="col">Meta Ads</th>
              <th scope="col">Instagram followers</th>
              <th scope="col">Est. monthly visits</th>
              <th scope="col">Authority (est.)</th>
              <th scope="col">Organic traffic (est.)</th>
            </tr>
          </thead>
          <tbody>
            {benchmarkRows(rows).map((r) => (
              <tr key={r.name} className={r.isProspect ? "zui-gap-table__prospect" : undefined}>
                <th scope="row">
                  {r.name}
                  {r.domain && <span className="zui-gap-source">{r.domain}</span>}
                </th>
                <td>{googleAdsCell(r.googleAds)}</td>
                <td>{metaAdsCell(r.metaAds)}</td>
                <td>{followersCell(r.instagramFollowers)}</td>
                <td>{visitsCell(r.traffic)}</td>
                <td>{authorityCell(r.authorityScore)}</td>
                <td>{organicCell(r.organicTraffic)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <BottomLine text={bottomLine} />
    </>
  );
}

/** "The Gaps": findings ordered by severity, then the areas not measured this pass. */
export function Gaps({ findings, score }: { findings: AuditAnalysis["findings"]; score?: AuditScore }) {
  const missing = score ? notMeasuredAreas(score.areas) : [];
  return (
    <>
      {findings.length === 0 ? (
        <p className="zui-hint">No gaps found.</p>
      ) : (
        <ol className="zui-gap-cards" aria-label="Gaps">
          {sortFindings(findings).map((f, i) => (
            <li key={`${f.area}:${f.title}`} className="zui-gap-card">
              <div className="zui-gap-card__top">
                <span className="zui-gap-card__num" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <strong>{f.title}</strong>
                <SeverityPill severity={f.severity} />
              </div>
              <p>{f.detail}</p>
              <span className="zui-gap-source">
                {areaLabel(f.area)}
                {f.evidence && ` · ${EVIDENCE_LABEL[f.evidence]}`}
                {f.source && ` (${f.source})`}
              </span>
            </li>
          ))}
        </ol>
      )}
      {missing.length > 0 && <p className="zui-gap-bottom">Not measured this pass: {missing.map(areaLabel).join(", ")}.</p>}
    </>
  );
}

/** The three-phase fix, then the north star and the next step. */
export function FixPhases({ analysis }: { analysis: AuditAnalysis }) {
  const phases = [...analysis.fix].sort((a, b) => a.phase - b.phase);
  return (
    <>
      <ol className="zui-gap-points zui-gap-phases" aria-label="Fix phases">
        {phases.map((p) => (
          <li key={p.phase} className={`zui-gap-point zui-gap-point--${p.phase}`}>
            <span className="zui-gap-point__num" aria-hidden="true">
              {String(p.phase).padStart(2, "0")}
            </span>
            <div>
              <span className="zui-gap-eyebrow">
                Phase {p.phase} · {p.name}
              </span>
              <strong>{p.headline}</strong>
              <p>{p.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      {(analysis.northStar || analysis.nextStep) && (
        <dl className="zui-gap-north">
          {analysis.northStar && (
            <div>
              <dt>North star</dt>
              <dd>{analysis.northStar}</dd>
            </div>
          )}
          {analysis.nextStep && (
            <div>
              <dt>Next step</dt>
              <dd>{analysis.nextStep}</dd>
            </div>
          )}
        </dl>
      )}
    </>
  );
}
