export type DivisionId = "hq" | "studio" | "growth" | "labs" | "tech";

export interface Division {
  id: DivisionId;
  name: string;
  tagline: string;
  /** Kanban `tenant` used for every task owned by this division. */
  tenant: string;
  /** Brand accent used for building trim, shirts and UI chips. */
  color: string;
}

export const KANBAN_BOARD = "zain-group";

export const DIVISIONS: readonly Division[] = [
  { id: "hq", name: "Zain Group HQ", tagline: "Leadership & support departments", tenant: "zain-hq", color: "#F2C230" },
  { id: "studio", name: "Zain Studio", tagline: "Branding & creative", tenant: "zain-studio", color: "#E0567A" },
  { id: "growth", name: "Zain Growth", tagline: "Performance marketing", tenant: "zain-growth", color: "#3DBE7A" },
  { id: "labs", name: "Zain Labs", tagline: "Revenue-share growth partnerships", tenant: "zain-labs", color: "#8E6CEF" },
  { id: "tech", name: "Zain Tech", tagline: "Engineering & AI systems", tenant: "zain-tech", color: "#3A9BEF" },
] as const;

export const DIVISION_IDS: readonly DivisionId[] = DIVISIONS.map((d) => d.id);

export function getDivision(id: DivisionId): Division {
  const d = DIVISIONS.find((x) => x.id === id);
  if (!d) throw new Error(`Unknown division ${id}`);
  return d;
}

export function divisionForTenant(tenant: string | null | undefined): Division | undefined {
  return DIVISIONS.find((d) => d.tenant === tenant);
}
