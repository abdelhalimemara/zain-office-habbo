import { DIVISION_IDS } from "../../shared/divisions";
import type { WorldAgent } from "./types";

export interface AgentDiff {
  added: WorldAgent[];
  updated: WorldAgent[];
  removed: string[];
}

const ACTIVITIES = new Set(["working", "blocked", "awaiting-approval", "queued", "idle"]);
const RANKS = new Set(["ceo", "vp", "lead", "specialist"]);

export function isValidAgent(a: unknown): a is WorldAgent {
  if (!a || typeof a !== "object") return false;
  const o = a as Record<string, unknown>;
  return (
    typeof o.profile === "string" &&
    o.profile.length > 0 &&
    typeof o.title === "string" &&
    DIVISION_IDS.includes(o.division as WorldAgent["division"]) &&
    RANKS.has(o.rank as string) &&
    ACTIVITIES.has(o.activity as string) &&
    typeof o.hired === "boolean" &&
    (o.bubble === undefined || typeof o.bubble === "string")
  );
}

export function sameAgent(a: WorldAgent, b: WorldAgent): boolean {
  return (
    a.title === b.title &&
    a.division === b.division &&
    a.rank === b.rank &&
    a.activity === b.activity &&
    a.bubble === b.bubble &&
    a.hired === b.hired
  );
}

export function diffAgents(prev: ReadonlyMap<string, WorldAgent>, next: readonly unknown[]): AgentDiff {
  const seen = new Map<string, WorldAgent>();
  for (const a of next) if (isValidAgent(a) && !seen.has(a.profile)) seen.set(a.profile, { ...a });
  const added: WorldAgent[] = [];
  const updated: WorldAgent[] = [];
  for (const [profile, agent] of seen) {
    const old = prev.get(profile);
    if (!old) added.push(agent);
    else if (!sameAgent(old, agent)) updated.push(agent);
  }
  const removed = [...prev.keys()].filter((p) => !seen.has(p));
  return { added, updated, removed };
}
