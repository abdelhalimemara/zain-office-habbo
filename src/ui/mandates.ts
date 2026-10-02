import { divisionForTenant, getDivision, type Division } from "@shared/divisions";
import { allTasks, isMandate } from "@shared/flow";
import type { KanbanBoard, KanbanTask, TaskStatus } from "@shared/hermes";
import { findAgent, type RosterAgent } from "@shared/roster";

const ONGOING_RANK: Partial<Record<TaskStatus, number>> = { review: 0, blocked: 1, running: 2 };
const FINISHED: ReadonlySet<TaskStatus> = new Set(["done", "archived"]);

function ongoingRank(task: KanbanTask): number {
  return ONGOING_RANK[task.status] ?? 3;
}

export interface MandateGroups {
  ongoing: KanbanTask[];
  finished: KanbanTask[];
}

/** HQ mandates on the board: ongoing ones by urgency (awaiting HQ, blocked, working, queued), finished newest first. */
export function groupMandates(board: KanbanBoard, roster?: readonly RosterAgent[]): MandateGroups {
  const mandates = allTasks(board).filter((t) => isMandate(t, roster));
  const ongoing = mandates
    .filter((t) => !FINISHED.has(t.status))
    .sort((a, b) => ongoingRank(a) - ongoingRank(b) || b.created_at - a.created_at);
  const finished = mandates
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completed_at ?? b.created_at) - (a.completed_at ?? a.created_at));
  return { ongoing, finished };
}

export function mandateDivision(task: KanbanTask, roster?: readonly RosterAgent[]): Division | undefined {
  const byTenant = divisionForTenant(task.tenant);
  if (byTenant) return byTenant;
  const agent = task.assignee ? findAgent(task.assignee, roster) : undefined;
  return agent ? getDivision(agent.division) : undefined;
}

/** The moment a card's age is measured from: completion, then start, then creation. */
export function mandateMoment(task: KanbanTask): { at: number; verb: string } {
  if (task.status === "done" && task.completed_at) return { at: task.completed_at, verb: "Completed" };
  if (task.started_at) return { at: task.started_at, verb: "Started" };
  return { at: task.created_at, verb: "Created" };
}

function toSeconds(t: number): number {
  return t > 1e12 ? t / 1000 : t;
}

export function relativeTime(at: number, now: number): string {
  const s = Math.max(0, toSeconds(now) - toSeconds(at));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(toSeconds(at) * 1000).toLocaleDateString();
}

export function absoluteTime(at: number): string {
  return new Date(toSeconds(at) * 1000).toLocaleString();
}
