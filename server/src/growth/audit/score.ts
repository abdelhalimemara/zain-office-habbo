import type { AuditScore, Grade, SectionScore } from "../../../../shared/audits";
import type { AdsData, CollectedData, SearchData, SocialData, Trackers, WebsiteData } from "./types";

/**
 * Deterministic audit scoring. Every section is 0..100 from fixed point tables, so the same data
 * always gives the same score; the overall score is the weighted mean. A section with no data (its
 * step failed or was skipped) gets weight 0 and the others are scaled up, so a missing scrape is
 * reported as "not measured" instead of counting as a failure.
 *
 * website (30%)   titles 15, meta descriptions 15, one H1 10, content depth 15 (300+ words),
 *                 image alt text 10, schema 10, https 10, viewport 5, internal links 5 (10+ per page),
 *                 Arabic + English 5 (one language 2)
 * search (20%)    page-one share of target searches 60, top-3 share 20, owns the brand search (#1-3) 20
 * social (25%)    audience 40 (followers vs the category benchmark, log scale), cadence 35 (3+ posts a
 *                 week on the best channel), engagement 25 (3%+ on the best channel)
 * ads (10%)       Meta: running 35 + 2 per active ad up to 15; Google: running 25; longevity 30+ days 15;
 *                 2+ paid channels 10. No ads scores 0 (presented as an opportunity, not a failing).
 * tracking (15%)  Meta pixel 30, GA4 25, GTM 20, TikTok pixel 15, Snap pixel 10
 *
 * Grade: A >= 85, B >= 70, C >= 55, D >= 40, else E.
 */
export const WEIGHTS = { website: 0.3, search: 0.2, social: 0.25, ads: 0.1, tracking: 0.15 } as const;
type Section = keyof typeof WEIGHTS;

/** Followers a healthy local brand in the category has; the audience score reaches 100% there. */
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

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const pct = (share: number) => `${Math.round(share * 100)}%`;

export function gradeFor(overall: number): Grade {
  return overall >= 85 ? "A" : overall >= 70 ? "B" : overall >= 55 ? "C" : overall >= 40 ? "D" : "E";
}

interface Partial0 {
  score: number;
  drivers: string[];
}

/** 2..4 drivers: the biggest misses first, then what works. */
function drivers(misses: [number, string][], wins: string[]): string[] {
  const out = misses.sort((a, b) => b[0] - a[0]).map(([, d]) => d).slice(0, 3);
  for (const w of wins) if (out.length < 4) out.push(w);
  return out.slice(0, Math.max(2, Math.min(4, out.length)));
}

export function scoreWebsite(w: WebsiteData): Partial0 {
  const depth = Math.min(1, w.avgWords / 300);
  const alt = w.images ? 1 - w.imagesNoAlt / w.images : 1;
  const languages = w.arabicPages > 0 && w.englishPages > 0 ? 5 : 2;
  const parts: [number, number, string, string][] = [
    // [points, max, miss, win]
    [15 * w.goodTitles, 15, `Only ${pct(w.goodTitles)} of pages have a well-sized title`, "Page titles are well sized"],
    [15 * w.goodMetas, 15, `${pct(1 - w.goodMetas)} of pages lack a usable meta description`, "Meta descriptions are in place"],
    [10 * w.oneH1, 10, `${pct(1 - w.oneH1)} of pages do not have exactly one H1`, "Headings are structured (one H1 per page)"],
    [15 * depth, 15, `Thin content: ${w.avgWords} words per page on average`, `Solid content depth (${w.avgWords} words per page)`],
    [10 * alt, 10, `${w.imagesNoAlt} of ${w.images} images have no alt text`, "Images carry alt text"],
    [w.schemaTypes.length ? 10 : 0, 10, "No structured data (schema.org)", `Structured data: ${w.schemaTypes.slice(0, 3).join(", ")}`],
    [w.https ? 10 : 0, 10, "Not fully served over HTTPS", "Served over HTTPS"],
    [w.viewport ? 5 : 0, 5, "No mobile viewport set", "Mobile-ready viewport"],
    [5 * Math.min(1, w.avgInternalLinks / 10), 5, `Weak internal linking (${w.avgInternalLinks} links per page)`, "Good internal linking"],
    [languages, 5, w.arabicPages ? "Arabic only: no English pages" : "No Arabic content", "Arabic and English coverage"],
  ];
  const score = parts.reduce((n, [p]) => n + p, 0);
  const misses = parts.filter(([p, max]) => p < max * 0.7).map(([p, max, miss]) => [max - p, miss] as [number, string]);
  const wins = parts.filter(([p, max]) => p >= max * 0.9).map(([, , , win]) => win);
  return { score: Math.round(clamp(score)), drivers: drivers(misses, wins) };
}

export function scoreSearch(s: SearchData): Partial0 {
  const brand = s.queries.at(-1);
  const targets = s.queries.slice(0, -1);
  const ranked = targets.filter((q) => q.position !== undefined);
  const top3 = targets.filter((q) => (q.position ?? 99) <= 3);
  const ownsBrand = (brand?.position ?? 99) <= 3;
  const n = Math.max(1, targets.length);
  const score = 60 * (ranked.length / n) + 20 * (top3.length / n) + (ownsBrand ? 20 : 0);
  const out = [`Page one for ${ranked.length} of ${targets.length} target searches`];
  const rival = s.competitors[0];
  if (rival) out.push(`${rival.domain} outranks them on ${rival.appearances} of ${targets.length} searches`);
  out.push(ownsBrand ? "Owns its brand search" : "Does not rank top 3 for its own name");
  if (top3.length) out.push(`Top 3 for ${top3.length} searches`);
  return { score: Math.round(clamp(score)), drivers: out.slice(0, 4) };
}

