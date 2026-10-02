import {
  AUDIT_STEPS,
  type AuditFinding,
  type AuditProspect,
  type AuditScore,
  type AuditStatus,
  type AuditStep,
  type AuditStepId,
  type Grade,
  type ProspectAudit,
  type StartAuditRequest,
  type StepStatus,
} from "@shared/audits";

/** Zain Growth's division colour, the panel accent. */
export const AUDITS_COLOR = "#3DBE7A";

export const AUDIT_POLL_ACTIVE_MS = 2_000;
export const AUDIT_POLL_IDLE_MS = 30_000;

export const STEP_LABEL: Record<AuditStepId, string> = {
  website: "Website crawl",
  search: "Search rankings",
  social: "Social profiles",
  ads: "Paid ads",
  score: "Scoring",
  analysis: "Analyst write-up",
  pdf: "PDF report",
  crm: "Filed in CRM",
  notion: "Notion row",
};

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  pending: "Pending",
  running: "Running",
  done: "Done",
  skipped: "Skipped",
  failed: "Failed",
};

export const STATUS_LABEL: Record<AuditStatus, string> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export type SectionId = keyof AuditScore["sections"];

export const SECTIONS: readonly SectionId[] = ["website", "search", "social", "ads", "tracking"];

export const SECTION_LABEL: Record<SectionId, string> = {
  website: "Website & SEO",
  search: "Search visibility",
  social: "Social",
  ads: "Paid ads",
  tracking: "Tracking",
};

export const GRADE_HINT: Record<Grade, string> = {
  A: "Strong",
  B: "Good",
  C: "Average",
  D: "Weak",
  E: "Poor",
};

const ACTIVE: ReadonlySet<AuditStatus> = new Set(["queued", "running"]);

export function isAuditActive(audit: Pick<ProspectAudit, "status">): boolean {
  return ACTIVE.has(audit.status);
}

/** Poll fast while any audit is still working, slowly once they have all settled. */
export function auditsPollInterval(audits: readonly Pick<ProspectAudit, "status">[] | undefined): number {
  return audits?.some(isAuditActive) ? AUDIT_POLL_ACTIVE_MS : AUDIT_POLL_IDLE_MS;
}

/** All nine steps in pipeline order; steps the server has not reported yet are pending. */
export function orderedSteps(steps: readonly AuditStep[]): AuditStep[] {
  return AUDIT_STEPS.map((id) => steps.find((s) => s.id === id) ?? { id, status: "pending" as const });
}

export function stepsFinished(steps: readonly AuditStep[]): number {
  return orderedSteps(steps).filter((s) => s.status === "done" || s.status === "skipped").length;
}

export function stepTooltip(step: AuditStep): string {
  const head = `${STEP_LABEL[step.id]}: ${STEP_STATUS_LABEL[step.status]}`;
  return step.note ? `${head}. ${step.note}` : head;
}

/** Seconds a step took, or has been running for when it has not finished. */
export function stepDuration(step: AuditStep, now: number): number | null {
  if (!step.startedAt) return null;
  return Math.max(0, Math.round((step.finishedAt ?? now) - step.startedAt));
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** "2 Oct 2026" from unix seconds. */
export function auditDate(at: number): string {
  return new Date(at * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatCost(usd: number | undefined): string {
  if (usd === undefined) return "—";
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

/** Total spend: the server's figure, else the sum of the steps. */
export function auditCost(audit: Pick<ProspectAudit, "costUsd" | "steps">): number | undefined {
  if (audit.costUsd !== undefined) return audit.costUsd;
  const costs = audit.steps.map((s) => s.costUsd).filter((c): c is number => c !== undefined);
  return costs.length ? costs.reduce((a, b) => a + b, 0) : undefined;
}

export function domainOf(website: string): string {
  try {
    return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, "");
  } catch {
    return website;
  }
}

export function websiteHref(website: string): string {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

export type UrlCheck = { ok: true; url: string; domain: string } | { ok: false; error: string };

const HOST = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** A public http(s) site: scheme optional, a dotted hostname with a real TLD, no spaces or credentials. */
export function checkWebsite(input: string): UrlCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Enter the prospect's website." };
  if (/\s/.test(raw)) return { ok: false, error: "A website address has no spaces." };
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) return { ok: false, error: "Use an http or https address." };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "That does not look like a website address." };
  }
  if (url.username || url.password) return { ok: false, error: "Leave out any user name or password." };
  if (!HOST.test(url.hostname)) return { ok: false, error: "Use a full domain, like example.com." };
  const href = url.pathname === "/" && !url.search && !url.hash ? url.origin : url.href;
  return { ok: true, url: href, domain: url.hostname.replace(/^www\./, "") };
}

