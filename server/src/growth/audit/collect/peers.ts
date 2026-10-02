import type { SearchRun } from "../../../../../shared/audits";
import type { Competitor, TrafficRead } from "../types";

/**
 * Who counts as a competitor in the benchmark: a Saudi peer in the same category, not a global brand,
 * a manufacturer or a marketplace. Candidates come from the category searches (search step); their home
 * pages are read for relevance and a business footprint (social step); Similarweb then rules out the
 * global and the oversized (ads step). Two good peers are shown rather than padding with a bad third.
 */
export const MAX_COMPETITORS = 3;
/** A site with this many times the prospect's visits is out of its league, unless it is clearly a local retailer. */
export const SCALE_LIMIT = 30;
export const SAUDI_SHARE_MIN = 0.5;

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

/** After the home-page check: candidates that are businesses in the category, best first (.sa, Arabic). */
export function screenCandidates(candidates: readonly Candidate[]): Candidate[] {
  const local = (c: Candidate) => (/\.sa$/.test(c.domain) ? 2 : 0) + (c.arabic ? 1 : 0);
  return candidates
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.relevant !== false && c.business !== false)
    .sort((a, b) => local(b.c) - local(a.c) || a.i - b.i)
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
  return candidates
    .filter((c) => saudiPeer(c, traffic[c.domain]))
    .filter((c) => {
      const visits = traffic[c.domain]?.monthlyVisits;
      const local = /\.sa$/.test(c.domain) || !!c.arabic;
      return !(own && visits && visits > own * SCALE_LIMIT && !local);
    })
    .slice(0, MAX_COMPETITORS)
    .map(({ domain, name, instagram }) => ({ domain, name, ...(instagram ? { instagram } : {}) }));
}
