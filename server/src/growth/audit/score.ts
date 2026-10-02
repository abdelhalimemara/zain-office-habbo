import { AUDIT_AREAS, type AreaResult, type AreaStatus, type AuditArea, type AuditProspect, type AuditScore, type Evidence, type Grade, type Severity } from "../../../../shared/audits";
import { semrushSource } from "./collect/seo";
import { siteHost } from "./url";
import type { CollectedData, SocialData } from "./types";

/**
 * Deterministic scoring of the Digital Gap Audit's seven areas. Each area is 0..100 from fixed point tables
 * over the parts that were measured (a part with no data is left out of that area's maximum); an area with
 * no data at all is "not measured" and its weight goes to the others. Not measured is coverage, not zero.
 *
 * website      20%  crawl: titles 15, metas 15, one H1 10, depth 15 (300+ words), alt text 10, schema 10, https 10,
 *                   viewport 5, internal links 5, Arabic+English 5; minus Semrush technical issues (high 8, medium 4, low 1; max 25)
 * brand        10%  brand search returns the site or its profiles 60, social profiles linked 15, Google Maps listing 25
 * search       20%  present in category searches (share) 60, Semrush organic traffic vs the best competitor 25 (log scale),
 *                   organic keywords 15 (100+ = full)
 * social       15%  audience 40 (all followers vs category benchmark, log); on the main channel: cadence 35 (12+ posts in
 *                   30 days), engagement 25 (3%+)
 * performance  20%  tags 60 (GA4 18, GTM 12, Meta pixel 12, Google Ads conversion 8, TikTok 5, Snap 5),
 *                   paid presence 40 (active Google ads 20, attributable Meta ads 20)
 * conversion    5%  checkout, forms and CRM are not visible from public pages: always not measured (contact paths are noted)
 * reputation   10%  Google Maps rating 60 (of 5 stars), review count 40 (100+ = full)
 *
 * Status: strong >= 75, fair >= 45, else weak. Severity: weak = high, fair = medium (low from 60); performance is
 * critical when ads run with neither GA4 nor GTM (spend without measurement). Grade: A >= 85, B >= 70, C >= 55, D >= 40, else E.
 */
export const WEIGHTS: Record<AuditArea, number> = { website: 0.2, brand: 0.1, search: 0.2, social: 0.15, performance: 0.2, conversion: 0.05, reputation: 0.1 };

const FOLLOWER_BENCHMARKS: Record<string, number> = {
  BEAUTY: 15_000,
  SALON: 10_000,
  RESTAURANT: 20_000,
  CAFE: 15_000,
  FASHION: 30_000,
  ECOMMERCE: 30_000,
  CLINIC: 8_000,
  DENTAL: 5_000,
  LAW: 3_000,
  REAL_ESTATE: 8_000,
};
const DEFAULT_BENCHMARK = 10_000;

export const lcFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const pct = (share: number) => `${Math.round(share * 100)}%`;
const fmt = (n: number) => n.toLocaleString("en-US");
const log = (n: number, full: number) => (n > 0 ? Math.min(1, Math.log10(n + 1) / Math.log10(full + 1)) : 0);

export function gradeFor(overall: number): Grade {
  return overall >= 85 ? "A" : overall >= 70 ? "B" : overall >= 55 ? "C" : overall >= 40 ? "D" : "E";
}

export function statusFor(score: number): Exclude<AreaStatus, "not-measured"> {
  return score >= 75 ? "strong" : score >= 45 ? "fair" : "weak";
}

/** Labels every fact with how it is known and where it came from. */
export interface Sources {
  crawl: string;
  search: string;
  semrush: string;
  social: string;
  googleAds: string;
  meta: string;
  traffic: (period: string) => string;
  maps: string;
}

