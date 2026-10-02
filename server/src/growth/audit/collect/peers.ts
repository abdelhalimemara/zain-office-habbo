import type { SearchRun } from "../../../../../shared/audits";
import { onHost } from "../url";
import { PLATFORMS, foreign, subdomain } from "./search";
import type { Competitor, TrafficRead } from "../types";

/**
 * Who counts as a competitor in the benchmark: a Saudi peer competing on the same keywords, not a global
 * brand, a manufacturer or a marketplace. Candidates come first from Semrush's organic competitors (keyword
 * overlap), then from the category searches as a fallback (search step); their home pages are read for
 * relevance and a business footprint (social step); Similarweb then rules out the global and the oversized
 * (ads step). Search candidates are used only when fewer than two Semrush peers survive, and two good peers
 * are shown rather than padding with a bad third.
 */
export const MAX_COMPETITORS = 3;
/** A site with this many times the prospect's visits is out of its league, unless it is clearly a local retailer. */
export const SCALE_LIMIT = 30;
export const SAUDI_SHARE_MIN = 0.5;
/** One shared keyword is coincidence (a single "cat food" ranking), not competition. */
export const MIN_COMMON_KEYWORDS = 2;
export const MAX_CANDIDATES = 6;
/** Room for neighbour candidates on top of MAX_CANDIDATES when the prospect's own overlap is thin. */
export const MAX_NEIGHBOURS = 4;
/** Semrush peers that must survive before the category-search fallback is ignored. */
export const MIN_SEMRUSH_PEERS = 2;

const CITY_WORDS =
  /\b(riyadh|jeddah|dammam|khobar|al khobar|mecca|makkah|medina|madinah|abha|taif|tabuk|buraidah|saudi( arabia)?|ksa)\b|الرياض|جدة|الدمام|الخبر|مكة|المدينة المنورة|أبها|الطائف|تبوك|بريدة|السعودية/gi;
const STOP_WORDS = new Set(["best", "top", "near", "me", "in", "the", "and", "for", "of", "online", "shop", "store", "أفضل", "في", "من", "متجر"]);

/** The category vocabulary: the category searches without their city and filler words ("cat food", "صالون تجميل"). */
export function categoryTerms(runs: readonly SearchRun[]): string[] {
  const phrases = runs
    .filter((r) => r.kind === "category")
    .map((r) => r.query.replace(CITY_WORDS, " ").split(/\s+/).filter((w) => w && !STOP_WORDS.has(w.toLowerCase())).join(" ").trim().toLowerCase())
    .filter((p) => p.length >= 3);
  return [...new Set(phrases)];
}

