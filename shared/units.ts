import type { DivisionId } from "./divisions";

/**
 * Sub-teams inside a non-Tech division (Zain Tech uses repo teams, shared/techTeams.ts). A unit only
 * groups specialists under their VP: it has no leads of its own and does not change reporting lines.
 */
export interface DivisionUnit {
  id: string;
  name: string;
  division: DivisionId;
  summary: string;
}

export const DIVISION_UNITS: readonly DivisionUnit[] = [
  { id: "performance", name: "Performance", division: "growth", summary: "Paid media, conversion rate optimisation, analytics and attribution." },
  { id: "growth", name: "Growth", division: "growth", summary: "SEO, lifecycle, campaigns, prospect audits and outbound." },
  { id: "creative", name: "Creative", division: "studio", summary: "Art direction, video and copy." },
  { id: "organic", name: "Organic", division: "studio", summary: "Organic social, content and PR." },
  { id: "design", name: "Design", division: "studio", summary: "Brand and UX." },
];

export function unitsOf(division: DivisionId): DivisionUnit[] {
  return DIVISION_UNITS.filter((u) => u.division === division);
}

export function findUnit(id: string | undefined): DivisionUnit | undefined {
  return id ? DIVISION_UNITS.find((u) => u.id === id) : undefined;
}
