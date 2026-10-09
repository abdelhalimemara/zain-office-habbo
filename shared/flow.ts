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
 * Zain Tech nests this: the VP fans a mandate out to team leads, a Head Engineer fans their task out
 * to specialists, and each lead asks their own manager for review. Those *internal reviews* belong
 * to that manager, never to HQ.
 */

export type AgentActivity = "working" | "blocked" | "awaiting-approval" | "queued" | "idle";

export const AWAITING_APPROVAL: TaskStatus = "review";

export function allTasks(board: KanbanBoard): KanbanTask[] {
  return board.columns.flatMap((c) => c.tasks);
}

export function tasksForTenant(board: KanbanBoard, tenant: string): KanbanTask[] {
  return allTasks(board).filter((t) => t.tenant === tenant);
}

const WORKER_RANKS = new Set(["vp", "lead", "specialist"]);

/**
 * True when an agent of the assignee's own division created the task: work a division makes for
 * itself (subtasks, or a lead's roll-up parked with its VP for review), as opposed to HQ's mandates
 * (created in Zain HQ, by the CEO or by HQ for another division).
 */
function createdInDivision(task: KanbanTask, assignee: RosterAgent, roster?: readonly RosterAgent[]): boolean {
  const creator = task.created_by ? findAgent(task.created_by, roster) : undefined;
  return !!creator && WORKER_RANKS.has(creator.rank) && creator.division === assignee.division;
}

const TEAM_REVIEW_MARKER = /<!-- zain-team-review:(t_[A-Za-z0-9_]+) -->/;

export function teamReviewMarker(taskId: string): string {
  return `<!-- zain-team-review:${taskId} -->`;
}

/** The task a team-review helper (HQ waking a manager to review their team's work) reviews; null for other tasks. */
export function teamReviewTarget(task: Pick<KanbanTask, "body">): string | null {
  return TEAM_REVIEW_MARKER.exec(task.body ?? "")?.[1] ?? null;
}

export function isMandate(task: KanbanTask, roster?: readonly RosterAgent[]): boolean {
  if (!task.assignee || teamReviewTarget(task)) return false;
  const agent = findAgent(task.assignee, roster);
  return agent?.rank === "vp" && !createdInDivision(task, agent, roster);
}

/**
 * A division's own review: a task parked in `review` with a manager (a VP or a team lead) that
 * the division created itself, e.g. a Head Engineer's roll-up reviewed by the VP Tech. Its reviewer
 * is the assignee; HQ never decides it.
 */
export function isInternalReview(task: KanbanTask, roster?: readonly RosterAgent[]): boolean {
  if (task.status !== AWAITING_APPROVAL || !task.assignee) return false;
  const agent = findAgent(task.assignee, roster);
  if (!agent || (agent.rank !== "vp" && agent.rank !== "lead")) return false;
  return createdInDivision(task, agent, roster) && !isClientReply(task, roster);
}

/** Internal reviews waiting on one reviewer (a VP or a team lead), oldest first. */
export function internalReviewsFor(board: KanbanBoard, reviewer: string, roster?: readonly RosterAgent[]): KanbanTask[] {
  return allTasks(board)
    .filter((t) => t.assignee === reviewer && isInternalReview(t, roster))
    .sort((a, b) => a.created_at - b.created_at);
}

/** Tasks for board advisors (consultations). Never mandates and never HQ approvals. */
export function isBoardTask(task: KanbanTask, roster?: readonly RosterAgent[]): boolean {
  return !!task.assignee && findAgent(task.assignee, roster)?.rank === "board";
}

/** Board consultations, newest first. */
export function boardConsultations(board: KanbanBoard, roster?: readonly RosterAgent[]): KanbanTask[] {
  return allTasks(board)
    .filter((t) => isBoardTask(t, roster))
    .sort((a, b) => b.created_at - a.created_at);
}

/** Subtasks done / total; Hermes counts archived as satisfying a dependency too. */
export function subtaskProgress(subtasks: readonly { status: TaskStatus }[]): { done: number; total: number } {
  return { done: subtasks.filter((s) => s.status === "done" || s.status === "archived").length, total: subtasks.length };
}

/** Mandates awaiting HQ; specialists' own `review` tasks are not HQ's to approve. */
export function pendingApprovals(board: KanbanBoard, roster?: readonly RosterAgent[]): KanbanTask[] {
  return allTasks(board).filter((t) => t.status === AWAITING_APPROVAL && isMandate(t, roster));
}

export const CLIENT_REPLY_PREFIX = "Client reply:";

/**
 * A reply an agent with client channels wants to send that commits Zain (price, scope, dates,
 * terms…): HQ approves the exact text before it goes to the client.
 */
export function isClientReply(task: KanbanTask, roster?: readonly RosterAgent[]): boolean {
  if (!task.assignee || !task.title.startsWith(CLIENT_REPLY_PREFIX)) return false;
  return (findAgent(task.assignee, roster)?.clientChannels?.length ?? 0) > 0;
}

/** Client replies awaiting HQ's decision. */
export function pendingClientReplies(board: KanbanBoard, roster?: readonly RosterAgent[]): KanbanTask[] {
  return allTasks(board).filter((t) => t.status === AWAITING_APPROVAL && isClientReply(t, roster));
}

/** Everything HQ must decide: mandates and client replies (the HUD badge). */
export function hqDecisionCount(board: KanbanBoard, roster?: readonly RosterAgent[]): number {
  return pendingApprovals(board, roster).length + pendingClientReplies(board, roster).length;
}

/**
 * Specialists' tasks parked in `review`: no HQ approval is due, but a human must unstick them.
 * Internal reviews are excluded; their reviewer handles them.
 */
export function waitingSubtaskReviews(board: KanbanBoard, roster?: readonly RosterAgent[]): KanbanTask[] {
  return allTasks(board).filter(
    (t) => t.status === AWAITING_APPROVAL && !isMandate(t, roster) && !isClientReply(t, roster) && !isInternalReview(t, roster),
  );
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

/**
 * An external agent (not a Hermes profile, see RosterAgent.external) has no Hermes worker whose state
 * the board reflects in full: it works its lane through a bridge. It is "working" while a task assigned
 * to its lane is running, otherwise idle.
 */
export function laneActivity(lane: string, board: KanbanBoard): { activity: AgentActivity; task: KanbanTask | null } {
  const task = allTasks(board).find((t) => t.assignee === lane && t.status === "running") ?? null;
  return { activity: task ? "working" : "idle", task };
}

/** agentActivity for a roster agent, or laneActivity when it is external. */
export function rosterActivity(
  agent: Pick<RosterAgent, "profile" | "external">,
  board: KanbanBoard,
): { activity: AgentActivity; task: KanbanTask | null } {
  return agent.external ? laneActivity(agent.profile, board) : agentActivity(agent.profile, board);
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
