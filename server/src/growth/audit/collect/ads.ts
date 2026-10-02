import type { AuditProspect } from "../../../../../shared/audits";
import { CostCapReached, type Budget } from "../budget";
import { onHost, siteHost } from "../url";
import type { AdsData, Competitor, CrmFlags, GoogleAdsRead, MapsRead, StepResult, TrafficRead } from "../types";
import { facebookUrl, when } from "./social";

const DAY = 86_400_000;
/** A Transparency Center ad shown in the last 30 days counts as active. */
const ACTIVE_DAYS = 30;
type Item = Record<string, unknown>;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export interface Business {
  domain: string;
  name: string;
  facebook?: string;
}

/** The Ad Library URL per business: the CRM's library link or the Facebook page, else an exact-phrase search in SA. */
export function metaUrl(b: Business, flags: CrmFlags = {}): { url: string; byKeyword: boolean } {
  if (flags.metaAdLibraryUrl && /^https:\/\/(www\.)?facebook\.com\/ads\/library\//.test(flags.metaAdLibraryUrl)) return { url: flags.metaAdLibraryUrl, byKeyword: false };
  const page = facebookUrl(b.facebook);
  if (page) return { url: page, byKeyword: false };
  return {
    url: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=SA&media_type=all&q=${encodeURIComponent(b.name)}&search_type=keyword_exact_phrase`,
    byKeyword: true,
  };
}

/** Only ads from the business's own page (by name) or linking to its site count; others are "none attributable". */
export function attributeMeta(b: Business, items: readonly Item[], byKeyword: boolean): AdsData["meta"][string] {
  const name = normalize(b.name);
  const mine = byKeyword
    ? items.filter((ad) => {
        const snap = (ad.snapshot ?? {}) as Item;
        const page = normalize(String(ad.pageName ?? snap.pageName ?? ""));
        const links = (Array.isArray(snap.cards) ? snap.cards : []).map((c) => String((c as Item).linkUrl ?? ""));
        return (!!name && !!page && (page.includes(name) || name.includes(page))) || [String(snap.linkUrl ?? ""), ...links].some((l) => l && onHost(l, b.domain));
      })
    : items;
  const active = mine.filter((ad) => ad.isActive !== false);
  if (!active.length) return "none";
  return { active: active.length, pageName: String(active[0]!.pageName ?? "") || undefined };
}

export function summarizeGoogleAds(items: readonly Item[], now: number): GoogleAdsRead | "none" {
  const ads = items.filter((i) => i.creativeId || i.adUrl || i.format);
  if (!ads.length) return "none";
  const firsts = ads.map((a) => when(a.firstShown)).filter((t): t is number => t !== undefined);
  return {
    active: ads.filter((a) => {
      const last = when(a.lastShown);
      return last !== undefined && now - last <= ACTIVE_DAYS * DAY;
    }).length,
    total: ads.length,
    formats: [...new Set(ads.map((a) => String(a.format ?? "").toLowerCase()).filter(Boolean))].sort(),
    since: firsts.length ? new Date(Math.min(...firsts)).toISOString().slice(0, 10) : undefined,
    advertiser: typeof ads[0]!.advertiserName === "string" ? ads[0]!.advertiserName : undefined,
  };
}

const SOURCE_LABELS: Record<string, string> = {
  SearchOrganic: "Organic search",
  SearchPaid: "Paid search",
  Direct: "Direct",
  Referrals: "Referrals",
  SocialOrganic: "Organic social",
  SocialPaid: "Paid social",
  Mail: "Email",
  DisplayAds: "Display ads",
  Affiliate: "Affiliates",
  GenAi: "AI assistants",
};

/** pro100chok/similarweb-scraper; percentages arrive 0..100 and become 0..1. */
export function trafficRead(item: Item): TrafficRead | null {
  const e = (item.Engagments ?? item.Engagements ?? {}) as Item;
  const visits = num(e.Visits) ?? num(e.visits);
  if (visits === undefined) return null;
  const sources = Object.entries((item.TrafficSources ?? {}) as Item).filter((x): x is [string, number] => typeof x[1] === "number");
  const top = sources.sort((a, b) => b[1] - a[1])[0];
  const share = (key: string) => Math.round((sources.find(([k]) => k === key)?.[1] ?? NaN) * 100) / 10_000;
  const sa = ((item.TopCountryShares ?? []) as Item[]).find((c) => c.CountryCode === "SA");
  const month = num(e.Month);
  const year = num(e.Year);
  const snapshot = typeof item.SnapshotDate === "string" ? new Date(item.SnapshotDate) : null;
  const period =
    month && year
      ? new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })
      : snapshot && !Number.isNaN(snapshot.getTime())
        ? snapshot.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })
        : "latest";
  const bounce = num(e.BounceRate);
  return {
    monthlyVisits: Math.round(visits),
    ...(bounce !== undefined ? { bounceRate: Math.round(bounce * 10) / 1000 } : {}),
    ...(top ? { topSource: `${SOURCE_LABELS[top[0]] ?? top[0]} (${top[1].toFixed(1)}%, est.)` } : {}),
    ...(num(sa?.Value) !== undefined ? { saudiShare: Math.round(num(sa!.Value)! * 10) / 1000 } : {}),
    period,
    ...(Number.isFinite(share("SearchOrganic")) ? { organicShare: share("SearchOrganic") } : {}),
    ...(Number.isFinite(share("SearchPaid")) ? { paidShare: share("SearchPaid") } : {}),
  };
}

export function mapsInput(prospect: AuditProspect): Item {
  const city = prospect.city ? prospect.city.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : "Riyadh";
  return {
    searchStringsArray: [prospect.name],
    locationQuery: `${city}, Saudi Arabia`,
    maxCrawledPlacesPerSearch: 1,
    language: "en",
    scrapePlaceDetailPage: false,
    maxReviews: 0,
    maxImages: 0,
    maxQuestions: 0,
    scrapeContacts: false,
    includeWebResults: false,
    enableCompetitorAnalysis: false,
  };
}

/** The place counts only when it is plausibly the prospect: its website is theirs, or its name matches. */
export function mapsRead(prospect: AuditProspect, items: readonly Item[]): MapsRead | "none" {
  const place = items[0];
  if (!place) return "none";
  const site = typeof place.website === "string" ? place.website : "";
  const title = String(place.title ?? "");
  const same = (site && onHost(site, siteHost(prospect.website))) || (title && normalize(title).includes(normalize(prospect.name)));
  if (!same) return "none";
  return { title, rating: num(place.totalScore), reviews: num(place.reviewsCount), url: typeof place.url === "string" ? place.url : undefined, category: typeof place.categoryName === "string" ? place.categoryName : undefined };
}

/**
 * Paid and traffic benchmark for the prospect and its competitors, plus the prospect's Google Maps place:
 * Google Ads Transparency (one run, all domains), Meta Ad Library (one run, one search per business),
 * Similarweb (one run) and Google Maps, in parallel. A failed source is "not measured".
 */
export async function collectAds(
  auditId: string,
  prospect: AuditProspect,
  competitors: readonly Competitor[],
  budget: Budget,
  flags?: CrmFlags,
  now = Date.now(),
): Promise<StepResult<AdsData>> {
  const businesses: Business[] = [{ domain: siteHost(prospect.website), name: prospect.name, facebook: prospect.facebook }, ...competitors];
  const domains = businesses.map((b) => b.domain);
  const data: AdsData = { google: {}, meta: {}, traffic: {} };
  const problems: string[] = [];
  let costUsd = 0;
  let capped = "";
  const attempt = async (label: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (err) {
      costUsd += (err as { costUsd?: number }).costUsd ?? 0;
      if (err instanceof CostCapReached) capped = err.message;
      else problems.push(`${label}: ${err instanceof Error ? err.message.slice(0, 60) : "error"}`);
    }
  };
  const metaUrls = businesses.map((b, i) => ({ b, ...metaUrl(b, i === 0 ? flags : {}) }));
  await Promise.all([
    attempt("Google Ads", async () => {
      const r = await budget.run(auditId, "googleAds", { domains, resultType: "ads", region: "SA", adFormat: "ALL", maxAdsPerSearch: 20, includeDetails: false });
      costUsd += r.costUsd;
      for (const d of domains) data.google[d] = summarizeGoogleAds(r.items.filter((i) => siteHost(`https://${String(i.domain ?? "")}`) === d), now);
    }),
    attempt("Meta", async () => {
      const r = await budget.run(auditId, "metaAds", { startUrls: metaUrls.map((m) => ({ url: m.url })), resultsLimit: 10, activeStatus: "active", onlyTotal: false });
      costUsd += r.costUsd;
      for (const m of metaUrls) data.meta[m.b.domain] = attributeMeta(m.b, r.items.filter((i) => i.inputUrl === m.url || i.url === m.url), m.byKeyword);
    }),
    attempt("Similarweb", async () => {
      const r = await budget.run(auditId, "similarweb", { searchType: "similarweb", domains });
      costUsd += r.costUsd;
      for (const item of r.items) {
        const d = siteHost(`https://${String(item.SiteName ?? "")}`);
        const t = domains.includes(d) ? trafficRead(item) : null;
        if (t) data.traffic[d] = t;
      }
    }),
    attempt("Maps", async () => {
      const r = await budget.run(auditId, "maps", mapsInput(prospect));
      costUsd += r.costUsd;
      data.maps = mapsRead(prospect, r.items);
    }),
  ]);
  const read = [Object.keys(data.google).length, Object.keys(data.meta).length, Object.keys(data.traffic).length, data.maps ? 1 : 0].filter(Boolean).length;
  if (read === 0) {
    if (capped) return { status: "skipped", costUsd, note: capped };
    throw Object.assign(new Error(problems.join("; ") || "No ad library or traffic source could be read"), { costUsd });
  }
  const p = businesses[0]!.domain;
  const g = data.google[p];
  const m = data.meta[p];
  const why = (label: string) => {
    const reason = problems.find((x) => x.startsWith(`${label}:`));
    return reason ? ` (${reason.slice(label.length + 2)})` : "";
  };
  const parts = [
    g === undefined ? `Google not read${why("Google Ads")}` : g === "none" ? "no Google ads" : `${g.active} active Google ads`,
    m === undefined ? `Meta not read${why("Meta")}` : m === "none" ? "no attributable Meta ads" : `${m.active} active Meta ads`,
    data.traffic[p] ? `~${data.traffic[p]!.monthlyVisits.toLocaleString("en-US")} visits/month` : "traffic not measured",
    data.maps && data.maps !== "none" ? `Maps ${data.maps.rating ?? "–"}★ (${data.maps.reviews ?? 0})` : "no Maps listing matched",
  ];
  return { status: "done", data, costUsd, note: `${parts.join(" · ")}${competitors.length ? ` · ${competitors.length} competitors benchmarked` : ""}${capped ? ` (${capped.toLowerCase()})` : ""}` };
}
