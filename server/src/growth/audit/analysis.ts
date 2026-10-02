import {
  AUDIT_AREAS,
  AUDIT_AREA_LABELS,
  type AuditAnalysis,
  type AuditArea,
  type AuditFinding,
  type AuditOpportunity,
  type AuditScore,
  type EvidenceKind,
  type FixPhase,
  type ProspectAudit,
  type Severity,
} from "../../../../shared/audits";
import { brandRun } from "./collect/search";
import { gaps, lcFirst } from "./score";
import { siteHost } from "./url";
import type { CollectedData } from "./types";

export const AUDIT_AGENT = "zain-growth-audit";
/** Until the Prospect Audit Lead is hired, the Growth analyst writes the analysis. */
export const FALLBACK_AGENT = "zain-growth-analyst";
export const ANALYSIS_TITLE_PREFIX = "Prospect audit · ";
export const BOTTOM_LINE_KEYS = ["summary", "search", "paid", "social", "traffic", "competitive", "close"] as const;
export const FIX_NAMES = ["Foundation", "Demand Capture", "Demand Generation"] as const;
const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low"];

/** The Zain service that answers a gap in each area. */
export const SERVICE_FOR: Record<AuditArea, string> = {
  website: "Zain Studio · Website & technical SEO",
  brand: "Zain Growth · Local SEO & Google Business Profile",
  search: "Zain Growth · SEO & AI Search",
  social: "Zain Studio · Social content & community",
  performance: "Zain Growth · Tracking setup & paid media",
  conversion: "Zain Growth · CRO & CRM automation",
  reputation: "Zain Growth · Reviews & reputation programme",
};