export function sources(asOf: string): Sources {
  return {
    crawl: `Website crawl (Apify), ${asOf}`,
    search: `Google search, SA (Apify, live), ${asOf}`,
    semrush: semrushSource(asOf),
    social: `Social profiles (Apify), ${asOf}`,
    googleAds: `Google Ads Transparency Center (Apify), SA, ${asOf}`,
    meta: `Meta Ad Library (Apify), SA, ${asOf}`,
    traffic: (period) => `Similarweb via Apify, ${period}`,
    maps: `Google Maps (Apify), ${asOf}`,
  };
}

interface Draft {
  parts: [points: number, max: number][];
  summary: string;
  evidence: Evidence[];
  critical?: boolean;
}

const q = (text: string, source: string): Evidence => ({ text, kind: "quoted", source });
const est = (text: string, source: string): Evidence => ({ text, kind: "estimated", source });
const nm = (text: string, source: string): Evidence => ({ text, kind: "not-measured", source });

function websiteArea(d: CollectedData, s: Sources): Draft | null {
  const w = d.website;
  if (!w) return null;
  const alt = w.images ? 1 - w.imagesNoAlt / w.images : 1;
  const parts: [number, number][] = [
    [15 * w.goodTitles, 15],
    [15 * w.goodMetas, 15],
    [10 * w.oneH1, 10],
    [15 * Math.min(1, w.avgWords / 300), 15],
    [10 * alt, 10],
    [w.schemaTypes.length ? 10 : 0, 10],
    [w.https ? 10 : 0, 10],
    [w.viewport ? 5 : 0, 5],
    [5 * Math.min(1, w.avgInternalLinks / 10), 5],
    [w.arabicPages > 0 && w.englishPages > 0 ? 5 : 2, 5],
  ];
  const issues = d.seo?.read.issues ?? [];
  const penalty = Math.min(25, issues.reduce((n, i) => n + (i.severity === "high" || i.severity === "critical" ? 8 : i.severity === "medium" ? 4 : 1), 0));
  if (penalty) parts.push([-penalty, 0]);
  const evidence: Evidence[] = [
    q(`${w.pages} pages crawled${w.platform ? ` on ${w.platform}` : ""}; ${pct(w.goodMetas)} have a usable meta description, ${pct(w.oneH1)} exactly one H1`, s.crawl),
    q(w.schemaTypes.length ? `Schema.org markup present (${w.schemaTypes.slice(0, 3).join(", ")})` : "No schema.org markup found", s.crawl),
  ];
  if (issues.length) evidence.push(est(`Technical issues: ${issues.slice(0, 3).map((i) => lcFirst(i.title)).join("; ")}`, s.semrush));
  if (d.seo?.read.authorityScore !== undefined) evidence.push(est(`Authority score ${d.seo.read.authorityScore}, ${fmt(d.seo.read.referringDomains ?? 0)} referring domains`, s.semrush));
  const weakest = [
    !w.https && "not fully on HTTPS",
    !w.schemaTypes.length && "no schema markup",
    w.goodMetas < 0.5 && "most pages lack a meta description",
    w.oneH1 < 0.5 && "most pages lack a single H1",
    w.avgWords < 150 && "thin page content",
    issues[0] && lcFirst(issues[0].title),
  ].filter(Boolean) as string[];
  const summary = `${w.platform ? `${w.platform} site; ` : ""}${w.schemaTypes.length ? "schema markup present" : "no schema markup"}${weakest.length ? `; ${weakest.slice(0, 2).join(", ")}` : "; no material on-page gaps"}.`;
  return { parts, summary: summary[0]!.toUpperCase() + summary.slice(1), evidence };
}

