import type { RosterAgent } from "./roster";
import { TECH_TEAMS, type TechTeam } from "./techTeams";

/**
 * Zain Tech repo teams: a Head Engineer and a Project Manager per repo (leads, reporting to the
 * VP Tech) and the specialists below the Head Engineer, picked to match each repo's stack.
 * Skills come from the reviewed agency-agents set (shared/agencySkills.ts).
 */
export const TECH_VP = "zain-tech-vp";

const ag = (...paths: string[]) => paths.map((p) => `agency:${p}`);
const eng = (...names: string[]) => ag(...names.map((n) => `engineering/engineering-${n}`));
const test = (...names: string[]) => ag(...names.map((n) => `testing/testing-${n}`));

export const HEAD_ENGINEER_SKILLS = eng("software-architect", "senior-developer", "code-reviewer", "git-workflow-master", "minimal-change-engineer");
export const PROJECT_MANAGER_SKILLS = ag(
  "project-management/project-manager-senior",
  "project-management/project-management-project-shepherd",
  "project-management/project-management-jira-workflow-steward",
  "project-management/project-management-experiment-tracker",
);

interface SpecialistSpec {
  /** Profile suffix after `zain-tech-<team>-`. */
  slug: string;
  role: string;
  focus: string;
  skills: string[];
}

export function headEngineerProfile(teamId: string): string {
  return `zain-tech-${teamId}-head`;
}

export function projectManagerProfile(teamId: string): string {
  return `zain-tech-${teamId}-pm`;
}

function teamRoster(team: TechTeam, specialists: SpecialistSpec[]): RosterAgent[] {
  const head = headEngineerProfile(team.id);
  const base = { division: "tech" as const, team: team.id };
  return [
    { ...base, profile: head, title: `${team.name} · Head Engineer`, rank: "lead", reportsTo: TECH_VP, teamRole: "head-engineer",
      focus: `Technical owner of ${team.repo}: architecture, code review and merges. ${team.stack ?? ""}`.trim(), skills: HEAD_ENGINEER_SKILLS },
    { ...base, profile: projectManagerProfile(team.id), title: `${team.name} · Project Manager`, rank: "lead", reportsTo: TECH_VP,
      teamRole: "project-manager", focus: `Scope, milestones, board hygiene and weekly status for ${team.repo}.`, skills: PROJECT_MANAGER_SKILLS },
    ...specialists.map((s): RosterAgent => ({
      ...base, profile: `zain-tech-${team.id}-${s.slug}`, title: `${team.name} · ${s.role}`, rank: "specialist", reportsTo: head,
      teamRole: "specialist", focus: s.focus, skills: s.skills,
    })),
  ];
}

const team = (id: string) => TECH_TEAMS.find((t) => t.id === id)!;

const storelens = teamRoster(team("storelens"), [
  { slug: "frontend", role: "Frontend Engineer", skills: [...eng("frontend-developer", "i18n-engineer"), ...test("accessibility-auditor")],
    focus: "React web app and marketing site (apps/web, apps/marketing, packages/ui): dashboard, competitors and content screens, ar/en RTL." },
  { slug: "backend", role: "Backend Engineer", skills: eng("backend-architect", "api-platform-engineer", "database-optimizer", "payments-billing-engineer"),
    focus: "Firebase Cloud Functions, Firestore model and rules, shared contracts/sdk packages, GA4/Search Console connectors, Moyasar billing." },
  { slug: "crawler", role: "Crawler & Infra Engineer", skills: eng("data-engineer", "search-relevance-engineer", "devops-automator"),
    focus: "Cloud Run crawler, Shopify/Salla/Zid platform detection, Semrush and DataForSEO providers, gap taxonomy, Terraform (infra/)." },
  { slug: "ai", role: "AI Engineer", skills: eng("ai-engineer", "prompt-engineer", "rag-pipeline-engineer"),
    focus: "AI executive summary, audit assistant chat, content strategy and article SEO scoring (ar/en)." },
  { slug: "qa", role: "QA Engineer", skills: test("test-automation-engineer", "api-tester", "evidence-collector"),
    focus: "Turborepo test suites, Firestore/Storage rules tests on the emulators, API contract checks." },
]);

