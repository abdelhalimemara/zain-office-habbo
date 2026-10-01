import type { KanbanBoard, KanbanTask, TaskStatus } from "./hermes";
import type { RosterAgent } from "./roster";
import { findAgent } from "./roster";

/**
 * Task flow:
 *  1. HQ creates a *mandate*: tenant = division, assignee = division manager, straight to the VP.
 *  2. The VP creates subtasks for their own team and links each as a *parent* of the mandate,
 *     then blocks the mandate on the dependency; it resumes when every subtask is done.
 *  3. The VP rolls up the result and requests review = awaiting HQ approval.
 *  4. HQ approves (→ done) or rejects (comment + back to the manager).
 */

export type AgentActivity = "working" | "blocked" | "awaiting-approval" | "queued" | "idle";

export const AWAITING_APPROVAL: TaskStatus = "review";

export function allTasks(board: KanbanBoard): KanbanTask[] {
  return board.columns.flatMap((c) => c.tasks);
}

export function tasksForTenant(board: KanbanBoard, tenant: string): KanbanTask[] {
  return allTasks(board).filter((t) => t.tenant === tenant);
}

export function isMandate(task: KanbanTask, roster?: readonly RosterAgent[]): boolean {
  if (!task.assignee) return false;
  const agent = findAgent(task.assignee, roster);
  return agent?.rank === "vp";
}

/** Subtasks done / total; Hermes counts archived as satisfying a dependency too. */
export function subtaskProgress(subtasks: readonly { status: TaskStatus }[]): { done: number; total: number } {
  return { done: subtasks.filter((s) => s.status === "done" || s.status === "archived").length, total: subtasks.length };
}

/** Mandates awaiting HQ; specialists' own `review` tasks are not HQ's to approve. */
export function pendingApprovals(board: KanbanBoard, roster?: readonly RosterAgent[]): KanbanTask[] {
  return allTasks(board).filter((t) => t.status === AWAITING_APPROVAL && isMandate(t, roster));
}

/** Specialists' tasks parked in `review`: no HQ approval is due, but a human must unstick them. */
export function waitingSubtaskReviews(board: KanbanBoard, roster?: readonly RosterAgent[]): KanbanTask[] {
  return allTasks(board).filter((t) => t.status === AWAITING_APPROVAL && !isMandate(t, roster));
}

export const NO_BRIEF = "(No further brief provided.)";

/**
 * Mandate bodies are HQ's brief, a `---` line, then `**Instructions for <VP>…**` and the
 * VP protocol. A `---` not followed by that heading is part of the brief.
 */
export function splitMandateBody(body: string): { brief: string; instructions: string | null } {
  const lines = body.split("\n");
  const at = lines.findIndex((line, i) => line === "---" && (lines[i + 1] ?? "").startsWith("**Instructions for "));
  if (at < 0) return { brief: body, instructions: null };
  return { brief: lines.slice(0, at).join("\n").trimEnd(), instructions: lines.slice(at + 1).join("\n") };
}

const ACTIVITY_PRIORITY: AgentActivity[] = ["blocked", "awaiting-approval", "working", "queued", "idle"];

function activityOf(status: TaskStatus): AgentActivity | null {
  switch (status) {
    case "running":
      return "working";
    case "blocked":
      return "blocked";
    case "review":
      return "awaiting-approval";
    case "ready":
    case "todo":
    case "triage":
    case "scheduled":
      return "queued";
    default:
      return null;
  }
}

/** Most attention-worthy activity across the agent's tasks, plus the task driving it. */
export function agentActivity(
  profile: string,
  board: KanbanBoard,
): { activity: AgentActivity; task: KanbanTask | null } {
  let best: { activity: AgentActivity; task: KanbanTask | null } = { activity: "idle", task: null };
  for (const task of allTasks(board)) {
    if (task.assignee !== profile) continue;
    const a = activityOf(task.status);
    if (a && ACTIVITY_PRIORITY.indexOf(a) < ACTIVITY_PRIORITY.indexOf(best.activity)) {
      best = { activity: a, task };
    }
  }
  return best;
}

export interface DivisionStats {
  working: number;
  blocked: number;
  awaitingApproval: number;
  queued: number;
  done: number;
}

export function divisionStats(board: KanbanBoard, tenant: string): DivisionStats {
  const s: DivisionStats = { working: 0, blocked: 0, awaitingApproval: 0, queued: 0, done: 0 };
  for (const t of tasksForTenant(board, tenant)) {
    if (t.status === "done") s.done++;
    else {
      const a = activityOf(t.status);
      if (a === "working") s.working++;
      else if (a === "blocked") s.blocked++;
      else if (a === "awaiting-approval") s.awaitingApproval++;
      else if (a === "queued") s.queued++;
    }
  }
  return s;
}