function brandArea(d: CollectedData, p: AuditProspect, s: Sources): Draft | null {
  const brand = d.search?.runs.find((r) => r.kind === "brand");
  const maps = d.ads?.maps;
  const linked = Object.keys(d.website?.socialLinks ?? {}).length + (d.social?.rows.filter((r) => r.measured).length ?? 0);
  if (!brand && maps === undefined) return null;
  const parts: [number, number][] = [];
  const evidence: Evidence[] = [];
  if (brand) {
    parts.push([brand.prospectPresent ? 60 : 0, 60]);
    evidence.push(q(brand.prospectPresent ? `A search for "${p.name}" returns the official site or its profiles` : `A search for "${p.name}" does not return the official site`, s.search));
  }
  if (d.website || d.social) parts.push([linked > 0 ? 15 : 0, 15]);
  if (maps !== undefined) {
    parts.push([maps === "none" ? 0 : 25, 25]);
    evidence.push(maps === "none" ? q("No Google Maps listing matched the business", s.maps) : q(`Google Maps listing: ${maps.title}${maps.category ? ` (${maps.category})` : ""}`, s.maps));
  } else evidence.push(nm("Google Maps listing not checked this pass", s.maps));
  const summary = [
    brand ? (brand.prospectPresent ? `A live search for "${p.name}" returns the brand's own site or profiles` : `"${p.name}" does not return the official site in a live search`) : "",
    maps === undefined ? "the Maps listing was not measured" : maps === "none" ? "no Google Maps listing matched" : "a Google Maps listing exists",
  ].filter(Boolean);
  return { parts, summary: `${summary.join("; ")}.`, evidence };
}

function searchArea(d: CollectedData, s: Sources): Draft | null {
  const category = d.search?.runs.filter((r) => r.kind === "category") ?? [];
  const seo = d.seo;
  if (!category.length && !seo) return null;
  const parts: [number, number][] = [];
  const evidence: Evidence[] = [];
  let summary = "";
  if (category.length) {
    const present = category.filter((r) => r.prospectPresent).length;
    parts.push([60 * (present / category.length), 60]);
    const rivals = [...new Set(category.flatMap((r) => r.others))].filter((o) => (d.competitors ?? []).some((c) => c.domain === o)).slice(0, 2);
    summary = present
      ? `Present in ${present} of ${category.length} live category searches`
      : `Absent from ${category.length} live category searches${rivals.length ? ` where ${rivals.join(" and ")} appear` : ""}`;
    evidence.push(q(`${summary}`, s.search));
  }
  if (seo) {
    const own = seo.read.organicTraffic ?? 0;
    const best = Math.max(0, ...Object.values(seo.competitors).map((c) => c.organicTraffic ?? 0));
    if (best > 0 || own > 0) parts.push([25 * (best > 0 ? Math.min(1, log(own, best)) : 1), 25]);
    parts.push([15 * log(seo.read.organicKeywords ?? 0, 100), 15]);
    evidence.push(est(`${fmt(seo.read.organicKeywords ?? 0)} ranking keywords, ~${fmt(own)} organic visits a month${best ? ` (best competitor ~${fmt(best)})` : ""}`, s.semrush));
    if (!summary) summary = `~${fmt(own)} estimated organic visits a month from ${fmt(seo.read.organicKeywords ?? 0)} keywords`;
  }
  return { parts, summary: `${summary}.`, evidence };
}

