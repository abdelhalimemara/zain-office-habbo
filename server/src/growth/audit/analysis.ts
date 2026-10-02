import type { AuditAnalysis, AuditFinding, AuditOpportunity, AuditScore, ProspectAudit } from "../../../../shared/audits";
import type { CollectedData } from "./types";

export const AUDIT_AGENT = "zain-growth-audit";
/** Until the Prospect Audit Lead is hired, the Growth analyst writes the analysis. */
export const FALLBACK_AGENT = "zain-growth-analyst";
export const ANALYSIS_TITLE_PREFIX = "Prospect audit · ";

type Section = AuditFinding["section"];
const SECTIONS: readonly Section[] = ["website", "search", "social", "ads", "tracking"];

/** The Zain service that answers a weak section. */
export const SERVICE_FOR: Record<Section, string> = {
  website: "Zain Studio · Website & on-page SEO",
  search: "Zain Growth · SEO & AI Search",
  social: "Zain Studio · Social content & community",
  ads: "Zain Growth · Paid ads (Meta, Google, TikTok)",
  tracking: "Zain Growth · Tracking & conversion setup",
};

const OPPORTUNITY_FOR: Record<Section, string> = {
  website: "Fix on-page SEO and deepen service pages",
  search: "Win the target searches competitors own",
  social: "Build a steady posting rhythm that earns engagement",
  ads: "Launch always-on paid acquisition",
  tracking: "Install pixels and conversion tracking",
};

export const marker = (auditId: string) => `<!-- zain-audit:${auditId} -->`;

/** What the agent gets: the facts and scores, compact, plus the exact JSON shape to answer with. */
export function analysisTaskBody(audit: ProspectAudit, data: CollectedData, score: AuditScore): string {
  const facts = {
    prospect: audit.prospect,
    score,
    website: data.website && { ...data.website, headings: data.website.headings.slice(0, 8) },
    search: data.search,
    social: data.social,
    ads: data.ads,
    stepNotes: Object.fromEntries(audit.steps.filter((s) => s.note).map((s) => [s.id, s.note])),
  };
  return [
    `Write the analysis for the Zain Growth prospect audit of ${audit.prospect.name} (${audit.prospect.website}).`,
    "The data below was collected with Apify and scored by Zain HQ; the scores are final. Your job is the reading of it: what matters, why, and what Zain should sell them first. Ahmad (Zain's founder) will use it to open the conversation, and it goes into a branded PDF the prospect may see, so be specific, factual and courteous. Write in English; keep Arabic names as they are.",
    "Answer with ONLY this JSON in one ```json fenced block, nothing else:",
    "```json",
    JSON.stringify(
      {
        executiveSummary: "3-5 sentences a founder reads in 30 seconds",
        findings: [{ section: "website|search|social|ads|tracking", title: "short", detail: "1-2 sentences with the number", severity: "high|medium|low" }],
        opportunities: [{ title: "short, outcome first", service: "one of the Zain services below", impact: "high|medium|low", effort: "S|M|L" }],
        competitors: [{ name: "brand", domain: "example.sa", note: "why they win" }],
        pitchAngle: "1-2 sentences: how Ahmad should open",
      },
      null,
      2,
    ),
    "```",
    `4-8 findings, 3-6 opportunities ordered by impact, up to 5 competitors. Services: ${Object.values(SERVICE_FOR).join("; ")}.`,
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
  const s = typeof v === "string" ? (v.trim().toLowerCase() as T) : fallback;
  return options.find((o) => o.toLowerCase() === s) ?? fallback;
};
const list = (v: unknown, max: number): Record<string, unknown>[] =>
  (Array.isArray(v) ? v : []).filter((x): x is Record<string, unknown> => !!x && typeof x === "object").slice(0, max);

/** The JSON object in an agent's answer: a ```json block first, else the outermost {...}. */
function extractJson(text: string): unknown {
  const candidates: string[] = [];
  for (const m of text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/gi)) candidates.push(m[1]!);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const v: unknown = JSON.parse(c.trim().replace(/,\s*([}\]])/g, "$1"));
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/** The agent's answer as an AuditAnalysis, or null when it holds nothing usable. */
export function parseAnalysis(text: string): AuditAnalysis | null {
  const v = extractJson(text) as Record<string, unknown> | null;
  if (!v) return null;
  const executiveSummary = str(v.executiveSummary, 1500);
  const findings: AuditFinding[] = list(v.findings, 10)
    .map((f) => ({
      section: oneOf(f.section, SECTIONS, "website"),
      title: str(f.title, 120),
      detail: str(f.detail, 600),
      severity: oneOf(f.severity, ["high", "medium", "low"] as const, "medium"),
    }))
    .filter((f) => f.title);
  const opportunities: AuditOpportunity[] = list(v.opportunities, 8)
    .map((o) => ({
      title: str(o.title, 140),
      service: str(o.service, 120) || "Zain Growth",
      impact: oneOf(o.impact, ["high", "medium", "low"] as const, "medium"),
      effort: oneOf(o.effort, ["S", "M", "L"] as const, "M"),
    }))
    .filter((o) => o.title);
  const competitors = list(v.competitors, 6)
    .map((c) => ({ name: str(c.name, 100), ...(str(c.domain, 120) ? { domain: str(c.domain, 120) } : {}), note: str(c.note, 300) }))
    .filter((c) => c.name);
  if (!executiveSummary || (findings.length === 0 && opportunities.length === 0)) return null;
  return { executiveSummary, findings, opportunities, competitors, pitchAngle: str(v.pitchAngle, 600) };
}