const isArabic = (s: string) => /[؀-ۿ]/.test(s);
/** A whole-word match for Latin words (so "cat" is not found in "caterpillar"); a substring for Arabic. */
function hasWord(text: string, word: string): boolean {
  if (isArabic(word)) return text.includes(word);
  return new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?([^a-z0-9]|$)`, "i").test(text);
}

/**
 * The home page is about the category: a whole category phrase appears, or two different words of the
 * category vocabulary do (one shared word like "cat" is not enough).
 */
export function isRelevant(text: string, terms: readonly string[]): boolean {
  if (!terms.length) return true;
  const t = text.toLowerCase();
  if (terms.some((p) => hasWord(t, p))) return true;
  const words = new Set(terms.flatMap((p) => p.split(" ")).filter((w) => w.length >= 3));
  return [...words].filter((w) => hasWord(t, w)).length >= 2;
}

export interface Candidate extends Competitor {
  /** Home page read: about the category, a business footprint, an Arabic storefront. Absent when the page could not be read. */
  relevant?: boolean;
  business?: boolean;
  arabic?: boolean;
}

/** A domain that could be a peer at all: not the prospect, a platform, a foreign ccTLD or a page on someone's subdomain. */
const plausible = (domain: string, prospectDomain: string) => !!domain && !onHost(domain, prospectDomain) && !PLATFORMS.test(domain) && !foreign(domain) && !subdomain(domain);

/**
 * The candidate list: Semrush keyword-overlap competitors first (most common keywords first, at least
 * MIN_COMMON_KEYWORDS), then the category-search ones, without duplicates, at most MAX_CANDIDATES.
 */
export function mergeCandidates(
  overlap: readonly { domain: string; commonKeywords: number }[],
  searchDomains: readonly string[],
  prospectDomain: string,
): Candidate[] {
  const out: Candidate[] = [];
  for (const o of overlap) {
    if (o.commonKeywords >= MIN_COMMON_KEYWORDS && plausible(o.domain, prospectDomain)) out.push({ domain: o.domain, name: o.domain, source: "semrush", commonKeywords: o.commonKeywords });
  }
  for (const d of searchDomains) {
    if (plausible(d, prospectDomain) && !out.some((c) => c.domain === d)) {
      const shared = overlap.find((o) => o.domain === d)?.commonKeywords;
      out.push({ domain: d, name: d, source: "search", ...(shared ? { commonKeywords: shared } : {}) });
    }
  }
  return out.slice(0, MAX_CANDIDATES);
}

/** A neighbour must share this many keywords with a Saudi candidate to count as competing on the same keywords. */
export const MIN_NEIGHBOUR_KEYWORDS = 5;

/**
 * When the prospect is too small for Semrush to list real competitors, the Saudi candidates' own organic
 * competitors are: the stores competing on the same keywords as the category's Saudi players. Ranked by the
 * keywords they share across those candidates (.sa first); each keeps the candidate it was found through (`via`).
 */
export function neighbourCandidates(
  seeds: readonly { domain: string; overlap: readonly { domain: string; commonKeywords: number }[] }[],
  existing: readonly Candidate[],
  prospectDomain: string,
  limit: number,
): Candidate[] {
  const score = new Map<string, { shared: number; via: string }>();
  for (const seed of seeds) {
    for (const o of seed.overlap) {
      if (o.commonKeywords < MIN_NEIGHBOUR_KEYWORDS || !plausible(o.domain, prospectDomain) || existing.some((c) => c.domain === o.domain)) continue;
      const prev = score.get(o.domain);
      score.set(o.domain, { shared: (prev?.shared ?? 0) + o.commonKeywords, via: prev?.via ?? seed.domain });
    }
  }
  return [...score.entries()]
    // Saudi (.sa) neighbours first, then the most keywords shared.
    .sort((a, b) => Number(/\.sa$/.test(b[0])) - Number(/\.sa$/.test(a[0])) || b[1].shared - a[1].shared || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([domain, { via }]) => ({ domain, name: domain, source: "semrush" as const, via }));
}

/** After the home-page check: businesses in the category; Semrush peers first, then .sa and Arabic storefronts. */
export function screenCandidates(candidates: readonly Candidate[]): Candidate[] {
  const rank = (c: Candidate) => (c.source === "semrush" ? 10 : 0) + (/\.sa$/.test(c.domain) ? 2 : 0) + (c.arabic ? 1 : 0);
  return candidates
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.relevant !== false && c.business !== false)
    .sort((a, b) => rank(b.c) - rank(a.c) || a.i - b.i)
    .map(({ c }) => c);
}

/** Saudi-plausible: a .sa domain, an Arabic storefront, or most of its visits from Saudi Arabia. */
export function saudiPeer(c: Candidate, traffic?: TrafficRead): boolean {
  if (/\.sa$/.test(c.domain) || c.arabic) return true;
  return traffic?.saudiShare !== undefined && traffic.saudiShare >= SAUDI_SHARE_MIN;
}

/**
 * The final benchmark set, once Similarweb is in: Saudi peers only, nothing at more than SCALE_LIMIT times the
 * prospect's visits unless it is a .sa or Arabic local retailer, at most three, possibly fewer.
 */
export function finalPeers(candidates: readonly Candidate[], traffic: Record<string, TrafficRead>, prospectDomain: string): Competitor[] {
  const own = traffic[prospectDomain]?.monthlyVisits;
  const survivors = candidates
    .filter((c) => saudiPeer(c, traffic[c.domain]))
    .filter((c) => {
      const visits = traffic[c.domain]?.monthlyVisits;
      const local = /\.sa$/.test(c.domain) || !!c.arabic;
      return !(own && visits && visits > own * SCALE_LIMIT && !local);
    });
  const bySemrush = survivors.filter((c) => c.source === "semrush");
  // Keyword-overlap peers are the founder's definition of a competitor; the category searches only fill in.
  const chosen = bySemrush.length >= MIN_SEMRUSH_PEERS ? bySemrush : survivors;
  return chosen
    .slice(0, MAX_COMPETITORS)
    .map(({ domain, name, instagram, source, commonKeywords, via }) => ({
      domain,
      name,
      ...(instagram ? { instagram } : {}),
      ...(source ? { source } : {}),
      ...(commonKeywords !== undefined ? { commonKeywords } : {}),
      ...(via ? { via } : {}),
    }));
}
