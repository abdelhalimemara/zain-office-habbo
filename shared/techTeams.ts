/**
 * Zain Tech repo teams. Each team owns one GitHub repo and is led by a Head Engineer and a
 * Project Manager who report to the VP Tech and run the specialists below them.
 * The VP can add teams at runtime; those are stored server-side and merged with this list.
 */
export interface TechTeam {
  id: string;
  name: string;
  /** owner/name on GitHub. */
  repo: string;
  summary: string;
  /** The repo's stack in one line, as found in the repo; empty until a lead documents it. */
  stack?: string;
  /** True when the repo doesn't exist yet and the team should create it (private). */
  createRepo?: boolean;
}

/** A team member's role: leads are the Head Engineer and the Project Manager, everyone else is a specialist. */
export type TeamRole = "head-engineer" | "project-manager" | "specialist";

export const TEAM_ROLES: readonly TeamRole[] = ["head-engineer", "project-manager", "specialist"];

export const TECH_TEAMS: readonly TechTeam[] = [
  { id: "storelens", name: "StoreLens", repo: "abdelhalimemara/storelens",
    summary: "Multi-tenant SaaS for Shopify, Salla and Zid merchants: SEO and social competitor gap audits, AI content.",
    stack: "pnpm + Turborepo TypeScript monorepo: React web app, Firebase Cloud Functions, Cloud Run crawler, Firestore, Terraform on GCP (me-central1/2), ar/en RTL PDFs." },
  { id: "zaincrm", name: "Zain CRM", repo: "abdelhalimemara/zaincrm",
    summary: "Zain's CRM, based on the open-source Twenty CRM.",
    stack: "Self-hosted Twenty CRM v2.1.0 on Docker Compose (Postgres), plus Python services for custom objects, the metadata API and finance (billing, invoices, Arabic PDF). Default branch: zain-studio-customization." },
  { id: "bookme", name: "BookMe", repo: "abdelhalimemara/bookme",
    summary: "Multi-tenant booking and scheduling SaaS: offices manage bookable people, each with a public booking page.",
    stack: "React 19 + Vite 6 + React Router 7 + Tailwind 4 web app, Node 20 + Express on Firebase Cloud Functions, Firestore, Moyasar payments, ZATCA invoicing." },
  { id: "ppl-lab", name: "PPL Lab", repo: "abdelhalimemara/ppl-lab",
    summary: "PPL-LAP: an AI population engine (synthetic personas) behind Ask, Test a Decision, War Game and Make a Call, with a credits ledger.",
    stack: "React 19 + Vite + shadcn/Tailwind 4 web app, tRPC v11 Node server, Firebase Auth + Firestore, Anthropic/OpenAI/Gemini SDKs, BigQuery data mart." },
  { id: "website", name: "Zain Group Website", repo: "abdelhalimemara/zain-group-website", createRepo: true,
    summary: "The hand-coded React website for Zain Group (zain-studio.com).",
    stack: "Hand-coded React + TypeScript site (new private repo), bilingual Arabic/English." },
] as const;

export const TEAM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}$/;
/** GitHub `owner/name`. */
export const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

export function findTeam(id: string, teams: readonly TechTeam[] = TECH_TEAMS): TechTeam | undefined {
  return teams.find((t) => t.id === id);
}

/** The team's kanban tracking task, owned by its Project Manager. */
export function teamCharterTitle(team: Pick<TechTeam, "name">): string {
  return `${team.name} · Team charter & status`;
}

/** Where agents keep the team's clone: `~/ZainTech/<team>/<repo name>`. */
export function teamCheckout(team: Pick<TechTeam, "id" | "repo">): string {
  return `~/ZainTech/${team.id}/${team.repo.split("/")[1]}`;
}
