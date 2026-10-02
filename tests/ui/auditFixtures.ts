import { AUDIT_STEPS, type AuditStep, type ProspectAudit, type StepStatus } from "@shared/audits";

export const T0 = 1_700_000_000;

function steps(statuses: StepStatus[], notes: Partial<Record<number, string>> = {}): AuditStep[] {
  return AUDIT_STEPS.map((id, i) => {
    const status = statuses[i] ?? "pending";
    const started = status !== "pending" ? { startedAt: T0 + i * 20 } : {};
    const finished = status === "done" || status === "skipped" || status === "failed" ? { finishedAt: T0 + i * 20 + 15 } : {};
    const cost = i < 4 && status === "done" ? { costUsd: [0.42, 0.18, 0.31, 0.12][i] } : {};
    return { id, status, ...started, ...finished, ...cost, ...(notes[i] ? { note: notes[i] } : {}) };
  });
}

export const runningAudit: ProspectAudit = {
  id: "aud-run",
  prospect: { name: "Kahwa House", website: "https://www.kahwahouse.sa", city: "Riyadh", category: "Cafe chain", instagram: "@kahwahouse" },
  status: "running",
  steps: steps(["done", "done", "running"], { 0: "38 pages crawled, 6 missing meta descriptions", 1: "Ranks for 4 of 20 target keywords" }),
  requestedBy: "hq",
  createdAt: T0,
  updatedAt: T0 + 60,
};

export const doneAudit: ProspectAudit = {
  id: "aud-done",
  prospect: { name: "Nakheel Dental", website: "nakheeldental.com", leadId: "lead-1", city: "Jeddah", category: "Dental clinic" },
  status: "done",
  steps: steps(["done", "done", "done", "skipped", "done", "done", "done", "done", "done"], { 3: "No ads in Meta Ad Library or Google Ads Transparency" }),
  score: {
    overall: 64,
    grade: "C",
    sections: {
      website: { score: 72, weight: 0.3, drivers: ["Fast mobile load (2.1s)", "No schema markup"] },
      search: { score: 48, weight: 0.25, drivers: ["Outranked by 3 local clinics", "No Google Business posts"] },
      social: { score: 81, weight: 0.2, drivers: ["12k Instagram followers", "Posts 4x a week"] },
      ads: { score: 20, weight: 0.15, drivers: ["No paid search or social ads running"] },
      tracking: { score: 55, weight: 0.1, drivers: ["GA4 present", "No Meta pixel"] },
    },
  },
  analysis: {
    executiveSummary: "Nakheel Dental has a strong Instagram following but is invisible in paid search. Three local competitors outrank them for implant keywords.",
    findings: [
      { section: "search", title: "Outranked on implants", detail: "Three clinics take the top spots for 'dental implants jeddah'.", severity: "high" },
      { section: "website", title: "Missing schema", detail: "No LocalBusiness or Dentist schema on any page.", severity: "medium" },
      { section: "website", title: "Thin service pages", detail: "Service pages average 120 words.", severity: "high" },
      { section: "tracking", title: "No Meta pixel", detail: "Instagram traffic cannot be retargeted.", severity: "low" },
    ],
    opportunities: [
      { title: "Launch implant search campaign", service: "Google Ads", impact: "high", effort: "S" },
      { title: "Rebuild service pages", service: "SEO content", impact: "medium", effort: "M" },
    ],
    competitors: [
      { name: "Smile Hub", domain: "smilehub.sa", note: "Ranks first for implants and runs search ads." },
      { name: "Pearl Clinic", note: "Strong review count." },
    ],
    pitchAngle: "Open with the implant keyword gap: their competitors are buying the clicks Nakheel's Instagram audience is searching for.",
  },
  pdfPath: "/data/audits/aud-done.pdf",
  crmUrl: "https://crm.zain.example/objects/leads/lead-1",
  notionPageUrl: "https://www.notion.so/Nakheel-Dental-audit-123",
  costUsd: 1.03,
  requestedBy: "hq",
  createdAt: T0 - 86400,
  updatedAt: T0 - 86000,
};

export const failedAudit: ProspectAudit = {
  id: "aud-fail",
  prospect: { name: "Desert Bloom", website: "https://desertbloom.ae" },
  status: "failed",
  steps: steps(["failed", "skipped", "skipped", "skipped"], {
    0: "Apify is not connected: add APIFY_TOKEN",
    1: "Apify is not connected",
    2: "Apify is not connected",
    3: "Apify is not connected",
  }),
  requestedBy: "agent",
  createdAt: T0 - 3600,
  updatedAt: T0 - 3500,
  error: "Apify is not connected",
};

export const gradedAudits: ProspectAudit[] = (["A", "B", "D", "E"] as const).map((grade, i) => ({
  ...doneAudit,
  id: `aud-${grade}`,
  prospect: { ...doneAudit.prospect, name: `Prospect ${grade}`, website: `prospect-${grade.toLowerCase()}.com` },
  score: { ...doneAudit.score!, grade, overall: [91, 78, 38, 17][i]! },
  createdAt: T0 - 172800 - i * 3600,
}));
