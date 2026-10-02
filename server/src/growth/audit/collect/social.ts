import type { AuditProspect, SocialChannelRow } from "../../../../../shared/audits";
import { CostCapReached, type Budget } from "../budget";
import type { Competitor, SocialChannel, SocialData, StepResult, WebsiteData } from "../types";
import { siteHost } from "../url";
import { isRelevant, screenCandidates, type Candidate } from "./peers";
import { PAGE_FUNCTION, summarizeHome } from "./website";

const DAY = 86_400_000;
const WINDOW_DAYS = 30;

type Item = Record<string, unknown>;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
export const when = (v: unknown): number | undefined => {
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
};

/** Posts in the last 30 days. */
export function postsInWindow(times: readonly (number | undefined)[], now: number): number {
  return times.filter((t): t is number => t !== undefined && now - t <= WINDOW_DAYS * DAY).length;
}

/** Average interactions per post as a share of followers. */
export function engagement(interactions: readonly number[], followers: number | undefined): number | undefined {
  if (!followers || interactions.length === 0) return undefined;
  const avg = interactions.reduce((a, b) => a + b, 0) / interactions.length;
  return Math.round((avg / followers) * 10_000) / 10_000;
}

const latest = (times: readonly (number | undefined)[]) => {
  const t = Math.max(...times.filter((x): x is number => x !== undefined));
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : undefined;
};

/** A handle without @, URL or trailing slash; null when it does not look like one. */
export function cleanHandle(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim().replace(/^https?:\/\/(www\.)?[^/]+\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
  return /^[A-Za-z0-9._]{2,30}$/.test(v) ? v : null;
}

export function facebookUrl(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^https?:\/\/(www\.|m\.|web\.)?(facebook|fb)\.com\/[^\s]+$/i.test(v)) return v.replace(/^http:/i, "https:");
  return /^[A-Za-z0-9.\-]{2,80}$/.test(v) ? `https://www.facebook.com/${v}` : null;
}

/** Handles from the CRM/request first, then from links on the crawled site. */
export function socialHandles(prospect: AuditProspect, site?: WebsiteData): Partial<Record<SocialChannel, string>> {
  const links = site?.socialLinks ?? {};
  const out: Partial<Record<SocialChannel, string>> = { ...links };
  const ig = cleanHandle(prospect.instagram) ?? cleanHandle(links.instagram);
  const tt = cleanHandle(prospect.tiktok) ?? cleanHandle(links.tiktok);
  const fb = facebookUrl(prospect.facebook) ?? facebookUrl(links.facebook);
  if (ig) out.instagram = ig;
  else delete out.instagram;
  if (tt) out.tiktok = tt;
  else delete out.tiktok;
  if (fb) out.facebook = fb;
  else delete out.facebook;
  if (prospect.x) out.x = prospect.x;
  if (prospect.linkedin) out.linkedin = prospect.linkedin;
  return out;
}

export function instagramRow(item: Item | undefined, now: number): SocialChannelRow {
  if (!item || item.private === true) return { channel: "instagram", measured: false };
  const followers = num(item.followersCount);
  const posts = (Array.isArray(item.latestPosts) ? item.latestPosts : []) as Item[];
  const times = posts.map((x) => when(x.timestamp));
  return {
    channel: "instagram",
    followers,
    posts: num(item.postsCount),
    postsPer30Days: postsInWindow(times, now),
    engagement: engagement(posts.map((x) => (num(x.likesCount) ?? 0) + (num(x.commentsCount) ?? 0)), followers),
    lastPost: latest(times),
    measured: followers !== undefined,
  };
}

export function tiktokRow(items: readonly Item[], now: number): SocialChannelRow {
  const author = (items.find((i) => i.authorMeta)?.authorMeta ?? {}) as Item;
  const videos = items.filter((i) => i.createTimeISO || i.createTime);
  const followers = num(author.fans);
  const times = videos.map((v) => when(v.createTimeISO ?? v.createTime));
  return {
    channel: "tiktok",
    followers,
    posts: num(author.video),
    postsPer30Days: postsInWindow(times, now),
    engagement: engagement(videos.map((v) => (num(v.diggCount) ?? 0) + (num(v.commentCount) ?? 0) + (num(v.shareCount) ?? 0)), followers),
    lastPost: latest(times),
    measured: followers !== undefined,
  };
}

export function facebookRow(page: readonly Item[], posts: readonly Item[], now: number): SocialChannelRow {
  const p = page[0] ?? {};
  const followers = num(p.followers) ?? num(p.likes);
  const times = posts.map((x) => when(x.time ?? x.timestamp));
  return {
    channel: "facebook",
    followers,
    postsPer30Days: posts.length ? postsInWindow(times, now) : undefined,
    engagement: engagement(posts.map((x) => (num(x.likes) ?? 0) + (num(x.comments) ?? 0) + (num(x.shares) ?? 0)), followers),
    lastPost: latest(times),
    measured: followers !== undefined,
  };
}

const ROW_ORDER: SocialChannel[] = ["instagram", "tiktok", "facebook", "x", "linkedin", "youtube", "snapchat"];

