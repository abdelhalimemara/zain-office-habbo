import type { AuditProspect } from "../../../../../shared/audits";
import { CostCapReached, type Budget } from "../budget";
import type { ChannelStats, SocialChannel, SocialData, StepResult, WebsiteData } from "../types";

const DAY = 86_400_000;
const WINDOW_DAYS = 30;

type Item = Record<string, unknown>;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const when = (v: unknown): number | undefined => {
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
};

/** Posts per week over the last 30 days. */
export function cadence(times: readonly (number | undefined)[], now: number): number {
  const recent = times.filter((t): t is number => t !== undefined && now - t <= WINDOW_DAYS * DAY).length;
  return Math.round((recent / (WINDOW_DAYS / 7)) * 10) / 10;
}

/** Average interactions per post as a share of followers. */
export function engagement(interactions: readonly number[], followers: number | undefined): number | undefined {
  if (!followers || interactions.length === 0) return undefined;
  const avg = interactions.reduce((a, b) => a + b, 0) / interactions.length;
  return Math.round((avg / followers) * 10_000) / 10_000;
}

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
  const out: Partial<Record<SocialChannel, string>> = {};
  const ig = cleanHandle(prospect.instagram) ?? cleanHandle(links.instagram);
  const tt = cleanHandle(prospect.tiktok) ?? cleanHandle(links.tiktok);
  const fb = facebookUrl(prospect.facebook) ?? facebookUrl(links.facebook);
  if (ig) out.instagram = ig;
  if (tt) out.tiktok = tt;
  if (fb) out.facebook = fb;
  if (prospect.x ?? links.x) out.x = (prospect.x ?? links.x)!;
  if (prospect.linkedin ?? links.linkedin) out.linkedin = (prospect.linkedin ?? links.linkedin)!;
  return out;
}

export function instagramStats(handle: string, items: readonly Item[], now: number): ChannelStats {
  const p = items[0];
  if (!p) return { channel: "instagram", handle, note: "Profile not found" };
  const followers = num(p.followersCount);
  const posts = (Array.isArray(p.latestPosts) ? p.latestPosts : []) as Item[];
  return {
    channel: "instagram",
    handle,
    url: `https://www.instagram.com/${handle}/`,
    followers,
    postsPerWeek: cadence(posts.map((x) => when(x.timestamp)), now),
    engagementRate: engagement(posts.map((x) => (num(x.likesCount) ?? 0) + (num(x.commentsCount) ?? 0)), followers),
    ...(p.private === true ? { note: "Private account" } : {}),
  };
}

export function tiktokStats(handle: string, items: readonly Item[], now: number): ChannelStats {
  const author = (items.find((i) => i.authorMeta)?.authorMeta ?? {}) as Item;
  const videos = items.filter((i) => i.createTimeISO || i.createTime);
  if (!items.length) return { channel: "tiktok", handle, note: "Profile not found" };
  const followers = num(author.fans);
  return {
    channel: "tiktok",
    handle,
    url: `https://www.tiktok.com/@${handle}`,
    followers,
    postsPerWeek: cadence(videos.map((v) => when(v.createTimeISO ?? v.createTime)), now),
    engagementRate: engagement(videos.map((v) => (num(v.diggCount) ?? 0) + (num(v.commentCount) ?? 0) + (num(v.shareCount) ?? 0)), followers),
    adsInFeed: videos.filter((v) => v.isAd === true).length,
  };
}

export function facebookStats(url: string, page: readonly Item[], posts: readonly Item[], now: number): ChannelStats {
  const p = page[0] ?? {};
  const followers = num(p.followers) ?? num(p.likes);
  return {
    channel: "facebook",
    handle: typeof p.title === "string" ? p.title : url,
    url,
    followers,
    postsPerWeek: cadence(posts.map((x) => when(x.time ?? x.timestamp)), now),
    engagementRate: engagement(posts.map((x) => (num(x.likes) ?? 0) + (num(x.comments) ?? 0) + (num(x.shares) ?? 0)), followers),
    ...(typeof p.ad_status === "string" ? { note: p.ad_status.slice(0, 120) } : {}),
  };
}

/** One channel's scrape; a failure becomes a note on that channel, the cost cap ends the step. */
async function channel(run: () => Promise<ChannelStats>, fallback: ChannelStats): Promise<ChannelStats> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof CostCapReached) throw err;
    return { ...fallback, note: `Could not be read (${err instanceof Error ? err.message.slice(0, 80) : "error"})` };
  }
}

export async function collectSocial(
  auditId: string,
  prospect: AuditProspect,
  site: WebsiteData | undefined,
  budget: Budget,
  now = Date.now(),
): Promise<StepResult<SocialData>> {
  const handles = socialHandles(prospect, site);
  const channels: ChannelStats[] = [];
  let costUsd = 0;
  const spend = async (key: Parameters<Budget["run"]>[1], input: Item) => {
    try {
      const r = await budget.run(auditId, key, input);
      costUsd += r.costUsd;
      return r.items;
    } catch (err) {
      costUsd += (err as { costUsd?: number }).costUsd ?? 0;
      throw err;
    }
  };
  let capped = false;
  let capNote = "";
  const guard = async (run: () => Promise<ChannelStats>, fallback: ChannelStats) => {
    if (capped) return;
    try {
      channels.push(await channel(run, fallback));
    } catch (err) {
      if (!(err instanceof CostCapReached)) throw err;
      capped = true;
      capNote = err.message;
    }
  };
  if (handles.instagram) {
    const h = handles.instagram;
    await guard(async () => instagramStats(h, await spend("instagram", { usernames: [h], includeAboutSection: false }), now), { channel: "instagram", handle: h });
  }
  if (handles.tiktok) {
    const h = handles.tiktok;
    const input = { profiles: [h], profileScrapeSections: ["videos"], profileSorting: "latest", resultsPerPage: 12, excludePinnedPosts: true };
    await guard(async () => tiktokStats(h, await spend("tiktok", input), now), { channel: "tiktok", handle: h });
  }
  if (handles.facebook) {
    const url = handles.facebook;
    await guard(async () => {
      const page = await spend("facebookPage", { startUrls: [{ url }] });
      const posts = await spend("facebookPosts", { startUrls: [{ url }], resultsLimit: 10, onlyPostsNewerThan: "60 days" }).catch((err: unknown) => {
        if (err instanceof CostCapReached) throw err;
        return [] as Item[];
      });
      return facebookStats(url, page, posts, now);
    }, { channel: "facebook", handle: url, url });
  }
  // X and LinkedIn have no cheap, reliable scrapers; they are listed for the analyst without numbers.
  if (handles.x) channels.push({ channel: "x", handle: handles.x, note: "Found on the site; not measured" });
  if (handles.linkedin) channels.push({ channel: "linkedin", handle: handles.linkedin, url: handles.linkedin, note: "Found on the site; not measured" });
  const measured = channels.filter((c) => c.followers !== undefined);
  if (channels.length === 0) {
    return { status: "skipped", costUsd, note: capped ? capNote : "No social profiles found on the CRM record or the website" };
  }
  const summary = measured.map((c) => `${c.channel} ${c.followers?.toLocaleString("en-US")}`).join(", ");
  return {
    status: "done",
    data: { channels },
    costUsd,
    note: `${measured.length} of ${channels.length} profiles measured${summary ? `: ${summary}` : ""}${capped ? " (cost cap reached)" : ""}`,
  };
}
