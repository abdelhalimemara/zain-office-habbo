/**
 * Zain Growth prospect audits: a prospect's website and channels go through a fixed pipeline (Apify scrapes,
 * deterministic scoring, an analyst agent's write-up), become a branded Zain Growth PDF, and are filed on the
 * prospect in the CRM and in the Notion "Prospect Audits" database.
 */

export type AuditStepId =
  | "website" // Apify crawl of the site: pages, titles, meta, headings, content, schema, tracking tags
  | "search" // Apify Google SERP: what they rank for, who outranks them (competitors), SEO gaps
  | "social" // Apify profile scrapes: followers, posting cadence, engagement per channel
  | "ads" // Apify ad libraries: Meta Ad Library, Google Ads Transparency (and TikTok where available)
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

export interface SectionScore {
  /** 0..100 */
  score: number;
  /** Share of the overall score, 0..1; the weights sum to 1. */
  weight: number;
  /** The 2-4 facts that drove this score, short. */
  drivers: string[];
}

export interface AuditScore {
  /** 0..100 */
  overall: number;
  grade: Grade;
  sections: {
    website: SectionScore; // on-page SEO and content quality
    search: SectionScore; // rankings and visibility vs competitors
    social: SectionScore; // audience, cadence, engagement
    ads: SectionScore; // paid presence and maturity (a gap = opportunity, not a failing)
    tracking: SectionScore; // pixel, GTM, analytics, conversion readiness
  };
}

export interface AuditFinding {
  section: keyof AuditScore["sections"];
  title: string;
  detail: string;
  severity: "high" | "medium" | "low";
}

export interface AuditOpportunity {
  title: string;
  /** Which Zain Growth (or Studio/Tech) service addresses it. */
  service: string;
  impact: "high" | "medium" | "low";
  effort: "S" | "M" | "L";
}

export interface AuditAnalysis {
  /** Three to five sentences a founder can read in 30 seconds. */
  executiveSummary: string;
  findings: AuditFinding[];
  opportunities: AuditOpportunity[];
  competitors: { name: string; domain?: string; note: string }[];
  /** How Ahmad should open the conversation, one or two sentences. */
  pitchAngle: string;
}

export interface ProspectAudit {
  id: string;
  prospect: AuditProspect;
  status: AuditStatus;
  steps: AuditStep[];
  score?: AuditScore;
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