/** Competitors' home pages, one page each, for their name and Instagram handle. */
export function competitorHomesInput(domains: readonly string[]): Item {
  return {
    startUrls: domains.map((d) => ({ url: `https://${d}/` })),
    linkSelector: "",
    maxPagesPerCrawl: domains.length,
    maxCrawlingDepth: 0,
    maxConcurrency: 3,
    waitUntil: "load",
    pageLoadTimeoutSecs: 30,
    closeCookieModals: true,
    downloadMedia: false,
    pageFunction: PAGE_FUNCTION,
    proxyConfiguration: { useApifyProxy: true },
  };
}

export interface SocialOutcome extends StepResult<SocialData> {
  /** The candidates that passed the home-page check, best first; the ads step makes the final cut. */
  competitors?: Candidate[];
}

/**
 * Prospect channels (Instagram, TikTok, Facebook measured; X, LinkedIn, YouTube, Snapchat listed), and the
 * competitors' Instagram followers for the benchmark. One failing channel becomes "not measured"; the cost
 * cap ends the step with what it has.
 */
export async function collectSocial(
  auditId: string,
  prospect: AuditProspect,
  site: WebsiteData | undefined,
  competitors: readonly Competitor[],
  budget: Budget,
  now = Date.now(),
  terms: readonly string[] = [],
): Promise<SocialOutcome> {
  const handles = socialHandles(prospect, site);
  let costUsd = 0;
  let capNote = "";
  const spend = async (key: Parameters<Budget["run"]>[1], input: Item): Promise<Item[] | null> => {
    if (capNote) return null;
    try {
      const r = await budget.run(auditId, key, input);
      costUsd += r.costUsd;
      return r.items;
    } catch (err) {
      costUsd += (err as { costUsd?: number }).costUsd ?? 0;
      if (err instanceof CostCapReached) capNote = err.message;
      return null;
    }
  };
  // Home pages decide who stays a candidate: about the category, a business, Saudi/Arabic first (peers.ts).
  const homes = competitors.length ? await spend("competitorHomes", competitorHomesInput(competitors.map((c) => c.domain))) : [];
  const read: Candidate[] = competitors.map((c) => {
    const item = (homes ?? []).find((h) => siteHost(String(h.url ?? "")) === c.domain);
    if (!item) return { ...c };
    const home = summarizeHome(item);
    return { ...c, ...(home.name ? { name: home.name } : {}), instagram: c.instagram ?? home.instagram, relevant: isRelevant(home.text, terms), business: home.business, arabic: home.arabic };
  });
  const named = homes ? screenCandidates(read) : read;
  const igHandles = [handles.instagram, ...named.map((c) => c.instagram)].filter((h): h is string => !!h);
  const ig = igHandles.length ? await spend("instagram", { usernames: igHandles, includeAboutSection: false }) : null;
  const igFor = (h: string | undefined) => (h && ig ? ig.find((i) => String(i.username ?? "").toLowerCase() === h.toLowerCase()) : undefined);
  const rows: SocialChannelRow[] = [];
  if (handles.instagram) rows.push(ig ? instagramRow(igFor(handles.instagram), now) : { channel: "instagram", measured: false });
  if (handles.tiktok) {
    const items = await spend("tiktok", { profiles: [handles.tiktok], profileScrapeSections: ["videos"], profileSorting: "latest", resultsPerPage: 12, excludePinnedPosts: true });
    rows.push(items?.length ? tiktokRow(items, now) : { channel: "tiktok", measured: false });
  }
  if (handles.facebook) {
    const page = await spend("facebookPage", { startUrls: [{ url: handles.facebook }] });
    const posts = page?.length ? await spend("facebookPosts", { startUrls: [{ url: handles.facebook }], resultsLimit: 10, onlyPostsNewerThan: "60 days" }) : null;
    rows.push(page?.length ? facebookRow(page, posts ?? [], now) : { channel: "facebook", measured: false });
  }
  for (const channel of ROW_ORDER) if (!rows.some((r) => r.channel === channel) && (channel !== "snapchat" || handles.snapchat)) rows.push({ channel, measured: false });
  rows.sort((a, b) => ROW_ORDER.indexOf(a.channel) - ROW_ORDER.indexOf(b.channel));
  const competitorInstagram: SocialData["competitorInstagram"] = {};
  for (const c of named) {
    if (!c.instagram) continue;
    const followers = num(igFor(c.instagram)?.followersCount);
    competitorInstagram[c.domain] = followers ?? "not-measured";
  }
  const measured = rows.filter((r) => r.measured);
  if (!Object.keys(handles).length && !named.length) {
    return { status: "skipped", costUsd, note: capNote || "No social profiles found on the CRM record or the website" };
  }
  const summary = measured.map((r) => `${r.channel} ${r.followers?.toLocaleString("en-US")}`).join(", ");
  return {
    status: "done",
    data: { rows, competitorInstagram },
    competitors: named,
    costUsd,
    note: `${measured.length} channel${measured.length === 1 ? "" : "s"} measured${summary ? `: ${summary}` : ""}${capNote ? ` (${capNote.toLowerCase()})` : ""}`,
  };
}
