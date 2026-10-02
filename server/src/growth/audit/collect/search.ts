import type { AuditProspect } from "../../../../../shared/audits";
import type { Budget } from "../budget";
import { onHost, siteHost } from "../url";
import type { QueryResult, SearchData, StepResult, WebsiteData } from "../types";

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

/** Hosts that rank for everything; they are listed but never counted as competitors. */
const PLATFORMS = /(^|\.)(google\.[a-z.]+|youtube\.com|facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com|linkedin\.com|wikipedia\.org|snapchat\.com|pinterest\.com|tripadvisor\.[a-z.]+|yelp\.com|foursquare\.com|booking\.com|amazon\.[a-z.]+|noon\.com|haraj\.com\.sa|reddit\.com|apple\.com)$/i;

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** The service a page heading names, when it is short enough to be one ("Laser hair removal"). */
function services(headings: readonly string[]): string[] {
  return headings.map((h) => h.replace(/[|•·:,-].*$/, "").trim()).filter((h) => h.split(/\s+/).length >= 1 && h.split(/\s+/).length <= 4 && h.length >= 4);
}

/** 5..8 target searches in English and Arabic from the category, city, services and brand. */
export function deriveQueries(prospect: AuditProspect, site?: WebsiteData): string[] {
  const city = (prospect.city ?? "riyadh").trim().toLowerCase();
  const cityEn = titleCase(city);
  const cityAr = CITY_AR[city] ?? cityEn;
  const key = (prospect.category ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const [en, ar] = CATEGORY_TERMS[key] ?? (prospect.category ? [prospect.category.toLowerCase().replace(/_/g, " "), ""] : ["", ""]);
  const queries: string[] = [];
  if (en) queries.push(`${en} ${cityEn}`, `best ${en} in ${cityEn}`);
  if (ar) queries.push(`${ar} ${cityAr}`, `أفضل ${ar} في ${cityAr}`);
  for (const s of services(site?.headings ?? []).slice(0, 3)) queries.push(/[؀-ۿ]/.test(s) ? `${s} ${cityAr}` : `${s} ${cityEn}`);
  if (queries.length < 4 && site?.title) queries.push(`${site.title.replace(/[|•·:-].*$/, "").trim()} ${cityEn}`);
  const clean = (q: string) => q.replace(/\s+/g, " ").trim();
  const brand = clean(prospect.name);
  const targets = [...new Set(queries.map(clean).filter((q) => q.length >= 3 && q !== brand))].slice(0, 7);
  // The brand search goes last: it shows whether they own their own name, and is not a competitor signal.
  return [...targets, brand];
}

export function searchInput(queries: readonly string[]): Record<string, unknown> {
  return {
    queries: queries.join("\n"),
    maxPagesPerQuery: 1,
    countryCode: "sa",
    languageCode: "ar",
    mobileResults: false,
    saveHtml: false,
    saveHtmlToKeyValueStore: false,
  };
}

interface SerpItem {
  searchQuery?: { term?: string };
  organicResults?: { url?: string; position?: number }[];
  paidResults?: unknown[];
}

export function summarizeSearch(website: string, queries: readonly string[], items: readonly Record<string, unknown>[]): SearchData {
  const host = siteHost(website);
  const results: QueryResult[] = [];
  const counts = new Map<string, number>();
  for (const query of queries) {
    const item = (items as readonly SerpItem[]).find((i) => i.searchQuery?.term?.trim() === query) ?? null;
    const organic = item?.organicResults ?? [];
    const mine = organic.find((r) => r.url && onHost(r.url, host));
    const domains = [...new Set(organic.map((r) => siteHost(r.url ?? "")).filter(Boolean))];
    const rivals = domains.filter((d) => !onHost(d, host) && !PLATFORMS.test(d));
    // Only results above the prospect (or all, when it is absent) are outranking it.
    const above = mine?.position ? rivals.filter((d) => (organic.find((r) => siteHost(r.url ?? "") === d)?.position ?? 99) < mine.position!) : rivals;
    if (query !== queries.at(-1)) for (const d of above.slice(0, 5)) counts.set(d, (counts.get(d) ?? 0) + 1);
    results.push({ query, position: mine?.position, topDomains: domains.slice(0, 5), ads: item?.paidResults?.length ?? 0 });
  }
  const competitors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([domain, appearances]) => ({ domain, appearances }));
  return { queries: results, competitors };
}

export async function collectSearch(auditId: string, prospect: AuditProspect, site: WebsiteData | undefined, budget: Budget): Promise<StepResult<SearchData>> {
  const queries = deriveQueries(prospect, site);
  const { items, costUsd } = await budget.run(auditId, "serp", searchInput(queries));
  const data = summarizeSearch(prospect.website, queries, items);
  const ranked = data.queries.filter((q) => q.position).length;
  return { status: "done", data, costUsd, note: `Ranks on page one for ${ranked} of ${queries.length} searches` };
}
