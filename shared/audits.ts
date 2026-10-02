/**
 * Zain Growth prospect audits: a prospect's website and channels go through a fixed pipeline (Apify scrapes,
 * deterministic scoring, an analyst agent's write-up), become a branded Zain Growth PDF, and are filed on the
 * prospect in the CRM and in the Notion "Prospect Audits" database.
 */

export type AuditStepId =
  | "website" // Apify crawl of the site (pages, titles, meta, headings, content, schema), tag read, mobile screenshot
  | "search" // Apify Google SERP: brand and category queries, who else appears (competitors), SEO gaps
  | "social" // Apify profile scrapes: followers, posting cadence, engagement per channel (prospect + competitors)
  | "ads" // Apify ad libraries: Google Ads Transparency, Meta Ad Library (prospect + competitors); traffic estimates
        // (Similarweb) and Google Maps rating/reviews are collected here too
  | "score" // deterministic scoring from the collected data
  | "analysis" // the Growth audit agent writes the findings and recommendations (Hermes kanban task)
  | "pdf" // branded Zain Growth PDF
  | "crm" // PDF attached to the lead/company, plus a summary note
  | "notion"; // row in the Prospect Audits database with the PDF and links

export const AUDIT_STEPS: readonly AuditStepId[] = ["website", "search", "social", "ads", "score", "analysis", "pdf", "crm", "notion"];

export type StepStatus = "pending" | "running" | "done" | "skipped" | "failed";

export interface AuditStep {
  id: AuditStepId;
  status: StepStatus;
  /** Unix seconds. */
  startedAt?: number;
  finishedAt?: number;
  /** One line for the UI: what was found, why it was skipped, or the error. */
  note?: string;
  /** Apify spend for this step, USD. */
  costUsd?: number;
}

export type AuditStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface AuditProspect {
  name: string;
  website: string;
  /** Twenty CRM ids, when the audit was started from a CRM record. */
  leadId?: string;
  companyId?: string;
  instagram?: string;
  tiktok?: string;
  facebook?: string;
  x?: string;
  linkedin?: string;
  city?: string;
  category?: string;
}

export type Grade = "A" | "B" | "C" | "D" | "E";

/**
 * The seven areas of the Zain Growth "Digital Gap Audit" template (/Users/abdelhalimemara/Desktop/Zain Studio/Zain_Documents/Templates/
 * Digital Marketing Audit Gap Template.pdf, outside the repo). Every area gets a status and, when it is a gap, a severity; "not-measured" is honest coverage,
 * not a finding.
 */
export type AuditArea =
  | "website" // Website and Infrastructure
  | "brand" // Brand and Local Presence
  | "search" // Non-brand Search Demand
  | "social" // Social and Content
  | "performance" // Performance Media and Measurement
  | "conversion" // Conversion and CRM
  | "reputation"; // Reputation and Compliance

export const AUDIT_AREAS: readonly AuditArea[] = ["website", "brand", "search", "social", "performance", "conversion", "reputation"];

export const AUDIT_AREA_LABELS: Record<AuditArea, string> = {
  website: "Website and Infrastructure",
  brand: "Brand and Local Presence",
  search: "Non-brand Search Demand",
  social: "Social and Content",
  performance: "Performance Media and Measurement",
  conversion: "Conversion and CRM",
  reputation: "Reputation and Compliance",
};

/** Strong: nothing material missing. Fair: real gaps, fixable inside a programme. Weak: missing or broken. */
export type AreaStatus = "strong" | "fair" | "weak" | "not-measured";
export type Severity = "critical" | "high" | "medium" | "low";

/** How a fact is known: quoted from a live source, estimated by a third party, or not measured this pass. */
export type EvidenceKind = "quoted" | "estimated" | "not-measured";

export interface Evidence {
  text: string;
  kind: EvidenceKind;
  /** Source label shown in the report, e.g. "research_search (Apify, live)", "Similarweb, Aug 2026". */
  source: string;
}

export interface AreaResult {
  area: AuditArea;
  status: AreaStatus;
  /** Only for a gap (fair/weak). */
  severity?: Severity;
  /** 0..100 for the overall score; absent when not measured (its weight is redistributed). */
  score?: number;
  /** Share of the overall score, 0..1; the weights of the seven areas sum to 1. */
  weight: number;
  /** One-line summary shown in the "Seven Areas, At a Glance" table. */
  summary: string;
  evidence: Evidence[];
}

export interface AuditScore {
  /** 0..100 over the measured areas. */
  overall: number;
  grade: Grade;
  /** e.g. 5 of 7. */
  areasMeasured: number;
  areas: AreaResult[];
}

/** One business in the benchmark: the prospect first, then up to three competitors, same public measures. */
export interface BenchmarkRow {
  name: string;
  domain?: string;
  isProspect: boolean;
  googleAds?: { active: number; formats?: string; since?: string } | "none" | "not-measured";
  metaAds?: { active: number; note?: string } | "none" | "not-measured";
  instagramFollowers?: number | "not-measured";
  /** Similarweb-style estimates, directional only. */
  traffic?: { monthlyVisits: number; bounceRate?: number; topSource?: string; saudiShare?: number; period: string } | "not-measured";
  /** Semrush via Apify, estimated. */
  authorityScore?: number;
  organicTraffic?: number;
}