export function scoreSocial(s: SocialData, category?: string): Partial0 {
  const measured = s.channels.filter((c) => c.followers !== undefined);
  if (measured.length === 0) return { score: 0, drivers: ["No social profile could be measured", "Social is the main gap"] };
  const benchmark = FOLLOWER_BENCHMARKS[(category ?? "").toUpperCase()] ?? DEFAULT_BENCHMARK;
  const followers = measured.reduce((n, c) => n + (c.followers ?? 0), 0);
  const audience = followers > 0 ? Math.min(1, Math.log10(followers + 1) / Math.log10(benchmark + 1)) : 0;
  const best = (key: "postsPerWeek" | "engagementRate") => measured.reduce((m, c) => Math.max(m, c[key] ?? 0), 0);
  const perWeek = best("postsPerWeek");
  const rate = best("engagementRate");
  const score = 40 * audience + 35 * Math.min(1, perWeek / 3) + 25 * Math.min(1, rate / 0.03);
  const lead = measured.reduce((a, b) => ((b.followers ?? 0) > (a.followers ?? 0) ? b : a));
  return {
    score: Math.round(clamp(score)),
    drivers: [
      `${followers.toLocaleString("en-US")} followers across ${measured.length} channel${measured.length > 1 ? "s" : ""} (benchmark ${benchmark.toLocaleString("en-US")})`,
      perWeek >= 3 ? `Posts ${perWeek} times a week` : `Posts only ${perWeek} times a week (target 3+)`,
      `Engagement ${(rate * 100).toFixed(1)}% on the best channel`,
      `Largest audience on ${lead.channel}`,
    ],
  };
}

export function scoreAds(a: AdsData, social?: SocialData): Partial0 {
  const meta = a.meta?.activeAds ?? 0;
  const google = (a.google?.recentlyShown ?? 0) > 0 || (a.google?.ads ?? 0) > 0;
  const tiktok = (a.tiktokAdsInFeed ?? 0) + (social?.channels.find((c) => c.channel === "tiktok")?.adsInFeed ?? 0) > 0;
  const longest = Math.max(a.meta?.oldestDays ?? 0, a.google?.longestDays ?? 0);
  const channels = [meta > 0, google, tiktok].filter(Boolean).length;
  let score = 0;
  if (meta > 0) score += 35 + Math.min(15, meta * 2);
  if (google) score += 25;
  if (longest >= 30) score += 15;
  if (channels >= 2) score += 10;
  const out = [
    meta > 0 ? `${meta} active Meta ads${a.meta?.platforms.length ? ` on ${a.meta.platforms.join(", ")}` : ""}` : "No active Meta ads",
    google ? `${a.google?.ads ?? 0} Google ads in the Transparency Center` : "No Google Ads found",
  ];
  if (longest > 0) out.push(`Longest-running ad: ${longest} days`);
  if (channels === 0) out.push("No paid presence: a clear opportunity");
  return { score: Math.round(clamp(score)), drivers: out.slice(0, 4) };
}

export function scoreTracking(t: Trackers): Partial0 {
  const table: [keyof Trackers, number, string][] = [
    ["metaPixel", 30, "Meta pixel"],
    ["ga4", 25, "GA4"],
    ["gtm", 20, "Google Tag Manager"],
    ["tiktokPixel", 15, "TikTok pixel"],
    ["snapPixel", 10, "Snap pixel"],
  ];
  const score = table.reduce((n, [k, p]) => n + (t[k] ? p : 0), 0);
  const missing = table.filter(([k]) => !t[k]).map(([, , label]) => label);
  const found = table.filter(([k]) => t[k]).map(([, , label]) => label);
  const out: string[] = [];
  if (missing.length) out.push(`Missing: ${missing.join(", ")}`);
  if (found.length) out.push(`Installed: ${found.join(", ")}`);
  out.push(t.metaPixel || t.tiktokPixel ? "Retargeting audiences can be built" : "No retargeting possible without a pixel");
  return { score, drivers: out };
}

export function scoreAudit(data: CollectedData, category?: string): AuditScore {
  const raw: Record<Section, Partial0 | null> = {
    website: data.website ? scoreWebsite(data.website) : null,
    search: data.search ? scoreSearch(data.search) : null,
    social: data.social ? scoreSocial(data.social, category) : null,
    ads: data.ads ? scoreAds(data.ads, data.social) : null,
    tracking: data.website ? scoreTracking(data.website.trackers) : null,
  };
  const measured = (Object.keys(WEIGHTS) as Section[]).filter((k) => raw[k]);
  const total = measured.reduce((n, k) => n + WEIGHTS[k], 0);
  const section = (k: Section): SectionScore => {
    const r = raw[k];
    if (!r) return { score: 0, weight: 0, drivers: ["Not measured in this audit", "Weight shared out to the other sections"] };
    return { score: r.score, weight: Math.round((WEIGHTS[k] / total) * 1000) / 1000, drivers: r.drivers };
  };
  const sections = { website: section("website"), search: section("search"), social: section("social"), ads: section("ads"), tracking: section("tracking") };
  const overall = total ? Math.round(measured.reduce((n, k) => n + raw[k]!.score * (WEIGHTS[k] / total), 0)) : 0;
  return { overall, grade: gradeFor(overall), sections };
}
