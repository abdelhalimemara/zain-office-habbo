import type { AuditProspect, BenchmarkRow, ProspectAudit } from "../../../../shared/audits";
import { shortDate } from "./dates";
import { siteHost } from "./url";
import type { CollectedData, Competitor } from "./types";

/** "pets-houses.com" → "Pets Houses": a readable name when the competitor's site gives none. */
export function nameFromDomain(domain: string): string {
  const label = domain.replace(/^www\./, "").split(".")[0] ?? domain;
  return label.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const dateLabel = (iso: string | undefined) => (iso ? shortDate(iso) : undefined);

/** The prospect first, then up to three competitors, on the same public measures. */
export function buildBenchmark(prospect: AuditProspect, data: CollectedData): BenchmarkRow[] {
  const prospectRow: Competitor = { domain: siteHost(prospect.website), name: prospect.name };
  // Three competitors at most: when the social step could not narrow the candidates, the first three stand.
  const businesses = [prospectRow, ...(data.competitors ?? []).slice(0, 3)];
  return businesses.map((b, i) => {
    const isProspect = i === 0;
    const g = data.ads?.google[b.domain];
    const m = data.ads?.meta[b.domain];
    const t = data.ads?.traffic[b.domain];
    const seo = isProspect ? data.seo?.read : data.seo?.competitors[b.domain];
    const igRow = data.social?.rows.find((r) => r.channel === "instagram");
    const ig = isProspect ? (igRow?.measured ? igRow.followers : undefined) : data.social?.competitorInstagram[b.domain];
    const row: BenchmarkRow = {
      name: b.name,
      domain: b.domain,
      isProspect,
      googleAds: !data.ads ? "not-measured" : g === undefined ? "not-measured" : g === "none" ? "none" : { active: g.active, formats: g.formats.join("/") || undefined, since: dateLabel(g.since) },
      metaAds: !data.ads ? "not-measured" : m === undefined ? "not-measured" : m === "none" ? "none" : { active: m.active, ...(m.pageName ? { note: m.pageName } : {}) },
      instagramFollowers: typeof ig === "number" ? ig : "not-measured",
      traffic: t ? { monthlyVisits: t.monthlyVisits, bounceRate: t.bounceRate, topSource: t.topSource, saudiShare: t.saudiShare, period: t.period } : "not-measured",
    };
    if (seo?.authorityScore !== undefined) row.authorityScore = seo.authorityScore;
    if (seo?.organicTraffic !== undefined) row.organicTraffic = seo.organicTraffic;
    return row;
  });
}

/** The public parts of the collected data, as the contract's ProspectAudit fields. */
export function publicView(audit: ProspectAudit, data: CollectedData): Partial<ProspectAudit> {
  return {
    benchmark: buildBenchmark(audit.prospect, data),
    ...(data.search ? { searchRuns: data.search.runs } : {}),
    ...(data.social ? { social: data.social.rows } : {}),
    ...(data.seo ? { seo: data.seo.read } : {}),
  };
}
