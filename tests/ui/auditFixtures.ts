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
    areasMeasured: 5,
    areas: [
      { area: "website", status: "fair", severity: "high", score: 62, weight: 0.2, summary: "Schema and sitemap present; service pages return placeholder text when crawled.", evidence: [{ text: "", kind: "quoted", source: "research_website" }] },
      { area: "brand", status: "fair", score: 70, weight: 0.15, summary: "Brand search returns the official site and Instagram.", evidence: [{ text: "", kind: "quoted", source: "search" }, { text: "", kind: "not-measured", source: "Maps, tool timeout" }] },
      { area: "search", status: "weak", severity: "high", score: 30, weight: 0.15, summary: "Absent from a live implants category search where two competitors appear.", evidence: [{ text: "", kind: "quoted", source: "research_search" }] },
      { area: "social", status: "fair", severity: "medium", score: 74, weight: 0.15, summary: "Instagram is active, 12k followers, but engagement is thin.", evidence: [{ text: "", kind: "quoted", source: "research_instagram" }] },
      { area: "performance", status: "weak", severity: "critical", score: 20, weight: 0.15, summary: "No GA4, GTM or Meta pixel in the raw HTML.", evidence: [{ text: "", kind: "quoted", source: "research_tech" }] },
      { area: "conversion", status: "not-measured", weight: 0.1, summary: "Booking flow and CRM are not visible from public pages.", evidence: [{ text: "", kind: "not-measured", source: "no backend access" }] },
      { area: "reputation", status: "not-measured", weight: 0.1, summary: "Google Maps rating could not be retrieved.", evidence: [] },
    ],
  },
  benchmark: [
    { name: "Smile Hub", domain: "smilehub.sa", isProspect: false, googleAds: { active: 20, formats: "text/image", since: "13 Aug 2022" }, metaAds: { active: 1, note: "confirmed" }, instagramFollowers: 988, traffic: { monthlyVisits: 10628, period: "Aug 2026" }, authorityScore: 34, organicTraffic: 8700 },
    { name: "Nakheel Dental", domain: "nakheeldental.com", isProspect: true, googleAds: "none", metaAds: "none", instagramFollowers: 12040, traffic: { monthlyVisits: 2042, period: "Aug 2026" }, authorityScore: 18, organicTraffic: 1450 },
    { name: "Pearl Clinic", isProspect: false, googleAds: "not-measured", metaAds: "none", instagramFollowers: "not-measured", traffic: "not-measured" },
  ],
  seo: {
    source: "Semrush via Apify, Sep 2026",
    authorityScore: 18,
    organicKeywords: 312,
    organicTraffic: 1450,
    backlinks: 2380,
    referringDomains: 96,
    topKeywords: [
      { keyword: "nakheel dental", position: 1, volume: 880, url: "https://nakheeldental.com/" },
      { keyword: "dental clinic jeddah", position: 14, volume: 6600, url: "https://nakheeldental.com/en/clinics/jeddah-al-rawdah-branch?utm=1" },
      { keyword: "teeth whitening jeddah", position: 3 },
    ],
    topPages: [
      { url: "https://nakheeldental.com/", traffic: 980 },
      { url: "https://nakheeldental.com/en/services/implants", traffic: 210 },
    ],
    issues: [
      { title: "Missing meta descriptions", severity: "medium", count: 38 },
      { title: "Broken internal links", severity: "critical", count: 12 },
      { title: "Slow pages", severity: "high", count: 4 },
      { title: "Duplicate titles", severity: "medium", count: 52 },
    ],
    competitors: [
      { domain: "smilehub.sa", commonKeywords: 140, authorityScore: 34 },
      { domain: "pearlclinic.sa", authorityScore: 21 },
    ],
  },
  analysis: {
    coverLine: "A public-data audit of Nakheel Dental's digital presence.",
    goal: "Show where Nakheel already wins, and where the category is being taken by others.",
    headline: "The brand is findable, but paid search is empty and nothing is measured.",
    executiveSummary: "Nakheel Dental has a strong Instagram following but is invisible in paid search. Three local competitors outrank them for implant keywords.",
    keyPoints: [
      { title: "Brand is owned in search", detail: "Brand search returns the official site (quoted)." },
      { title: "No measurement", detail: "No GA4, GTM or Meta pixel on the page (quoted)." },
      { title: "Category term not owned", detail: "Absent from the implants search (quoted)." },
    ],
    bottomLines: { summary: "Bottom line: findable, but not measured and not buying the category.", competitive: "Smile Hub draws an estimated 5x the traffic." },
    findings: [
      { area: "website", title: "Thin service pages", detail: "Service pages return placeholder text.", severity: "high", evidence: "quoted", source: "research_website" },
      { area: "social", title: "Low engagement", detail: "0.2% engagement on the last 12 posts.", severity: "medium" },
      { area: "performance", title: "No measurement", detail: "No GA4, GTM or Meta pixel in the raw HTML.", severity: "critical", evidence: "quoted", source: "research_tech" },
      { area: "search", title: "Outranked on implants", detail: "Three clinics take the top spots for 'dental implants jeddah'.", severity: "high" },
    ],
    fix: [
      { phase: 2, name: "Demand Capture", headline: "Buy the implant searches", detail: "Search campaign on implant terms." },
      { phase: 1, name: "Foundation", headline: "Measure everything", detail: "GA4, GTM and the Meta pixel." },
      { phase: 3, name: "Demand Generation", headline: "Grow the category", detail: "Meta and TikTok creative." },
    ],
    northStar: "Booked implant consultations per month.",
    nextStep: "A 30-minute walkthrough with the clinic manager.",
    closingHeadline: "Three steps to own implants in Jeddah",
    closingSteps: ["Tracking", "Search", "Social"],
    opportunities: [
      { title: "Launch implant search campaign", service: "Google Ads", impact: "high", effort: "S" },
      { title: "Rebuild service pages", service: "SEO content", impact: "medium", effort: "M" },
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