const zaincrm = teamRoster(team("zaincrm"), [
  { slug: "backend", role: "Backend Engineer", skills: eng("backend-architect", "api-platform-engineer", "database-optimizer"),
    focus: "Twenty CRM v2.1.0 custom objects and metadata API scripts (Python), Postgres schema, Gmail sync and MCP integrations." },
  { slug: "finance", role: "Finance & Billing Engineer", skills: eng("payments-billing-engineer", "pdf-engine-architect", "i18n-engineer"),
    focus: "The finance package: billing dates, invoice numbering and issuing, expenses, Arabic invoice PDFs, SAR defaults." },
  { slug: "devops", role: "DevOps Engineer", skills: eng("devops-automator", "sre", "database-reliability-engineer"),
    focus: "Docker Compose deployment of Twenty at crm.zain-studio.com: upgrades, backups, health and secrets hygiene." },
  { slug: "qa", role: "QA Engineer", skills: test("test-automation-engineer", "api-tester"),
    focus: "pytest suites for the Python services and checks against the Twenty REST/GraphQL APIs." },
]);

const bookme = teamRoster(team("bookme"), [
  { slug: "frontend", role: "Frontend Engineer", skills: [...eng("frontend-developer", "i18n-engineer"), ...test("accessibility-auditor")],
    focus: "apps/web: React 19 + Vite 6 + React Router 7 + Tailwind 4 owner app and public booking pages." },
  { slug: "backend", role: "Backend Engineer", skills: eng("backend-architect", "api-platform-engineer", "database-optimizer"),
    focus: "functions/: Node 20 + Express on Firebase Cloud Functions, availability and timezones (luxon), Firestore rules and indexes, the API contract." },
  { slug: "payments", role: "Payments Engineer", skills: eng("payments-billing-engineer", "pdf-engine-architect"),
    focus: "Moyasar payments, ZATCA invoicing and pdfkit invoices." },
  { slug: "devops", role: "DevOps Engineer", skills: eng("devops-automator", "sre"),
    focus: "Firebase project zainbookly: CI, emulators, the pre-deploy checklist and deploy readiness (deploys need HQ approval)." },
  { slug: "qa", role: "QA Engineer", skills: test("test-automation-engineer", "api-tester"),
    focus: "Fast/slow test splits in apps/web and functions, emulator tests and API-docs contract drift checks." },
]);

const pplLab = teamRoster(team("ppl-lab"), [
  { slug: "frontend", role: "Frontend Engineer", skills: eng("frontend-developer", "data-visualization-engineer"),
    focus: "React 19 + Vite + shadcn/Tailwind 4 app with the tRPC React Query client: Ask, Decision, War Game and Calls screens and results." },
  { slug: "backend", role: "Backend Engineer", skills: eng("backend-architect", "api-platform-engineer", "payments-billing-engineer", "identity-access-engineer"),
    focus: "tRPC v11 server on Firebase Auth + Firestore: orgs and roles, audit log, quotes and the credit ledger." },
  { slug: "ai", role: "AI Engineer", skills: eng("ai-engineer", "multi-agent-systems-architect", "prompt-engineer"),
    focus: "The population engine: personas, ticks and trait cache, model calls (Anthropic, OpenAI, Gemini) and calibration." },
  { slug: "data", role: "Data Engineer", skills: eng("data-engineer", "privacy-engineer"),
    focus: "BigQuery data mart of hashed customer cohorts and archetypes, with PDPL privacy controls." },
  { slug: "qa", role: "QA Engineer", skills: test("test-automation-engineer", "api-tester", "evidence-collector"),
    focus: "Vitest suites, tRPC contract tests, Firebase emulator tests and evidence for AI output quality." },
]);

const website = teamRoster(team("website"), [
  { slug: "frontend", role: "Frontend Engineer", skills: eng("frontend-developer", "cms-developer"),
    focus: "The hand-coded React + TypeScript site: design system, pages, content structure and build." },
  { slug: "i18n", role: "i18n & Content Engineer", skills: eng("i18n-engineer", "technical-writer"),
    focus: "Arabic/English with RTL, localized routes and metadata, structured page content." },
  { slug: "qa", role: "QA Engineer", skills: test("accessibility-auditor", "performance-benchmarker", "evidence-collector"),
    focus: "Accessibility, Core Web Vitals and cross-browser checks before every PR." },
]);

export const TECH_TEAM_ROSTER: readonly RosterAgent[] = [...storelens, ...zaincrm, ...bookme, ...pplLab, ...website];
