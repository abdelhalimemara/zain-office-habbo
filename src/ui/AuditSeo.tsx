import type { SeoRead } from "@shared/audits";
import { SeverityPill } from "./AuditReport";
import { estimate, formatCount, groupIssues, SEVERITY_LABEL, urlPath } from "./gapReport";

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`zui-seo-tile${accent ? " zui-seo-tile--accent" : ""}`}>
      <dt>{label}</dt>
      <dd>
        {value}
        {value !== "—" && <span className="zui-seo-est"> est.</span>}
      </dd>
    </div>
  );
}

/** "SEO (Semrush, est.)": the domain's authority, organic reach, links, keywords, pages, issues and organic competitors. Every figure is an estimate. */
export function SeoBlock({ seo }: { seo: SeoRead }) {
  const groups = groupIssues(seo.issues);
  return (
    <div className="zui-seo">
      <p className="zui-seo-source">All figures are estimates. Source: {seo.source}</p>
      <dl className="zui-seo-tiles">
        <Tile label="Authority score" value={seo.authorityScore === undefined ? "—" : `${Math.round(seo.authorityScore)}/100`} accent />
        <Tile label="Organic keywords" value={estimate(seo.organicKeywords)} />
        <Tile label="Organic traffic / mo" value={estimate(seo.organicTraffic)} />
        <Tile label="Backlinks" value={estimate(seo.backlinks)} />
        <Tile label="Referring domains" value={estimate(seo.referringDomains)} />
      </dl>

      {seo.topKeywords.length > 0 && (
        <div className="zui-gap-table-wrap" role="region" aria-label="Top keywords table" tabIndex={0}>
          <table className="zui-gap-table zui-seo-table">
            <caption className="zui-seo-caption">Top keywords</caption>
            <thead>
              <tr>
                <th scope="col">Keyword</th>
                <th scope="col">Position</th>
                <th scope="col">Volume (est.)</th>
                <th scope="col">Page</th>
              </tr>
            </thead>
            <tbody>
              {seo.topKeywords.map((k) => (
                <tr key={k.keyword}>
                  <th scope="row">{k.keyword}</th>
                  <td>
                    <span className={`zui-seo-pos${k.position <= 3 ? " zui-seo-pos--top" : ""}`}>#{k.position}</span>
                  </td>
                  <td>{k.volume === undefined ? "—" : formatCount(k.volume)}</td>
                  <td>
                    <span className="zui-seo-url" title={k.url}>
                      {k.url ? urlPath(k.url) : "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="zui-seo-cols">
        {seo.topPages.length > 0 && (
          <section aria-label="Top pages" className="zui-seo-card">
            <h4>Top pages</h4>
            <ol className="zui-seo-list">
              {seo.topPages.map((p) => (
                <li key={p.url}>
                  <span className="zui-seo-url" title={p.url}>
                    {urlPath(p.url)}
                  </span>
                  <span className="zui-seo-num">{p.traffic === undefined ? "—" : `${estimate(p.traffic)} est.`}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        {seo.competitors.length > 0 && (
          <section aria-label="Organic competitors" className="zui-seo-card">
            <h4>Organic competitors</h4>
            <ol className="zui-seo-list">
              {seo.competitors.map((c) => (
                <li key={c.domain}>
                  <span>{c.domain}</span>
                  <span className="zui-seo-num">
                    {c.commonKeywords !== undefined && `${formatCount(c.commonKeywords)} shared keywords`}
                    {c.commonKeywords !== undefined && c.authorityScore !== undefined && " · "}
                    {c.authorityScore !== undefined && `AS ${Math.round(c.authorityScore)}`}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>

      {groups.length > 0 && (
        <section aria-label="Technical issues" className="zui-seo-card">
          <h4>Technical issues</h4>
          {groups.map((g) => (
            <div key={g.severity} className="zui-seo-group">
              <SeverityPill severity={g.severity} />
              <ul className="zui-seo-list" aria-label={`${SEVERITY_LABEL[g.severity]} issues`}>
                {g.issues.map((i) => (
                  <li key={i.title}>
                    <span>{i.title}</span>
                    {i.count !== undefined && <span className="zui-seo-num">{formatCount(i.count)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
