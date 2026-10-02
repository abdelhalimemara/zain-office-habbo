import type { SeoRead, Severity } from "../../../../../shared/audits";
import type { Budget } from "../budget";
import { siteHost } from "../url";
import type { SeoData } from "../types";

type Item = Record<string, unknown>;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const obj = (v: unknown): Item => (v && typeof v === "object" && !Array.isArray(v) ? (v as Item) : {});
const arr = (v: unknown): Item[] => (Array.isArray(v) ? v.filter((x): x is Item => !!x && typeof x === "object") : []);

export const semrushSource = (asOf: string) => `Semrush via Apify, ${asOf}`;

/** pro100chok/semrush-scraper, domain mode, Saudi database: one item per domain. */
export const semrushDomainsInput = (domains: readonly string[]) => ({ mode: "domain", domains: [...domains], database: "sa", include_moz: false });
/** The same actor's one-page technical audit of the home page. */
export const semrushAuditInput = (website: string) => ({ mode: "seo_audit", domains: [website], database: "sa" });

/** Technical issues from the audit-mode item, worst first. */
export function auditIssues(page: Item | undefined): SeoRead["issues"] {
  if (!page) return [];
  const issues: SeoRead["issues"] = [];
  const add = (title: string, severity: Severity, count?: number) => issues.push({ title, severity, ...(count !== undefined ? { count } : {}) });
  if (page.has_sitemap === false) add("No XML sitemap", "high");
  if (num(page.h1_count) === 0) add("Home page has no H1 heading", "high");
  if (page.has_robots_txt === false) add("No robots.txt", "medium");
  const missingAlt = num(page.images_missing_alt);
  if (missingAlt) add("Images missing alt text on the home page", missingAlt > 10 ? "medium" : "low", missingAlt);
  const titleLength = num(page.title_length) ?? 0;
  if (!titleLength) add("Home page has no title", "high");
  else if (titleLength < 20 || titleLength > 65) add(`Home page title is ${titleLength} characters (aim for 30-60)`, "low");
  if (!num(page.meta_description_length)) add("Home page has no meta description", "medium");
  if ((num(page.response_time_ms) ?? 0) > 1500) add(`Slow first response (${num(page.response_time_ms)} ms)`, "medium");
  if ((num(page.page_size_bytes) ?? 0) > 3_000_000) add(`Heavy home page (${Math.round((num(page.page_size_bytes) ?? 0) / 1e6)} MB)`, "medium");
  if (num(page.structured_data_blocks) === 0) add("No structured data on the home page", "low");
  if (typeof page.canonical !== "string" || !page.canonical) add("No canonical URL on the home page", "low");
  const order: Severity[] = ["critical", "high", "medium", "low"];
  return issues.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
}

/** The prospect's SeoRead from its domain-mode item (and the audit-mode item for issues). */
export function seoRead(domainItem: Item | undefined, auditItem: Item | undefined, asOf: string): SeoRead {
  const d = obj(domainItem);
  const organic = obj(d.organic);
  const fallback = obj(obj(auditItem).semrush);
  const keywords = arr(organic.top_keywords).length ? arr(organic.top_keywords) : arr(fallback.top_organic_keywords);
  const topKeywords = keywords
    .map((k) => ({ keyword: String(k.keyword ?? ""), position: num(k.position) ?? 0, volume: num(k.volume), url: typeof k.url === "string" ? k.url : undefined, traffic: num(k.traffic) }))
    .filter((k) => k.keyword && k.position > 0);
  // Semrush gives no top-pages list here: pages are ranked by the traffic of the keywords they rank for.
  const pages = new Map<string, number>();
  for (const k of topKeywords) if (k.url) pages.set(k.url, (pages.get(k.url) ?? 0) + (k.traffic ?? 0));
  const competitors = (arr(organic.competitors).length ? arr(organic.competitors) : arr(fallback.organic_competitors))
    .map((c) => ({ domain: String(c.domain ?? ""), commonKeywords: num(c.common_keywords) }))
    .filter((c) => c.domain);
  return {
    source: semrushSource(asOf),
    authorityScore: num(d.authority_score) ?? num(fallback.authority_score),
    organicKeywords: num(d.organic_keywords) ?? num(fallback.organic_keywords_count),
    organicTraffic: num(d.organic_traffic) ?? num(fallback.organic_traffic),
    backlinks: num(d.backlinks) ?? num(fallback.backlinks),
    referringDomains: num(d.referring_domains) ?? num(fallback.referring_domains),
    topKeywords: topKeywords.slice(0, 10).map(({ traffic: _t, ...k }) => k),
    topPages: [...pages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([url, traffic]) => ({ url, traffic })),
    issues: auditIssues(auditItem),
    competitors: competitors.slice(0, 6),
  };
}