/** Semrush (via Apify) SEO read of the prospect's domain; every figure is an estimate. */
export interface SeoRead {
  source: string;
  authorityScore?: number;
  organicKeywords?: number;
  organicTraffic?: number;
  backlinks?: number;
  referringDomains?: number;
  topKeywords: { keyword: string; position: number; volume?: number; url?: string }[];
  topPages: { url: string; traffic?: number }[];
  issues: { title: string; severity: Severity; count?: number }[];
  competitors: { domain: string; commonKeywords?: number; authorityScore?: number }[];
}

export interface SearchRun {
  query: string;
  kind: "brand" | "category";
  prospectPresent: boolean;
  /** Who else appears (domains). */
  others: string[];
}

export interface SocialChannelRow {
  channel: "instagram" | "tiktok" | "facebook" | "x" | "linkedin" | "youtube" | "snapchat";
  followers?: number;
  posts?: number;
  postsPer30Days?: number;
  /** Engagement rate on the sampled posts, 0..1. */
  engagement?: number;
  lastPost?: string;
  measured: boolean;
}

export interface TagRead {
  /** e.g. "GA4", "Google Tag Manager", "Meta Pixel", "TikTok Pixel", "Snapchat Pixel", "LinkedIn Insight Tag", "X Pixel", "Hotjar / Clarity", "Google Ads conversion tag". */
  tag: string;
  found: boolean;
}

export interface AuditFinding {
  area: AuditArea;
  title: string;
  detail: string;
  severity: Severity;
  evidence?: EvidenceKind;
  source?: string;
}

/** The template's three-phase fix: Foundation, Demand Capture, Demand Generation. */
export interface FixPhase {
  phase: 1 | 2 | 3;
  name: string;
  headline: string;
  detail: string;
}

export interface AuditOpportunity {
  title: string;
  /** Which Zain Growth (or Studio/Tech) service addresses it. */
  service: string;
  impact: "high" | "medium" | "low";
  effort: "S" | "M" | "L";
}

export interface AuditAnalysis {
  /** Cover subtitle: one sentence on what the audit covers. */
  coverLine: string;
  /** The goal box on the cover, e.g. "show where X already wins, and where the category is being taken by others." */
  goal: string;
  /** Executive summary sub-headline (one sentence). */
  headline: string;
  /** "What we found": three to five sentences. */
  executiveSummary: string;
  /** The three summary cards. */
  keyPoints: { title: string; detail: string }[];
  /** One-line bottom line per page key ("summary", "search", "paid", "social", "traffic", "competitive", "close"). */
  bottomLines: Record<string, string>;
  /** Ordered by severity. */
  findings: AuditFinding[];
  fix: FixPhase[];
  northStar: string;
  nextStep: string;
  /** Closing page: headline and the three numbered next steps. */
  closingHeadline: string;
  closingSteps: string[];
  opportunities: AuditOpportunity[];
  /** How Ahmad should open the conversation, one or two sentences. */
  pitchAngle: string;
}

export interface ProspectAudit {
  id: string;
  prospect: AuditProspect;
  status: AuditStatus;
  steps: AuditStep[];
  score?: AuditScore;
  benchmark?: BenchmarkRow[];
  searchRuns?: SearchRun[];
  social?: SocialChannelRow[];
  tags?: TagRead[];
  seo?: SeoRead;
  /** Served by the Zain HQ server: the mobile home-page capture for "What a Visitor Sees". */
  screenshotPath?: string;
  analysis?: AuditAnalysis;
  /** Served by the Zain HQ server once rendered. */
  pdfPath?: string;
  crmAttachmentId?: string;
  crmUrl?: string;
  notionPageUrl?: string;
  /** Total Apify spend, USD. */
  costUsd?: number;
  requestedBy: "hq" | "agent";
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface StartAuditRequest {
  /** Start from a CRM lead or company (website and socials are read from it), or give the website directly. */
  leadId?: string;
  companyId?: string;
  website?: string;
  name?: string;
  socials?: Pick<AuditProspect, "instagram" | "tiktok" | "facebook" | "x" | "linkedin">;
}

export interface AuditsResponse {
  audits: ProspectAudit[];
}

export interface AuditResponse {
  audit: ProspectAudit;
}

export const AUDITS_API = {
  list: "/api/growth/audits",
  one: (id: string) => `/api/growth/audits/${encodeURIComponent(id)}`,
  pdf: (id: string) => `/api/growth/audits/${encodeURIComponent(id)}/pdf`,
  /** POST: rerun the failed or skipped steps from the first one that did not finish. */
  retry: (id: string) => `/api/growth/audits/${encodeURIComponent(id)}/retry`,
  cancel: (id: string) => `/api/growth/audits/${encodeURIComponent(id)}/cancel`,
} as const;

/** Hard cap on Apify spend for one audit; a step that would exceed it is skipped with a note. */
export const AUDIT_MAX_COST_USD = 3;
