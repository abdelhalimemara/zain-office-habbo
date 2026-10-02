import type { AuditProspect, SearchRun } from "../../../../../shared/audits";
import type { Budget } from "../budget";
import { onHost, siteHost } from "../url";
import type { SearchData, StepResult, WebsiteData } from "../types";

/** CRM categories (and common words) as the English and Arabic searches a customer would type. */
const CATEGORY_TERMS: Record<string, [string, string]> = {
  BEAUTY: ["beauty salon", "صالون تجميل"],
  SALON: ["beauty salon", "صالون نسائي"],
  SPA: ["spa", "سبا"],
  CLINIC: ["clinic", "عيادة"],
  DENTAL: ["dental clinic", "عيادة أسنان"],
  RESTAURANT: ["restaurant", "مطعم"],
  CAFE: ["cafe", "كافيه"],
  FITNESS: ["gym", "نادي رياضي"],
  GYM: ["gym", "نادي رياضي"],
  FASHION: ["fashion store", "متجر أزياء"],
  RETAIL: ["store", "متجر"],
  ECOMMERCE: ["online store", "متجر إلكتروني"],
  REAL_ESTATE: ["real estate", "عقارات"],
  LAW: ["law firm", "مكتب محاماة"],
  LEGAL: ["law firm", "مكتب محاماة"],
  EDUCATION: ["training center", "مركز تدريب"],
  AUTOMOTIVE: ["car service", "خدمة سيارات"],
  HOSPITALITY: ["hotel", "فندق"],
  FOOD: ["food delivery", "توصيل طعام"],
  JEWELRY: ["jewelry store", "مجوهرات"],
  PERFUME: ["perfume store", "عطور"],
  PETS: ["pet supplies", "مستلزمات الحيوانات الأليفة"],
  PET: ["pet supplies", "مستلزمات الحيوانات الأليفة"],
};

const CITY_AR: Record<string, string> = {
  riyadh: "الرياض",
  jeddah: "جدة",
  dammam: "الدمام",
  khobar: "الخبر",
  "al khobar": "الخبر",
  mecca: "مكة",
  makkah: "مكة",
  medina: "المدينة المنورة",
  madinah: "المدينة المنورة",
  abha: "أبها",
  taif: "الطائف",
  tabuk: "تبوك",
  buraidah: "بريدة",
};

/** Sites that show up for everything (social networks, marketplaces, directories): never counted as competitors. */
export const PLATFORMS =
  /(^|\.)(google\.[a-z.]+|youtube\.com|facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com|linkedin\.com|wikipedia\.org|snapchat\.com|pinterest\.com|tripadvisor\.[a-z.]+|yelp\.com|foursquare\.com|booking\.com|amazon\.[a-z.]+|noon\.com|haraj\.com\.sa|reddit\.com|flipkart\.com|daraz\.[a-z.]+|chewy\.com|etsy\.com|walmart\.com|ikea\.com|vocal\.media|medium\.com|behance\.net|bebee\.com|tabby\.sa|tamara\.co|yandex\.[a-z]+|blogspot\.com|wordpress\.com|apple\.com|namshi\.com|sivvi\.com|jarir\.com|extra\.com|aliexpress\.[a-z.]+|ebay\.[a-z.]+|temu\.com|shein\.com|maroof\.sa|yellowpages[a-z.]*|wego\.[a-z.]+|hungerstation\.com|jahez\.net|mrsool\.co|talabat\.com|careem\.com|mawdoo3\.com|quora\.com)$/i;

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** Interface text that headings often carry (carts, menus, prices) is not a service. */
const UI_TEXT = /\d|cart|basket|menu|login|log in|sign|account|search|items?\b|checkout|wishlist|home|سلة|حساب|القائمة|تسجيل|بحث/i;