export type SocialKey = "instagram" | "tiktok" | "facebook" | "x" | "linkedin";

export const SOCIALS: readonly { key: SocialKey; label: string; placeholder: string }[] = [
  { key: "instagram", label: "Instagram", placeholder: "@handle or profile URL" },
  { key: "tiktok", label: "TikTok", placeholder: "@handle or profile URL" },
  { key: "facebook", label: "Facebook", placeholder: "Page URL" },
  { key: "x", label: "X", placeholder: "@handle or profile URL" },
  { key: "linkedin", label: "LinkedIn", placeholder: "Company page URL" },
];

export type SocialInputs = Partial<Record<SocialKey, string>>;

function trimmedSocials(socials: SocialInputs): StartAuditRequest["socials"] | undefined {
  const entries = SOCIALS.map(({ key }) => [key, socials[key]?.trim() ?? ""] as const).filter(([, v]) => v);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** The start request for a pasted website, or the validation error. */
export function websiteRequest(website: string, name: string, socials: SocialInputs): { request: StartAuditRequest } | { error: string } {
  const check = checkWebsite(website);
  if (!check.ok) return { error: check.error };
  const s = trimmedSocials(socials);
  const n = name.trim();
  return { request: { website: check.url, ...(n ? { name: n } : {}), ...(s ? { socials: s } : {}) } };
}

/** True when a step failed or was skipped because Apify has no token. */
export function isApifyMissing(note: string | undefined): boolean {
  return !!note && /apify\b.*\bnot connected|APIFY_TOKEN/i.test(note);
}

export function apifyMissing(audit: Pick<ProspectAudit, "steps" | "error">): boolean {
  return isApifyMissing(audit.error) || audit.steps.some((s) => isApifyMissing(s.note));
}

const SEVERITY_RANK: Record<AuditFinding["severity"], number> = { high: 0, medium: 1, low: 2 };

/** Findings by section in section order, most severe first; empty sections are left out. */
export function groupFindings(findings: readonly AuditFinding[]): { section: SectionId; findings: AuditFinding[] }[] {
  return SECTIONS.map((section) => ({
    section,
    findings: findings.filter((f) => f.section === section).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]),
  })).filter((g) => g.findings.length > 0);
}

/** Failed or cancelled audits, and finished ones with a failed step (a CRM or Notion filing, say), can be rerun. */
export function canRetry(audit: Pick<ProspectAudit, "status" | "steps">): boolean {
  if (audit.status === "failed" || audit.status === "cancelled") return true;
  return audit.status === "done" && audit.steps.some((s) => s.status === "failed");
}

export function canCancel(audit: Pick<ProspectAudit, "status">): boolean {
  return isAuditActive(audit);
}

export function prospectLabel(prospect: Pick<AuditProspect, "name" | "website">): string {
  return prospect.name.trim() || domainOf(prospect.website);
}

/** Newest first. */
export function sortAudits(audits: readonly ProspectAudit[]): ProspectAudit[] {
  return [...audits].sort((a, b) => b.createdAt - a.createdAt);
}

/** Only http(s) links from the server become hrefs. */
export function safeHref(url: string | undefined): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}
