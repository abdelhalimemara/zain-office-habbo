import type { AuditStepId, ProspectAudit } from "../../../../shared/audits";

/** Tracking tags seen in the crawl (or flagged on the CRM record). */
export interface Trackers {
  metaPixel: boolean;
  gtm: boolean;
  ga4: boolean;
  tiktokPixel: boolean;
  snapPixel: boolean;
}

export type SocialChannel = "instagram" | "tiktok" | "facebook" | "x" | "linkedin";

/** The crawl, reduced to what scoring, the analyst and the PDF need. */
export interface WebsiteData {
  pages: number;
  https: boolean;
  /** Share of pages (0..1) with a 10..65 character title, a 50..160 character meta description, exactly one H1. */
  goodTitles: number;
  goodMetas: number;
  oneH1: number;
  avgWords: number;
  images: number;
  imagesNoAlt: number;
  schemaTypes: string[];
  viewport: boolean;
  avgInternalLinks: number;
  /** Pages whose language is Arabic / English. */
  arabicPages: number;
  englishPages: number;
  trackers: Trackers;
  socialLinks: Partial<Record<SocialChannel, string>>;
  title?: string;
  description?: string;
  /** H1/H2 texts of the home page and a few others, for search queries and the analyst. */
  headings: string[];
}

export interface QueryResult {
  query: string;
  /** The prospect's best organic position, 1-based, when it shows on page one. */
  position?: number;
  topDomains: string[];
  ads: number;
}

export interface SearchData {
  queries: QueryResult[];
  /** Domains that outrank the prospect most often, with how many target searches they show for. */
  competitors: { domain: string; appearances: number }[];
}

export interface ChannelStats {
  channel: SocialChannel;
  handle: string;
  url?: string;
  followers?: number;
  /** Posts (or videos) in the last 30 days, per week. */
  postsPerWeek?: number;
  /** Average interactions per post divided by followers, 0..1. */
  engagementRate?: number;
  /** Paid posts seen in the feed (TikTok marks them). */
  adsInFeed?: number;
  note?: string;
}

export interface SocialData {
  channels: ChannelStats[];
}

export interface AdsData {
  meta?: { activeAds: number; oldestDays?: number; platforms: string[]; pageName?: string };
  google?: { ads: number; formats: string[]; longestDays?: number; recentlyShown: number };
  tiktokAdsInFeed?: number;
}

/** CRM flags that back up what the crawl finds (the lead object carries them). */
export interface CrmFlags {
  hasPixel?: boolean;
  hasGoogleTagManager?: boolean;
  metaAdLibraryUrl?: string;
}

export interface CollectedData {
  website?: WebsiteData;
  search?: SearchData;
  social?: SocialData;
  ads?: AdsData;
}

export interface StoredAudit {
  id: string;
  audit: ProspectAudit;
  data: CollectedData;
  crmFlags?: CrmFlags;
  analysisTask?: { taskId?: string; assignee: string; startedAt: number };
  crm?: { fileId?: string; attachmentId?: string; noteId?: string };
  notionPageId?: string;
}

export function isStoredAudit(v: unknown): v is StoredAudit {
  const s = v as StoredAudit;
  return !!s && typeof s.id === "string" && !!s.audit && Array.isArray(s.audit.steps) && typeof s.data === "object";
}

/** The outcome of a collection step. */
export interface StepResult<T> {
  status: "done" | "skipped";
  data?: T;
  note: string;
  costUsd: number;
}

export const COLLECT_STEPS = ["website", "search", "social", "ads"] as const satisfies readonly AuditStepId[];