function services(headings: readonly string[]): string[] {
  return headings
    .map((h) => h.replace(/[|•·:,-].*$/, "").trim())
    .filter((h) => h.split(/\s+/).length >= 2 && h.split(/\s+/).length <= 4 && h.length >= 5 && !UI_TEXT.test(h));
}

/**
 * Two brand searches first (quoted, and with the city), then up to six category searches in
 * Arabic and English: from the CRM category, else from the keywords Semrush says the site ranks for,
 * else from the site's own service headings.
 */
export function deriveQueries(prospect: AuditProspect, site?: WebsiteData, keywords: readonly string[] = []): { query: string; kind: SearchRun["kind"] }[] {
  const city = (prospect.city ?? "riyadh").trim().toLowerCase();
  const cityEn = titleCase(city);
  const cityAr = CITY_AR[city] ?? cityEn;
  const key = (prospect.category ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const [en, ar] = CATEGORY_TERMS[key] ?? (prospect.category ? [prospect.category.toLowerCase().replace(/_/g, " "), ""] : ["", ""]);
  const category: string[] = [];
  if (ar) category.push(ar, `${ar} ${cityAr}`, `أفضل ${ar} في ${cityAr}`);
  if (en) category.push(`${en} ${cityEn}`, `best ${en} in ${cityEn}`);
  const name = prospect.name.toLowerCase();
  // Semrush's keywords are what the market already searches (brand terms left out); the city keeps Google local.
  const marketTerms = keywords.filter((k) => !k.toLowerCase().includes(name) && !name.includes(k.toLowerCase())).slice(0, 4);
  for (const k of marketTerms) category.push(/[\u0600-\u06FF]/.test(k) ? `${k} ${cityAr}` : `${k} ${cityEn}`);
  if (marketTerms.length < 2) for (const s of services(site?.headings ?? []).slice(0, 2)) category.push(/[\u0600-\u06FF]/.test(s) ? `${s} ${cityAr}` : `${s} ${cityEn}`);
  const clean = (q: string) => q.replace(/\s+/g, " ").trim();
  const brand = clean(prospect.name);
  const targets = [...new Set(category.map(clean).filter((q) => q.length >= 3 && q.toLowerCase() !== brand.toLowerCase()))].slice(0, 6);
  // Two brand searches: Google sometimes reads a quoted name as a phrase to define, the city anchors it locally.
  return [
    { query: `"${brand}"`, kind: "brand" },
    { query: `${brand} ${cityEn}`, kind: "brand" },
    ...targets.filter((q) => q.toLowerCase() !== `${brand} ${cityEn}`.toLowerCase()).map((query) => ({ query, kind: "category" as const })),
  ];
}

export function searchInput(queries: readonly string[]): Record<string, unknown> {
  return { queries: queries.join("\n"), maxPagesPerQuery: 1, countryCode: "sa", saveHtml: false, saveHtmlToKeyValueStore: false, focusOnPaidAds: false };
}

interface SerpItem {
  searchQuery?: { term?: string };
  organicResults?: { url?: string; position?: number }[];
}

/** Result URLs without tracking parameters, and without Google's own local-pack links. */
function organic(item: SerpItem | undefined): { url: string; position: number }[] {
  return (item?.organicResults ?? [])
    .filter((r): r is { url: string; position?: number } => typeof r.url === "string" && !/^https?:\/\/(www\.)?google\.[a-z.]+\//i.test(r.url))
    .map((r, i) => ({ url: r.url.replace(/[?&]srsltid=[^&#]*/, ""), position: r.position ?? i + 1 }));
}

/** The brand's own profiles (from the CRM or linked on its site) count as the brand appearing. */
const ownProfile = (url: string, handles: readonly string[]) => handles.some((h) => url.toLowerCase().includes(h.replace(/^@/, "").replace(/^https?:\/\/(www\.)?/, "").toLowerCase()));

export function summarizeSearch(
  prospect: AuditProspect,
  queries: readonly { query: string; kind: SearchRun["kind"] }[],
  items: readonly Record<string, unknown>[],
  site?: WebsiteData,
): SearchData {
  const handles = [prospect.instagram, prospect.tiktok, prospect.x, prospect.facebook, ...Object.values(site?.socialLinks ?? {})].filter((h): h is string => !!h && h.length >= 3);
  const host = siteHost(prospect.website);
  const runs: SearchRun[] = queries.map(({ query, kind }) => {
    const results = organic((items as readonly SerpItem[]).find((i) => i.searchQuery?.term?.trim() === query));
    const domains = [...new Set(results.map((r) => siteHost(r.url)).filter(Boolean))];
    const present = results.some((r) => onHost(r.url, host)) || (kind === "brand" && results.some((r) => ownProfile(r.url, handles)));
    const others = domains.filter((d) => !onHost(d, host) && !(kind === "brand" && PLATFORMS.test(d))).slice(0, 5);
    return { query, kind, prospectPresent: present, others };
  });
  return { runs };
}

/** The brand verdict over both brand searches: present if either found the site or its own profiles. */
export function brandRun(runs: readonly SearchRun[] | undefined): SearchRun | undefined {
  const brand = (runs ?? []).filter((r) => r.kind === "brand");
  return brand.find((r) => r.prospectPresent) ?? brand[0];
}

/** Country-code TLDs other than Saudi Arabia's mark a foreign site; .co/.io/.ai/.me are used as generic TLDs. */
const GENERIC_CC = new Set(["sa", "co", "io", "ai", "me"]);
export const foreign = (domain: string) => {
  const tld = domain.split(".").at(-1) ?? "";
  return tld.length === 2 && !GENERIC_CC.has(tld);
};

/** A site on someone else's subdomain (ar.cats.com, brand.tenereteam.com) is a page, not a competitor's own site. */
const subdomain = (d: string) => d.split(".").length > (/\.(com|net|org|edu|gov)\.[a-z]{2}$/.test(d) ? 3 : 2);

/**
 * Up to six competitor candidates: the Saudi-plausible, non-platform domains seen most across the category
 * searches (.sa domains first among equals). The social step checks their home pages and keeps three.
 */
export function pickCompetitors(prospect: AuditProspect, search: SearchData | undefined, semrush: string[] = [], limit = 6): string[] {
  const host = siteHost(prospect.website);
  const counts = new Map<string, number>();
  for (const run of search?.runs ?? []) {
    if (run.kind !== "category") continue;
    run.others.forEach((d, i) => {
      if (!PLATFORMS.test(d) && !onHost(d, host) && !foreign(d) && !subdomain(d)) counts.set(d, (counts.get(d) ?? 0) + 10 - i + (/\.sa$/.test(d) ? 5 : 0));
    });
  }
  const fromSearch = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([d]) => d);
  // Semrush's organic competitors fill in, Saudi domains only (its global list is mostly unrelated sites).
  const fromSemrush = semrush.filter((d) => /\.sa$/.test(d) && !PLATFORMS.test(d) && !onHost(d, host));
  return [...new Set([...fromSearch, ...fromSemrush])].slice(0, limit);
}

export async function collectSearch(
  auditId: string,
  prospect: AuditProspect,
  site: WebsiteData | undefined,
  budget: Budget,
  keywords: readonly string[] = [],
): Promise<StepResult<SearchData>> {
  const queries = deriveQueries(prospect, site, keywords);
  const { items, costUsd } = await budget.run(auditId, "serp", searchInput(queries.map((q) => q.query)));
  const data = summarizeSearch(prospect, queries, items, site);
  const brand = data.runs.some((r) => r.kind === "brand" && r.prospectPresent) ? "brand owned" : "brand not found";
  const category = data.runs.filter((r) => r.kind === "category");
  return { status: "done", data, costUsd, note: `${brand}; present in ${category.filter((r) => r.prospectPresent).length} of ${category.length} category searches` };
}
