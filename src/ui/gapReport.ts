import {
  AUDIT_AREA_LABELS,
  AUDIT_AREAS,
  type AreaResult,
  type AreaStatus,
  type AuditArea,
  type AuditFinding,
  type BenchmarkRow,
  type SocialChannelRow,
  type EvidenceKind,
  type ProspectAudit,
  type Severity,
} from "@shared/audits";

/** Pure helpers for the Digital Gap Audit report view (the founder's template, pages 2, 3, 7, 11 and 12). */

export const AREA_STATUS_LABEL: Record<AreaStatus, string> = {
  strong: "Strong",
  fair: "Fair",
  weak: "Weak",
  "not-measured": "Not measured",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  quoted: "quoted",
  estimated: "estimated",
  "not-measured": "not measured",
};

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function areaLabel(area: AuditArea): string {
  return AUDIT_AREA_LABELS[area];
}

/** The seven areas in template order; an area the server left out shows as not measured. */
export function orderedAreas(areas: readonly AreaResult[]): AreaResult[] {
  return AUDIT_AREAS.map(
    (area) => areas.find((a) => a.area === area) ?? { area, status: "not-measured" as const, weight: 0, summary: "Not measured this pass.", evidence: [] },
  );
}

export function notMeasuredAreas(areas: readonly AreaResult[]): AuditArea[] {
  return orderedAreas(areas)
    .filter((a) => a.status === "not-measured")
    .map((a) => a.area);
}

/** Most severe first; the order the analyst gave is kept within a severity. */
export function sortFindings(findings: readonly AuditFinding[]): AuditFinding[] {
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => SEVERITY_RANK[a.f.severity] - SEVERITY_RANK[b.f.severity] || a.i - b.i)
    .map(({ f }) => f);
}

/** "quoted (research_search)", the evidence line of an area row. */
export function evidenceLine(area: AreaResult): string {
  return area.evidence.map((e) => `${EVIDENCE_LABEL[e.kind]} (${e.source})`).join(" / ");
}

export interface AuditKpis {
  gaps: number;
  critical: number;
  measured: number;
  total: number;
  visits?: { value: number; period: string };
}

/** The four tiles of the executive summary: gaps, critical, areas measured, estimated monthly visits. */
export function auditKpis(audit: Pick<ProspectAudit, "score" | "analysis" | "benchmark">): AuditKpis | null {
  if (!audit.score) return null;
  const areas = orderedAreas(audit.score.areas);
  const gapAreas = areas.filter((a) => a.status === "fair" || a.status === "weak");
  const findings = audit.analysis?.findings;
  const traffic = audit.benchmark?.find((r) => r.isProspect)?.traffic;
  return {
    gaps: findings ? findings.length : gapAreas.length,
    critical: findings ? findings.filter((f) => f.severity === "critical").length : gapAreas.filter((a) => a.severity === "critical").length,
    measured: audit.score.areasMeasured,
    total: AUDIT_AREAS.length,
    ...(traffic && traffic !== "not-measured" ? { visits: { value: traffic.monthlyVisits, period: traffic.period } } : {}),
  };
}

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** The prospect first, then competitors in the server's order. */
export function benchmarkRows(rows: readonly BenchmarkRow[]): BenchmarkRow[] {
  return [...rows.filter((r) => r.isProspect), ...rows.filter((r) => !r.isProspect)];
}

const NOT_MEASURED = "not measured";

export function googleAdsCell(v: BenchmarkRow["googleAds"]): string {
  if (v === undefined || v === "not-measured") return NOT_MEASURED;
  if (v === "none") return "None found";
  return [`${v.active} active`, v.formats, v.since && `since ${v.since}`].filter(Boolean).join(", ");
}

export function metaAdsCell(v: BenchmarkRow["metaAds"]): string {
  if (v === undefined || v === "not-measured") return NOT_MEASURED;
  if (v === "none") return "None attributable";
  return v.note ? `${v.active} active (${v.note})` : `${v.active} active`;
}

export function followersCell(v: BenchmarkRow["instagramFollowers"]): string {
  return v === undefined || v === "not-measured" ? NOT_MEASURED : formatCount(v);
}

export function visitsCell(v: BenchmarkRow["traffic"]): string {
  return v === undefined || v === "not-measured" ? NOT_MEASURED : `~${formatCount(v.monthlyVisits)} (est.)`;
}

/** An estimated figure: "~12,400", or a dash when the source had none. */
export function estimate(n: number | undefined): string {
  return n === undefined ? "—" : `~${formatCount(n)}`;
}

export function authorityCell(v: number | undefined): string {
  return v === undefined ? NOT_MEASURED : `${Math.round(v)} (est.)`;
}

export function organicCell(v: number | undefined): string {
  return v === undefined ? NOT_MEASURED : `~${formatCount(v)} (est.)`;
}

/** Most severe first; within a severity, the larger count first. */
export function sortIssues<T extends { severity: Severity; count?: number }>(issues: readonly T[]): T[] {
  return [...issues].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (b.count ?? 0) - (a.count ?? 0));
}

/** "/services/implants" from a full URL, so long URLs fit the panel; the host is dropped. */
export function urlPath(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return url;
  }
}

/** Technical issues in severity groups, most severe first; empty groups are left out. */
export function groupIssues<T extends { severity: Severity; count?: number }>(issues: readonly T[]): { severity: Severity; issues: T[] }[] {
  const sorted = sortIssues(issues);
  return (["critical", "high", "medium", "low"] as const)
    .map((severity) => ({ severity, issues: sorted.filter((i) => i.severity === severity) }))
    .filter((g) => g.issues.length > 0);
}

export const CHANNEL_LABEL: Record<SocialChannelRow["channel"], string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  x: "X / Twitter",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  snapchat: "Snapchat",
};

/** 0.0017 -> "0.17%". */
export function formatRate(rate: number | undefined): string {
  if (rate === undefined) return "—";
  return `${(rate * 100).toFixed(rate < 0.1 ? 2 : 1)}%`;
}

export function countOrDash(n: number | undefined): string {
  return n === undefined ? "—" : formatCount(n);
}

/** Only a path on this server becomes the image source (the server serves the capture). */
export function screenshotSrc(path: string | undefined): string | undefined {
  return path && /^\/(?!\/)/.test(path) ? path : undefined;
}