function socialArea(d: CollectedData, category: string | undefined, s: Sources): Draft | null {
  const rows = (d.social as SocialData | undefined)?.rows.filter((r) => r.measured) ?? [];
  if (!rows.length) return null;
  const benchmark = FOLLOWER_BENCHMARKS[(category ?? "").toUpperCase()] ?? DEFAULT_BENCHMARK;
  const followers = rows.reduce((n, r) => n + (r.followers ?? 0), 0);
  // Cadence and engagement are the main channel's (most followers): a tiny side account's rate says little.
  const lead = rows.reduce((a, b) => ((b.followers ?? 0) > (a.followers ?? 0) ? b : a));
  const cadence = lead.postsPer30Days ?? 0;
  const rate = lead.engagement ?? 0;
  const parts: [number, number][] = [
    [40 * log(followers, benchmark), 40],
    [35 * Math.min(1, cadence / 12), 35],
    [25 * Math.min(1, rate / 0.03), 25],
  ];
  const unmeasured = d.social!.rows.filter((r) => !r.measured).map((r) => r.channel);
  return {
    parts,
    summary: `${lead.channel[0]!.toUpperCase()}${lead.channel.slice(1)} is the main channel: ${fmt(lead.followers ?? 0)} followers, about ${lead.postsPer30Days ?? 0} posts a month, ${((lead.engagement ?? 0) * 100).toFixed(2)}% engagement${unmeasured.length ? `; ${unmeasured.length} other channels not measured` : ""}.`,
    evidence: [
      ...rows.map((r) => q(`${r.channel}: ${fmt(r.followers ?? 0)} followers, ${r.postsPer30Days ?? 0} posts in 30 days, ${((r.engagement ?? 0) * 100).toFixed(2)}% engagement`, s.social)),
      ...(unmeasured.length ? [nm(`${unmeasured.join(", ")} not measured this pass`, s.social)] : []),
    ],
  };
}

function performanceArea(d: CollectedData, domain: string, s: Sources): Draft | null {
  const t = d.website?.trackers;
  const g = d.ads?.google[domain];
  const m = d.ads?.meta[domain];
  if (!t && g === undefined && m === undefined) return null;
  const parts: [number, number][] = [];
  const evidence: Evidence[] = [];
  if (t) {
    parts.push([(t.ga4 ? 18 : 0) + (t.gtm ? 12 : 0) + (t.metaPixel ? 12 : 0) + (t.googleAdsConversion ? 8 : 0) + (t.tiktokPixel ? 5 : 0) + (t.snapPixel ? 5 : 0), 60]);
    const missing = [!t.ga4 && "GA4", !t.gtm && "GTM", !t.metaPixel && "Meta", !t.tiktokPixel && "TikTok", !t.snapPixel && "Snap"].filter(Boolean);
    evidence.push(q(missing.length ? `${missing.join(", ")} tags not found on the page` : "GA4, GTM, Meta, TikTok and Snap tags all found", s.crawl));
  }
  const googleActive = g && g !== "none" ? g.active : 0;
  const metaActive = m && m !== "none" ? m.active : 0;
  if (g !== undefined) {
    parts.push([googleActive ? 20 : 0, 20]);
    evidence.push(q(g === "none" ? "No ads in the Google Ads Transparency Center" : `${g.active} active Google ads (${g.total} found)`, s.googleAds));
  }
  if (m !== undefined) {
    parts.push([metaActive ? 20 : 0, 20]);
    evidence.push(q(m === "none" ? "No Meta ads attributable to the brand" : `${m.active} active Meta ads`, s.meta));
  }
  const spending = googleActive + metaActive > 0;
  const blind = !!t && !t.ga4 && !t.gtm;
  const paid = [googleActive && `${googleActive} active Google ads`, metaActive && `${metaActive} active Meta ads`].filter(Boolean).join(" and ") || "No active paid ads found";
  const tags = t ? (blind ? "but neither GA4 nor GTM is on the page" : `with ${[t.ga4 && "GA4", t.gtm && "GTM", t.metaPixel && "Meta pixel"].filter(Boolean).join(", ") || "few tags"} in place`) : "";
  return { parts, summary: `${paid}${tags ? `, ${tags}` : ""}.`, evidence, critical: spending && blind };
}

function conversionArea(d: CollectedData, s: Sources): Draft {
  const paths = d.website?.contactPaths ?? [];
  return {
    parts: [],
    summary: "Checkout flow, forms and CRM connection are not visible from public pages.",
    evidence: [
      nm("No backend access: conversion rate and CRM follow-up cannot be read from outside", "not measured (no backend access)"),
      ...(paths.length ? [q(`Contact paths on the site: ${paths.join(", ")}`, s.crawl)] : []),
    ],
  };
}

