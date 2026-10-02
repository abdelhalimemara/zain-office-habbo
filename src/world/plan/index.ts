import type { DivisionId } from "../../../shared/divisions";
import { buildGrowth, buildLabs, buildStudio } from "./divisions";
import { buildTech } from "./tech";
import { buildHq } from "./hq";
import type { FloorPlan } from "./types";

const BUILDERS: Record<DivisionId, () => FloorPlan> = {
  hq: buildHq,
  studio: buildStudio,
  growth: buildGrowth,
  labs: buildLabs,
  tech: buildTech,
};

const cache = new Map<DivisionId, FloorPlan>();

export function floorPlan(division: DivisionId): FloorPlan {
  let plan = cache.get(division);
  if (!plan) {
    plan = BUILDERS[division]();
    cache.set(division, plan);
  }
  return plan;
}

/** HQ leads work in their department's room. */
export const HQ_TEAMS: Readonly<Record<string, string>> = {
  "zain-hq-ops": "ops",
  "zain-hq-care": "accounts",
  "zain-hq-accounts": "accounts",
  "zain-hq-finance": "finance",
  "zain-hq-people": "hr",
  "zain-hq-legal": "legal",
};

export * from "./types";
