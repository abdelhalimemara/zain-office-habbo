import type { CreateMandateRequest, CreateMandateResponse, TaskDetailResponse } from "../../../shared/api";
import { DIVISION_IDS, divisionForTenant, getDivision, type DivisionId } from "../../../shared/divisions";
import { AWAITING_APPROVAL, isMandate } from "../../../shared/flow";
import type { KanbanTask } from "../../../shared/hermes";
import { managerOf, type RosterAgent } from "../../../shared/roster";
import { HermesError, type HermesClient } from "../hermes/client";
import { HttpError, badRequest, optionalString, requiredString } from "../http";
import type { CeoWake } from "../telegram/ceoWake";
import { mandateSubtasks } from "./board";
import { fullRoster, type HireStore } from "./hireStore";
import { mandateBody } from "./persona";

export const UI_AUTHOR = "zain-hq-ui";
export const PRIORITY_MIN = -100;
export const PRIORITY_MAX = 100;

export function parseMandate(body: Record<string, unknown>): CreateMandateRequest {
  if (!DIVISION_IDS.includes(body.division as DivisionId)) throw badRequest("division is not a Zain division");
  const title = requiredString(body, "title", 1, 200);
  const brief = optionalString(body, "body", 20_000);
  const priority = body.priority ?? 0;
  if (typeof priority !== "number" || !Number.isInteger(priority) || priority < PRIORITY_MIN || priority > PRIORITY_MAX) {
    throw badRequest(`priority must be an integer in ${PRIORITY_MIN}..${PRIORITY_MAX}`);
  }
  return { division: body.division as DivisionId, title, body: brief, priority };
}

export async function createMandate(
  req: CreateMandateRequest,
  hermes: HermesClient,
  hires: HireStore,
  ceoWake: CeoWake,
): Promise<CreateMandateResponse> {
  const roster = await fullRoster(hires);
  const manager = managerOf(req.division, roster);
  const task = await hermes.createTask({
    title: req.title,
    body: mandateBody(req.body ?? "", manager, roster),
    assignee: manager.profile,
    tenant: getDivision(req.division).tenant,
    priority: req.priority ?? 0,
    triage: false,
  });
  const wake = await ceoWake.subscribe(task.id);
  return { task, telegramSubscribed: wake.subscribed, ...(wake.reason ? { telegramReason: wake.reason } : {}) };
}

export async function taskDetail(id: string, hermes: HermesClient, hires: HireStore): Promise<TaskDetailResponse> {
  const [detail, roster] = await Promise.all([hermes.task(id), fullRoster(hires)]);
  return {
    task: detail.task,
    comments: detail.comments ?? [],
    parents: detail.links?.parents ?? [],
    children: detail.links?.children ?? [],
    subtasks: await mandateSubtasks(detail, roster, hermes),
    history: [],
  };
}

async function requireAwaitingApproval(id: string, hermes: HermesClient): Promise<KanbanTask> {
  const { task } = await hermes.task(id);
  if (task.status !== AWAITING_APPROVAL) {
    throw new HttpError(409, `task ${id} is ${task.status}, not awaiting approval`);
  }
  return task;
}

/**
 * review → done goes through Hermes' complete_task (PATCH status=done), which accepts `review`
 * as human approval. complete_task overwrites `result` and `kanban_request_review` only writes
 * the summary, so the roll-up is resent as the result to survive completion.
 */
export async function approve(id: string, note: string | undefined, hermes: HermesClient): Promise<KanbanTask> {
  const task = await requireAwaitingApproval(id, hermes);
  const summary = note ? `Approved by HQ: ${note}` : "Approved by HQ";
  const result = task.result ?? task.latest_summary ?? undefined;
  await hermes.addComment(id, summary, UI_AUTHOR);
  return hermes.updateTask(id, { status: "done", summary, ...(result ? { result } : {}) });
}

/**
 * Mandates go back to the division manager in case review was routed to someone else. A re-pin
 * refused because a worker already claimed the task (409) still leaves it with a runnable owner.
 */
async function repinToManager(id: string, task: KanbanTask, roster: readonly RosterAgent[], hermes: HermesClient): Promise<KanbanTask> {
  const division = divisionForTenant(task.tenant);
  if (!division) return task;
  const manager = managerOf(division.id, roster).profile;
  if (task.assignee === manager) return task;
  try {
    return await hermes.updateTask(id, { assignee: manager });
  } catch (err) {
    if (err instanceof HermesError && err.status === 409) return task;
    throw err;
  }
}

/**
 * review → todo is routed by Hermes to reopen_review_task, which lands on `ready` (or `todo`
 * while parents are open) and restores the implementer. Mandates are re-pinned to the manager;
 * other tasks keep the restored implementer.
 */
export async function reject(id: string, reason: string, hermes: HermesClient, hires: HireStore): Promise<KanbanTask> {
  const task = await requireAwaitingApproval(id, hermes);
  await hermes.addComment(id, `Changes requested by HQ: ${reason}`, UI_AUTHOR);
  const reopened = await hermes.updateTask(id, { status: "todo" });
  const roster = await fullRoster(hires);
  if (!(isMandate(task, roster) || isMandate(reopened, roster))) return reopened;
  return repinToManager(id, reopened, roster, hermes);
}

async function requireMandate(id: string, hermes: HermesClient, hires: HireStore) {
  const [{ task }, roster] = await Promise.all([hermes.task(id), fullRoster(hires)]);
  if (!isMandate(task, roster)) throw new HttpError(409, `task ${id} is not a mandate`);
  return { task, roster };
}

/** blocked → ready goes through Hermes' unblock_task, which re-gates on open parents (→ todo). */
export async function unblock(id: string, instructions: string, hermes: HermesClient, hires: HireStore): Promise<KanbanTask> {
  const { task } = await requireMandate(id, hermes, hires);
  if (task.status !== "blocked") throw new HttpError(409, `mandate ${id} is ${task.status}, not blocked`);
  await hermes.addComment(id, `HQ: ${instructions}`, UI_AUTHOR);
  return hermes.updateTask(id, { status: "ready" });
}

const REOPENABLE = new Set(["done", "review"]);

/**
 * Comments never wake an agent and a done task never runs, so HQ's follow-up on a closed (or
 * awaiting) mandate must reopen it. PATCH status=ready is accepted from both: from `review`
 * Hermes runs reopen_review_task; from `done` it writes `ready` directly, refusing (409) only while
 * a parent is unfinished, in which case `todo` waits for the parents and resumes on its own.
 */
export async function reopen(id: string, instructions: string, hermes: HermesClient, hires: HireStore): Promise<KanbanTask> {
  const { task, roster } = await requireMandate(id, hermes, hires);
  if (!REOPENABLE.has(task.status)) throw new HttpError(409, `mandate ${id} is ${task.status}; only done or review mandates can be reopened`);
  await hermes.addComment(id, `HQ reopened this mandate: ${instructions}`, UI_AUTHOR);
  let reopened: KanbanTask;
  try {
    reopened = await hermes.updateTask(id, { status: "ready" });
  } catch (err) {
    if (!(err instanceof HermesError && err.status === 409)) throw err;
    reopened = await hermes.updateTask(id, { status: "todo" });
  }
  return repinToManager(id, reopened, roster, hermes);
}
