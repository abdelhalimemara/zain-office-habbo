import type { AuditProspect } from "../../../../../shared/audits";
import { CostCapReached, type Budget } from "../budget";
import { onHost, siteHost } from "../url";
import type { AdsData, CrmFlags, StepResult } from "../types";
import { facebookUrl } from "./social";

const DAY = 86_400_000;
type Item = Record<string, unknown>;

const time = (v: unknown): number | undefined => {
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
};

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Where to look in the Meta Ad Library: the CRM's library link, the page, else a keyword search in Saudi Arabia. */
export function metaAdsInput(prospect: AuditProspect, flags: CrmFlags = {}): { input: Item; byKeyword: boolean } {
  const library = flags.metaAdLibraryUrl && /^https:\/\/(www\.)?facebook\.com\/ads\/library\//.test(flags.metaAdLibraryUrl) ? flags.metaAdLibraryUrl : null;
  const page = facebookUrl(prospect.facebook);
  const url =
    library ??
    page ??
    `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=SA&media_type=all&q=${encodeURIComponent(prospect.name)}&search_type=keyword_unordered`;
  return { input: { startUrls: [{ url }], resultsLimit: 30, activeStatus: "active", onlyTotal: false }, byKeyword: !library && !page };
}

export function summarizeMetaAds(prospect: AuditProspect, items: readonly Item[], byKeyword: boolean, now: number): AdsData["meta"] {
  const host = siteHost(prospect.website);
  const name = normalize(prospect.name);
  // A keyword search returns other advertisers too: keep the prospect's page or ads linking to its site.
  const mine = byKeyword
    ? items.filter((ad) => {
        const snap = (ad.snapshot ?? {}) as Item;
        const page = normalize(String(ad.pageName ?? snap.pageName ?? ""));
        const links = (Array.isArray(snap.cards) ? snap.cards : []).map((c) => String((c as Item).linkUrl ?? ""));
        return (!!name && page.includes(name)) || [String(snap.linkUrl ?? ""), ...links].some((l) => l && onHost(l, host));
      })
    : items;
  const active = mine.filter((ad) => ad.isActive !== false);
  const starts = active.map((ad) => time(ad.startDate ?? ad.startDateFormatted)).filter((t): t is number => t !== undefined);
  const platforms = [...new Set(active.flatMap((ad) => (Array.isArray(ad.publisherPlatform) ? ad.publisherPlatform.map(String) : [])))];
  const first = active[0];
  return {
    activeAds: active.length,
    oldestDays: starts.length ? Math.floor((now - Math.min(...starts)) / DAY) : undefined,
    platforms: platforms.map((p) => p.toLowerCase()),
    pageName: first ? String(first.pageName ?? ((first.snapshot ?? {}) as Item).pageName ?? "") || undefined : undefined,
  };
}

export function googleAdsInput(website: string): Item {
  return { domains: [siteHost(website)], resultType: "ads", region: "SA", adFormat: "ALL", maxAdsPerSearch: 30, includeDetails: false };
}

export function summarizeGoogleAds(items: readonly Item[], now: number): AdsData["google"] {
  const ads = items.filter((i) => i.creativeId || i.adUrl || i.format);
  const days = ads.map((a) => (typeof a.shownForDays === "number" ? a.shownForDays : undefined)).filter((d): d is number => d !== undefined);
  return {
    ads: ads.length,
    formats: [...new Set(ads.map((a) => String(a.format ?? "").toLowerCase()).filter(Boolean))],
    longestDays: days.length ? Math.max(...days) : undefined,
    recentlyShown: ads.filter((a) => {
      const last = time(a.lastShown);
      return last !== undefined && now - last <= 14 * DAY;
    }).length,
  };
}

export async function collectAds(auditId: string, prospect: AuditProspect, budget: Budget, flags?: CrmFlags, now = Date.now()): Promise<StepResult<AdsData>> {
  const data: AdsData = {};
  const problems: string[] = [];
  let costUsd = 0;
  let capped = false;
  let capNote = "";
  const attempt = async (label: string, run: () => Promise<void>) => {
    if (capped) return;
    try {
      await run();
    } catch (err) {
      costUsd += (err as { costUsd?: number }).costUsd ?? 0;
      if (err instanceof CostCapReached) {
        capped = true;
        capNote = err.message;
      } else problems.push(`${label}: ${err instanceof Error ? err.message.slice(0, 80) : "error"}`);
    }
  };
  await attempt("Meta", async () => {
    const { input, byKeyword } = metaAdsInput(prospect, flags);
    const r = await budget.run(auditId, "metaAds", input);
    costUsd += r.costUsd;
    data.meta = summarizeMetaAds(prospect, r.items, byKeyword, now);
  });
  await attempt("Google", async () => {
    const r = await budget.run(auditId, "googleAds", googleAdsInput(prospect.website));
    costUsd += r.costUsd;
    data.google = summarizeGoogleAds(r.items, now);
  });
  if (!data.meta && !data.google) {
    if (capped) return { status: "skipped", costUsd, note: capNote };
    throw Object.assign(new Error(problems.join("; ") || "No ad library could be read"), { costUsd });
  }
  const parts = [
    data.meta ? `Meta ${data.meta.activeAds} active` : "Meta not read",
    data.google ? `Google ${data.google.ads} ads` : "Google not read",
    "TikTok ad library has no Saudi coverage",
  ];
  return { status: "done", data, costUsd, note: parts.join(" · ") };
}
