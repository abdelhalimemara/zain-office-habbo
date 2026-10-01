import type { RosterEntry } from "../../shared/api";
import { DIVISIONS, type DivisionId } from "../../shared/divisions";
import { agentActivity, divisionStats, type DivisionStats } from "../../shared/flow";
import type { KanbanBoard } from "../../shared/hermes";
import { ROSTER, type RosterAgent } from "../../shared/roster";
import type { WorldAgent } from "../world";

const BUBBLE_MAX = 28;

export function truncate(text: string, max = BUBBLE_MAX): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function rosterOrFallback(entries: RosterEntry[] | undefined): RosterEntry[] {
  return entries ?? ROSTER.map((a) => ({ ...a, hired: false, model: null }));
}

export function toWorldAgents(roster: RosterEntry[], board: KanbanBoard | undefined): WorldAgent[] {
  return roster.map((agent) => {
    const { activity, task } = board ? agentActivity(agent.profile, board) : { activity: "idle" as const, task: null };
    return {
      profile: agent.profile,
      title: agent.title,
      division: agent.division,
      rank: agent.rank,
      activity,
      hired: agent.hired,
      ...(task ? { bubble: truncate(task.title) } : {}),
    };
  });
}

export function toWorldStats(board: KanbanBoard | undefined): Record<DivisionId, DivisionStats> | null {
  if (!board) return null;
  return Object.fromEntries(DIVISIONS.map((d) => [d.id, divisionStats(board, d.tenant)])) as Record<
    DivisionId,
    DivisionStats
  >;
}

export function isManager(agent: Pick<RosterAgent, "rank"> | undefined): boolean {
  return agent?.rank === "vp";
}