const byDomain = (items: readonly Item[], domain: string) => items.find((i) => siteHost(`https://${String(i.domain ?? "")}`) === domain);

/** Home-page audit first (runs alongside the searches); the competitors' numbers once they are known. */
export async function semrushAudit(auditId: string, website: string, budget: Budget): Promise<{ item?: Item; costUsd: number }> {
  const r = await budget.run(auditId, "semrushAudit", semrushAuditInput(website));
  return { item: r.items[0], costUsd: r.costUsd };
}

/** The prospect's domain read (overview, keywords, organic competitors); run before the competitors are known. */
export async function semrushProspect(auditId: string, website: string, budget: Budget): Promise<{ item?: Item; costUsd: number }> {
  const host = siteHost(website);
  const r = await budget.run(auditId, "semrush", semrushDomainsInput([host]));
  return { item: byDomain(r.items, host), costUsd: r.costUsd };
}

/** Semrush's organic competitors: the domains ranking for the same keywords, most keywords in common first. */
export function keywordOverlap(prospectItem: Item | undefined, auditItem: Item | undefined): { domain: string; commonKeywords: number }[] {
  const organic = arr(obj(obj(prospectItem).organic).competitors);
  const list = organic.length ? organic : arr(obj(obj(auditItem).semrush).organic_competitors);
  const self = siteHost(`https://${String(obj(prospectItem).domain ?? "")}`);
  return list
    .map((c) => ({ domain: siteHost(`https://${String(c.domain ?? "")}`), commonKeywords: num(c.common_keywords) ?? 0 }))
    .filter((c) => c.domain && c.domain !== self)
    .sort((a, b) => b.commonKeywords - a.commonKeywords);
}

/** The keywords a domain ranks for, from its Semrush domain read. */
export function rankingKeywords(item: Item | undefined): string[] {
  return arr(obj(obj(item).organic).top_keywords).map((k) => String(k.keyword ?? "")).filter(Boolean);
}

/** Authority, organic traffic and keywords for the competitor candidates (one run). */
export async function semrushNumbers(
  auditId: string,
  domains: readonly string[],
  budget: Budget,
): Promise<{ numbers: SeoData["competitors"]; items: Record<string, Item>; costUsd: number }> {
  if (!domains.length) return { numbers: {}, items: {}, costUsd: 0 };
  const r = await budget.run(auditId, "semrush", semrushDomainsInput(domains));
  const numbers: SeoData["competitors"] = {};
  const items: Record<string, Item> = {};
  for (const d of domains) {
    const item = byDomain(r.items, d);
    if (!item) continue;
    items[d] = item;
    numbers[d] = { authorityScore: num(item.authority_score), organicTraffic: num(item.organic_traffic), organicKeywords: num(item.organic_keywords) };
  }
  return { numbers, items, costUsd: r.costUsd };
}

/** The SEO read: the prospect's numbers and technical issues, with its keyword-overlap competitors. */
export function buildSeo(prospectItem: Item | undefined, auditItem: Item | undefined, numbers: SeoData["competitors"], asOf: string): SeoData {
  const read = seoRead(prospectItem, auditItem, asOf);
  for (const c of read.competitors) c.authorityScore ??= numbers[c.domain]?.authorityScore;
  return { read, competitors: numbers };
}
