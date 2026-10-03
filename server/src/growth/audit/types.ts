import type { AuditStatus, AuditStepId, ProspectAudit, SearchRun, SeoRead, SocialChannelRow } from "../../../../shared/audits";

/** Tags seen in the crawl's HTML and window globals (or flagged on the CRM record). */
export interface Trackers {
  ga4: boolean;
  gtm: boolean;
  metaPixel: boolean;
  tiktokPixel: boolean;
  snapPixel: boolean;
  linkedinInsight: boolean;
  xPixel: boolean;
  hotjarClarity: boolean;
  googleAdsConversion: boolean;
}

export type SocialChannel = SocialChannelRow["channel"];

/** The crawl, reduced to what scoring, the analyst and the report need. */
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
  arabicPages: number;
  englishPages: number;
  trackers: Trackers;
  socialLinks: Partial<Record<SocialChannel, string>>;
  /** Shopify, Salla, Zid, WordPress/WooCommerce, Wix, Webflow... when the HTML gives it away. */
  platform?: string;
  /** Policy/trust pages linked from the site (shipping, returns, privacy, terms). */
  policyPages: string[];
  /** Ways to reach the business from the site: WhatsApp, phone, email, a form. */
  contactPaths: string[];
  /** The site shows customer reviews/testimonials of its own. */
  reviewsOnSite: boolean;
  title?: string;
  description?: string;
  headings: string[];
}

/** A business benchmarked against the prospect, chosen from the category searches (or Semrush's organic competitors). */
export interface Competitor {
  domain: string;
  name: string;
  instagram?: string;
  /** How it was found: Semrush keyword overlap (preferred) or the category searches (fallback). */
  source?: "semrush" | "search";
  /** Organic keywords it shares with the prospect, and Semrush's competition level 0..1 (estimated). */
  commonKeywords?: number;
  competitionLevel?: number;
  /** Found as an organic competitor of this Saudi candidate (the prospect's own overlap was too thin), and its brand. */
  via?: string;
  viaName?: string;
}

export interface SearchData {
  runs: SearchRun[];
}

/** Semrush, prospect plus the competitors' overview numbers. */
export interface SeoData {
  read: SeoRead;
  competitors: Record<string, { authorityScore?: number; organicTraffic?: number; organicKeywords?: number }>;
}

export interface SocialData {
  rows: SocialChannelRow[];
  /** Instagram followers per competitor domain; absent when no handle was found. */
  competitorInstagram: Record<string, number | "not-measured">;
}

export interface GoogleAdsRead {
  active: number;
  total: number;
  formats: string[];
  /** ISO date of the earliest first-shown ad, and of the latest last-shown one. */
  since?: string;
  lastSeen?: string;
  advertiser?: string;
}

export interface TrafficRead {
  monthlyVisits: number;
  /** 0..1 */
  bounceRate?: number;
  topSource?: string;
  /** 0..1 */
  saudiShare?: number;
  period: string;
  /** 0..1 share of visits from organic and paid search. */
  organicShare?: number;
  paidShare?: number;
}

export interface MapsRead {
  title: string;
  rating?: number;
  reviews?: number;
  url?: string;
  category?: string;
}

/** Per business, keyed by domain; a missing key means not measured, "none" means measured and nothing found. */
export interface AdsData {
  google: Record<string, GoogleAdsRead | "none">;
  meta: Record<string, { active: number; pageName?: string } | "none">;
  traffic: Record<string, TrafficRead>;
  maps?: MapsRead | "none";
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
  seo?: SeoData;
  competitors?: Competitor[];
  social?: SocialData;
  ads?: AdsData;
  /** "2 October 2026": the date every source label carries. */
  asOf?: string;
}

export interface StoredAudit {
  id: string;
  audit: ProspectAudit;
  data: CollectedData;
  crmFlags?: CrmFlags;
  /** The kanban task of the agent that started this audit; told the outcome once per run (reportedStatus). */
  parent?: { taskId: string; reportedStatus?: AuditStatus };
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
