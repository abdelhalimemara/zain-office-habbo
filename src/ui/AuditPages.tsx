import type { SearchRun, SocialChannelRow, TagRead } from "@shared/audits";
import { CHANNEL_LABEL, countOrDash, formatRate, screenshotSrc } from "./gapReport";

/** The template's compact pages: What a Visitor Sees, Website and Technical, Search: Brand vs Category, Organic Social. */

function BottomLine({ text }: { text: string | undefined }) {
  return text ? <p className="zui-gap-bottom">{text}</p> : null;
}

/** "What a Visitor Sees": the mobile home-page capture as a thumbnail that opens full size. */
export function VisitorSees({ path, name }: { path: string | undefined; name: string }) {
  const src = screenshotSrc(path);
  if (!src) return <p className="zui-hint">No capture this pass.</p>;
  return (
    <a className="zui-gap-shot" href={src} target="_blank" rel="noreferrer noopener" title="Open full size">
      <img src={src} alt={`${name} home page on mobile`} loading="lazy" />
      <span className="zui-gap-shot__open">Open full size</span>
    </a>
  );
}

/** "Website and Technical": which tags the page carries. */
export function TagReadList({ tags }: { tags: readonly TagRead[] }) {
  return (
    <ul className="zui-gap-tags" aria-label="Tag and technical read">
      {tags.map((t) => (
        <li key={t.tag} className={`zui-gap-tag zui-gap-tag--${t.found ? "found" : "missing"}`}>
          <span className="zui-gap-tag__mark" aria-hidden="true">
            {t.found ? "✓" : "✕"}
          </span>
          <span>
            {t.tag}: {t.found ? "found" : "not found on the page"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "Search: Brand vs Category": one row per live search run. */
export function SearchRuns({ runs, domain, bottomLine }: { runs: readonly SearchRun[]; domain: string; bottomLine?: string }) {
  return (
    <>
      <div className="zui-gap-table-wrap" role="region" aria-label="Search runs table" tabIndex={0}>
        <table className="zui-gap-table zui-gap-table--runs">
          <thead>
            <tr>
              <th scope="col">Search run</th>
              <th scope="col">{domain} present?</th>
              <th scope="col">Who else appears</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={`${r.kind}:${r.query}`}>
                <th scope="row">
                  "{r.query}"<span className="zui-gap-source">{r.kind === "brand" ? "Brand search" : "Category search"}</span>
                </th>
                <td>
                  <span className={`zui-gap-pill zui-gap-pill--${r.prospectPresent ? "strong" : "weak"}`}>{r.prospectPresent ? "Yes" : "No"}</span>
                </td>
                <td>{r.others.length ? r.others.join(", ") : "No one else"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <BottomLine text={bottomLine} />
    </>
  );
}

/** "Organic Social": one row per channel; unmeasured channels say so instead of showing zeros. */
export function SocialRows({ rows, bottomLine }: { rows: readonly SocialChannelRow[]; bottomLine?: string }) {
  return (
    <>
      <div className="zui-gap-table-wrap" role="region" aria-label="Organic social table" tabIndex={0}>
        <table className="zui-gap-table zui-gap-table--social">
          <thead>
            <tr>
              <th scope="col">Channel</th>
              <th scope="col">Followers</th>
              <th scope="col">Posts</th>
              <th scope="col">Posts / 30 days</th>
              <th scope="col">Engagement</th>
              <th scope="col">Last post</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.channel}>
                <th scope="row">{CHANNEL_LABEL[r.channel]}</th>
                {r.measured ? (
                  <>
                    <td>{countOrDash(r.followers)}</td>
                    <td>{countOrDash(r.posts)}</td>
                    <td>{r.postsPer30Days === undefined ? "—" : r.postsPer30Days.toFixed(1)}</td>
                    <td>{formatRate(r.engagement)}</td>
                    <td>{r.lastPost ?? "—"}</td>
                  </>
                ) : (
                  <td colSpan={5} className="zui-gap-muted">
                    not measured this pass
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <BottomLine text={bottomLine} />
    </>
  );
}