/** A plain analysis from the scores alone, so the PDF still renders when the agent's answer is unusable. */
export function fallbackAnalysis(audit: ProspectAudit, score: AuditScore, data: CollectedData): AuditAnalysis {
  const measured = SECTIONS.filter((s) => score.sections[s].weight > 0);
  const weakest = [...measured].sort((a, b) => score.sections[a].score - score.sections[b].score);
  const strongest = weakest.at(-1);
  const findings: AuditFinding[] = weakest.flatMap((s) =>
    score.sections[s].drivers.slice(0, 2).map((d) => ({
      section: s,
      title: d,
      detail: `${s[0]!.toUpperCase()}${s.slice(1)} scored ${score.sections[s].score}/100.`,
      severity: score.sections[s].score < 40 ? ("high" as const) : score.sections[s].score < 70 ? ("medium" as const) : ("low" as const),
    })),
  );
  const opportunities: AuditOpportunity[] = weakest
    .filter((s) => score.sections[s].score < 70)
    .slice(0, 4)
    .map((s, i) => ({ title: OPPORTUNITY_FOR[s], service: SERVICE_FOR[s], impact: i === 0 ? "high" : "medium", effort: s === "tracking" ? "S" : "M" }));
  const weakList = weakest.slice(0, 2).join(" and ");
  return {
    executiveSummary: [
      `${audit.prospect.name} scores ${score.overall}/100 (grade ${score.grade}) across website, search, social, paid ads and tracking.`,
      strongest ? `Its strongest area is ${strongest} (${score.sections[strongest].score}/100).` : "",
      weakList ? `The biggest gaps are ${weakList}, where the quickest wins are.` : "",
      "The opportunities below are ordered by expected impact.",
    ]
      .filter(Boolean)
      .join(" "),
    findings: findings.slice(0, 8),
    opportunities: opportunities.length ? opportunities : [{ title: "Scale what already works", service: SERVICE_FOR.ads, impact: "medium", effort: "M" }],
    competitors: (data.search?.competitors ?? []).slice(0, 5).map((c) => ({ name: c.domain, domain: c.domain, note: `Outranks them on ${c.appearances} target searches` })),
    pitchAngle: weakest[0] ? `Open with the ${weakest[0]} gap: ${score.sections[weakest[0]].drivers[0] ?? ""}.` : "Open with the overall score and the top opportunity.",
  };
}