export const marker = (auditId: string) => `<!-- zain-audit:${auditId} -->`;
const lower = (area: AuditArea) => AUDIT_AREA_LABELS[area].toLowerCase();
const list3 = (items: readonly string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const fmt = (n: number) => n.toLocaleString("en-US");

/** The analysis written from the scores and data alone: the agent's starting draft, and the fallback when its answer is unusable. */
export function draftAnalysis(audit: ProspectAudit, score: AuditScore, data: CollectedData): AuditAnalysis {
  const name = audit.prospect.name;
  const host = siteHost(audit.prospect.website);
  const order = (s?: Severity) => SEVERITIES.indexOf(s ?? "low");
  const open = gaps(score).sort((a, b) => order(a.severity) - order(b.severity) || (a.score ?? 0) - (b.score ?? 0));
  const strong = score.areas.filter((a) => a.status === "strong");
  const notMeasured = score.areas.filter((a) => a.status === "not-measured");
  // Only vetted peers (the ads step makes the final cut) may be quoted in the report.
  const competitors = data.ads ? (data.competitors ?? []) : [];
  const traffic = data.ads?.traffic ?? {};
  const own = traffic[host]?.monthlyVisits;
  const leader = competitors.map((c) => ({ c, v: traffic[c.domain]?.monthlyVisits ?? 0 })).sort((a, b) => b.v - a.v)[0];
  const brand = brandRun(data.search?.runs);
  const categoryRuns = data.search?.runs.filter((r) => r.kind === "category") ?? [];
  const inCategory = categoryRuns.filter((r) => r.prospectPresent).length;
  const t = data.website?.trackers;
  const missingTags = t ? [!t.ga4 && "GA4", !t.gtm && "Google Tag Manager", !t.metaPixel && "Meta", !t.tiktokPixel && "TikTok", !t.snapPixel && "Snap"].filter(Boolean) : [];
  const findings: AuditFinding[] = open.map((a) => ({
    area: a.area,
    title: AUDIT_AREA_LABELS[a.area],
    detail: `${a.summary} ${a.evidence.filter((e) => e.kind !== "not-measured").slice(0, 1).map((e) => `(${e.kind}, ${e.source})`).join("")}`.trim(),
    severity: a.severity ?? "medium",
    evidence: (a.evidence[0]?.kind ?? "quoted") as EvidenceKind,
    source: a.evidence[0]?.source,
  }));
  const top = open[0];
  const second = open[1];
  const keyPoints = [
    strong[0]
      ? { title: `${AUDIT_AREA_LABELS[strong[0].area]} holds up`, detail: strong[0].summary }
      : brand?.prospectPresent
        ? { title: "Brand is owned in search", detail: `"${name}" returns the official site or its profiles in a live search (quoted).` }
        : { title: "A base to build on", detail: `${score.areasMeasured} of 7 areas could be measured from public data this pass.` },
    top ? { title: `${AUDIT_AREA_LABELS[top.area]}: ${top.status}`, detail: top.summary } : { title: "No material gaps", detail: "Every measured area is strong." },
    second ? { title: `${AUDIT_AREA_LABELS[second.area]}: ${second.status}`, detail: second.summary } : { title: "Coverage", detail: `${notMeasured.length} area(s) not measured this pass; not measured, not zero.` },
  ];
  const fix: FixPhase[] = [
    {
      phase: 1,
      name: FIX_NAMES[0],
      headline: "See what's already happening",
      detail: `${missingTags.length ? `Install ${missingTags.slice(0, 2).join(" and ")} first (they carry every other tag)${missingTags.length > 2 ? `, then ${missingTags.slice(2).join(", ")} pixels` : ""}` : "Audit the existing tags end to end"}${data.seo?.read.issues.length ? `; then fix: ${lcFirst(data.seo.read.issues[0]!.title)}` : ""}.`,
    },
    {
      phase: 2,
      name: FIX_NAMES[1],
      headline: inCategory < categoryRuns.length ? "Enter the category" : "Defend the category",
      detail: `Build landing content for the category searches where ${name} is absent${data.ads?.maps === "none" ? ", and claim the Google Business Profile / Maps listing" : ""}.`,
    },
    {
      phase: 3,
      name: FIX_NAMES[2],
      headline: "Open the next channel",
      detail: "With full-funnel tracking in place, test the paid channel competitors are not using yet, and grow social engagement, not just cadence.",
    },
  ];
  const opportunities: AuditOpportunity[] = open.slice(0, 5).map((a, i) => ({
    title: findings[i]!.title,
    service: SERVICE_FOR[a.area],
    impact: a.severity === "critical" || a.severity === "high" ? "high" : a.severity === "medium" ? "medium" : "low",
    effort: a.area === "performance" ? "S" : a.area === "search" || a.area === "social" ? "L" : "M",
  }));
  const igMeasured = data.social?.rows.find((r) => r.channel === "instagram" && r.measured);
  const googleRivals = competitors.filter((c) => {
    const g = data.ads?.google[c.domain];
    return g && g !== "none" && g.active > 0;
  }).length;
  return {
    coverLine: `An outside-in review of ${host}: what the site and its tags show, what live search and social already say about the brand, and how it compares with ${competitors.length || "its"} Saudi competitors in the same category. Built from public data only.`,
    goal: `Goal: show where ${name} already wins, and where the category is being taken by others.`,
    headline: top
      ? `${strong.length ? `${list3(strong.slice(0, 2).map((a) => lower(a.area)))[0]!.toUpperCase()}${list3(strong.slice(0, 2).map((a) => lower(a.area))).slice(1)} ${strong.length > 1 ? "hold" : "holds"} up, but ` : ""}${strong.length ? lower(top.area) : AUDIT_AREA_LABELS[top.area]} is the biggest gap.`
      : "Every measured area is in good shape.",
    executiveSummary: [
      brand ? (brand.prospectPresent ? `A live search for "${name}" returns the official site.` : `A live search for "${name}" does not return the official site.`) : "",
      ...open.slice(0, 2).map((a) => a.summary),
      leader && own !== undefined && leader.v > own ? `${leader.c.name} draws an estimated ${fmt(leader.v)} monthly visits against ${fmt(own)} (Similarweb).` : "",
    ]
      .filter(Boolean)
      .join(" "),
    keyPoints,
    bottomLines: {
      summary: top ? `The gap is ${lower(top.area)}${second ? ` and ${lower(second.area)}` : ""}, not brand presence.` : "A strong base: the work is scale, not repair.",
      search: categoryRuns.length ? (inCategory === categoryRuns.length ? "The name and the category are both owned." : `${brand?.prospectPresent ? "The name is owned" : "Even the name is not owned"}; the category is not — yet.`) : "Search was not measured this pass.",
      paid: googleRivals ? `Google demand is being fought by ${googleRivals + 1 > 2 ? "several players" : "competitors"}; the open lanes are where they are absent.` : "Paid search in this category is still open.",
      social: igMeasured ? `Instagram has ${fmt(igMeasured.followers ?? 0)} followers at ${(((igMeasured.engagement ?? 0) as number) * 100).toFixed(2)}% engagement.` : "Social presence could not be confirmed this pass.",
      traffic: leader && leader.v ? "The traffic gap tracks the search gap: the business that owns organic search owns the visits." : "Traffic estimates were not available for this set.",
      competitive: `${name} ${own !== undefined && leader && leader.v > own ? "trails on estimated traffic" : "holds its own on traffic"}${igMeasured ? " and is measured on Instagram" : ""}.`,
      close: `${name} is already in the market — the fix is to see what current activity returns, repair what blocks search, and then open the category and channels still sitting empty.`,
    },
    findings,
    fix,
    northStar: "Purchase conversion rate and cost per acquisition, once full-funnel tracking is in place — to define precisely with the client's margin and order value.",
    nextStep: "A 45-minute walkthrough of these findings and the phased programme.",
    closingHeadline: top ? "Turn active demand into measured, compounding growth." : "Scale what already works, with measurement first.",
    closingSteps: ["Confirm tracking access (GA4, GTM, pixels)", "Approve the phased programme", "Start Phase 1: Foundation"],
    opportunities: opportunities.length ? opportunities : [{ title: "Scale what already works", service: SERVICE_FOR.performance, impact: "medium", effort: "M" }],
    pitchAngle: top ? `Open with ${lower(top.area)}: ${top.summary}` : "Open with what already works and how measurement would let them scale it.",
  };
}

/** What the agent gets: the facts, the scores and a draft to sharpen, with the exact JSON to answer with. */
export function analysisTaskBody(audit: ProspectAudit, data: CollectedData, score: AuditScore): string {
  const facts = {
    prospect: audit.prospect,
    score,
    benchmark: audit.benchmark,
    searchRuns: audit.searchRuns,
    social: audit.social,
    tags: audit.tags,
    seo: audit.seo && { ...audit.seo, topKeywords: audit.seo.topKeywords.slice(0, 8) },
    maps: data.ads?.maps,
    website: data.website && { platform: data.website.platform, policyPages: data.website.policyPages, contactPaths: data.website.contactPaths, headings: data.website.headings.slice(0, 6) },
    stepNotes: Object.fromEntries(audit.steps.filter((s) => s.note).map((s) => [s.id, s.note])),
  };
  return [
    `Write the analysis for the Zain Growth Digital Gap Audit of ${audit.prospect.name} (${audit.prospect.website}).`,
    "The data was collected with Apify and scored by Zain HQ; scores, statuses and severities are final. It fills a branded PDF the prospect will read, so be specific, factual and courteous. Rules from the template: built from public data only; every fact is quoted, estimated or not measured, with its source; not measured is not zero (never call an unmeasured area a weakness). Write in English and keep Arabic names as they are.",
    `A draft built from the data is below: sharpen its wording and add insight, but do not invent numbers. bottomLines keys: ${BOTTOM_LINE_KEYS.join(", ")}. fix has exactly three phases named ${FIX_NAMES.join(", ")}. Findings are the gaps (fair/weak areas), ordered by severity. Services: ${Object.values(SERVICE_FOR).join("; ")}.`,
    "Answer with ONLY the finished JSON in one ```json fenced block, same shape as the draft.",
    "",
    "Draft:",
    "```json",
    JSON.stringify(draftAnalysis(audit, score, data), null, 1),
    "```",
    "",
    "Data:",
    "```json",
    JSON.stringify(facts),
    "```",
    "",
    marker(audit.id),
  ].join("\n");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return options.find((o) => o.toLowerCase() === s) ?? fallback;
};
const list = (v: unknown, max: number): Record<string, unknown>[] =>
  (Array.isArray(v) ? v : []).filter((x): x is Record<string, unknown> => !!x && typeof x === "object").slice(0, max);

/** The JSON object in an agent's answer: a ```json block first, else the outermost {...}. */
function extractJson(text: string): Record<string, unknown> | null {
  const candidates: string[] = [];
  for (const m of text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/gi)) candidates.push(m[1]!);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const v: unknown = JSON.parse(c.trim().replace(/,\s*([}\]])/g, "$1"));
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/**
 * The agent's answer merged over the draft: every slot the agent filled validly wins, anything missing or
 * malformed keeps the draft's text. Null when the answer holds no usable JSON at all.
 */