function reputationArea(d: CollectedData, s: Sources): Draft | null {
  const maps = d.ads?.maps;
  if (!maps || maps === "none" || maps.rating === undefined) return null;
  const reviews = maps.reviews ?? 0;
  return {
    parts: [
      [60 * (maps.rating / 5), 60],
      [40 * log(reviews, 100), 40],
    ],
    summary: `Google Maps: ${maps.rating.toFixed(1)} stars from ${fmt(reviews)} reviews${reviews < 20 ? " (a thin review base)" : ""}.`,
    evidence: [
      q(`${maps.rating.toFixed(1)} stars, ${fmt(reviews)} reviews on Google Maps`, s.maps),
      ...(d.website?.reviewsOnSite ? [q("The site shows customer reviews of its own (self-published)", s.crawl)] : []),
    ],
  };
}

function notMeasured(area: AuditArea, d: CollectedData, s: Sources): Pick<AreaResult, "summary" | "evidence"> {
  const reasons: Record<AuditArea, [string, string]> = {
    website: ["The website could not be crawled this pass.", s.crawl],
    brand: ["Brand search and Maps listing were not checked this pass.", s.search],
    search: ["Category searches and Semrush were not available this pass.", s.search],
    social: ["No social profile could be found or measured this pass.", s.social],
    performance: ["Tags and ad libraries were not read this pass.", s.crawl],
    conversion: ["Checkout flow, forms and CRM connection are not visible from public pages.", "not measured (no backend access)"],
    reputation: [d.ads?.maps === "none" ? "No Google Maps listing matched the business; rating and reviews not measured." : "Google Maps rating and reviews were not retrieved this pass.", s.maps],
  };
  const [summary, source] = reasons[area];
  return { summary, evidence: [nm(summary, source)] };
}

export function scoreAudit(data: CollectedData, prospect: AuditProspect, asOf = data.asOf ?? "this pass"): AuditScore {
  const s = sources(asOf);
  const domain = siteHost(prospect.website);
  const drafts: Record<AuditArea, Draft | null> = {
    website: websiteArea(data, s),
    brand: brandArea(data, prospect, s),
    search: searchArea(data, s),
    social: socialArea(data, prospect.category, s),
    performance: performanceArea(data, domain, s),
    conversion: null,
    reputation: reputationArea(data, s),
  };
  const scored = AUDIT_AREAS.filter((a) => drafts[a] && drafts[a]!.parts.some(([, max]) => max > 0));
  const total = scored.reduce((n, a) => n + WEIGHTS[a], 0);
  const areas: AreaResult[] = AUDIT_AREAS.map((area) => {
    const draft = drafts[area];
    if (!draft || !scored.includes(area)) {
      const extra = area === "conversion" ? conversionArea(data, s) : notMeasured(area, data, s);
      return { area, status: "not-measured", weight: 0, summary: extra.summary, evidence: extra.evidence };
    }
    const max = draft.parts.reduce((n, [, m]) => n + m, 0);
    const score = Math.round(clamp((draft.parts.reduce((n, [p]) => n + p, 0) / max) * 100));
    const status = statusFor(score);
    const severity: Severity | undefined = draft.critical ? "critical" : status === "weak" ? "high" : status === "fair" ? (score < 60 ? "medium" : "low") : undefined;
    return {
      area,
      status: draft.critical && status === "strong" ? "fair" : status,
      ...(severity ? { severity } : {}),
      score,
      weight: Math.round((WEIGHTS[area] / total) * 1000) / 1000,
      summary: draft.summary,
      evidence: draft.evidence,
    };
  });
  const overall = total ? Math.round(areas.reduce((n, a) => n + (a.score ?? 0) * (scored.includes(a.area) ? WEIGHTS[a.area] / total : 0), 0)) : 0;
  return { overall, grade: gradeFor(overall), areasMeasured: scored.length, areas };
}

export const gaps = (score: AuditScore) => score.areas.filter((a) => a.status === "fair" || a.status === "weak");
