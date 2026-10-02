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
  /** True when the repo doesn't exist yet and the team should create it (private). */
  createRepo?: boolean;
}

export const TECH_TEAMS: readonly TechTeam[] = [
  { id: "storelens", name: "StoreLens", repo: "abdelhalimemara/storelens",
    summary: "Multi-tenant SaaS for Shopify, Salla and Zid merchants: SEO and social competitor gap audits, AI content." },
  { id: "zaincrm", name: "Zain CRM", repo: "abdelhalimemara/zaincrm",
    summary: "Zain's CRM, based on the open-source Twenty CRM." },
  { id: "bookme", name: "BookMe", repo: "abdelhalimemara/bookme",
    summary: "BookMe product." },
  { id: "ppl-lab", name: "PPL Lab", repo: "abdelhalimemara/ppl-lab",
    summary: "PPL Lab product." },
  { id: "website", name: "Zain Group Website", repo: "abdelhalimemara/zain-group-website", createRepo: true,
    summary: "The hand-coded React website for Zain Group (zain-studio.com)." },
] as const;

export const TEAM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}$/;

export function findTeam(id: string, teams: readonly TechTeam[] = TECH_TEAMS): TechTeam | undefined {
  return teams.find((t) => t.id === id);
}