export function parseAnalysis(text: string, draft: AuditAnalysis): AuditAnalysis | null {
  const v = extractJson(text);
  if (!v || !str(v.executiveSummary, 10)) return null;
  const s = (key: keyof AuditAnalysis, max: number) => str(v[key], max) || (draft[key] as string);
  const findings: AuditFinding[] = list(v.findings, 10)
    .map((f) => ({
      area: oneOf(f.area, AUDIT_AREAS, "website"),
      title: str(f.title, 120),
      detail: str(f.detail, 600),
      severity: oneOf(f.severity, SEVERITIES, "medium"),
      evidence: oneOf(f.evidence, ["quoted", "estimated", "not-measured"] as const, "quoted"),
      ...(str(f.source, 120) ? { source: str(f.source, 120) } : {}),
    }))
    .filter((f) => f.title)
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  const keyPoints = list(v.keyPoints, 3).map((k) => ({ title: str(k.title, 80), detail: str(k.detail, 400) })).filter((k) => k.title);
  const fix = list(v.fix, 3).map((f, i) => ({ phase: (i + 1) as 1 | 2 | 3, name: FIX_NAMES[i]!, headline: str(f.headline, 80), detail: str(f.detail, 500) }));
  const opportunities: AuditOpportunity[] = list(v.opportunities, 8)
    .map((o) => ({
      title: str(o.title, 140),
      service: str(o.service, 120) || "Zain Growth",
      impact: oneOf(o.impact, ["high", "medium", "low"] as const, "medium"),
      effort: oneOf(o.effort, ["S", "M", "L"] as const, "M"),
    }))
    .filter((o) => o.title);
  const lines = (v.bottomLines && typeof v.bottomLines === "object" ? v.bottomLines : {}) as Record<string, unknown>;
  const closingSteps = (Array.isArray(v.closingSteps) ? v.closingSteps : []).map((x) => str(x, 120)).filter(Boolean).slice(0, 3);
  return {
    coverLine: s("coverLine", 400),
    goal: s("goal", 200),
    headline: s("headline", 240),
    executiveSummary: s("executiveSummary", 1200),
    keyPoints: keyPoints.length === 3 && keyPoints.every((k) => k.detail) ? keyPoints : draft.keyPoints,
    bottomLines: Object.fromEntries(BOTTOM_LINE_KEYS.map((k) => [k, str(lines[k], 240) || draft.bottomLines[k] || ""])),
    findings: findings.length ? findings : draft.findings,
    fix: fix.length === 3 && fix.every((f) => f.headline && f.detail) ? fix : draft.fix,
    northStar: s("northStar", 300),
    nextStep: s("nextStep", 200),
    closingHeadline: s("closingHeadline", 160),
    closingSteps: closingSteps.length === 3 ? closingSteps : draft.closingSteps,
    opportunities: opportunities.length ? opportunities : draft.opportunities,
    pitchAngle: s("pitchAngle", 600),
  };
}
