import type { CreateMandateRequest, CreateMandateResponse, TaskDetailResponse } from "../../../shared/api";
import { DIVISION_IDS, divisionForTenant, getDivision, type DivisionId } from "../../../shared/divisions";
import { AWAITING_APPROVAL, isMandate } from "../../../shared/flow";
import type { KanbanTask } from "../../../shared/hermes";
import { managerOf } from "../../../shared/roster";
import { HermesError, type HermesClient } from "../hermes/client";
import { HttpError, badRequest, optionalString, requiredString } from "../http";
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
  const telegramSubscribed = await hermes.subscribeHome(task.id, "telegram");
  return { task, telegramSubscribed };
}

export async function taskDetail(id: string, hermes: HermesClient, hires: HireStore): Promise<TaskDetailResponse> {
  const [detail, roster] = await Promise.all([hermes.task(id), fullRoster(hires)]);
  return {
    task: detail.task,
    comments: detail.comments ?? [],
    parents: detail.links?.parents ?? [],
    children: detail.links?.children ?? [],
    subtasks: await mandateSubtasks(detail, roster, hermes),
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
 * review → todo is routed by Hermes to reopen_review_task, which lands on `ready` (or `todo`
 * while parents are open) and restores the implementer. Mandates are re-pinned to the division
 * manager in case review was routed to someone else; other tasks keep the restored implementer.
 * A re-pin refused because a worker already claimed the task (409) still counts as rejected.
 */
export async function reject(id: string, reason: string, hermes: HermesClient, hires: HireStore): Promise<KanbanTask> {
  const task = await requireAwaitingApproval(id, hermes);
  await hermes.addComment(id, `Changes requested by HQ: ${reason}`, UI_AUTHOR);
  const reopened = await hermes.updateTask(id, { status: "todo" });
  const roster = await fullRoster(hires);
  const division = divisionForTenant(task.tenant);
  if (!division || !(isMandate(task, roster) || isMandate(reopened, roster))) return reopened;
  const manager = managerOf(division.id, roster).profile;
  if (reopened.assignee === manager) return reopened;
  try {
    return await hermes.updateTask(id, { assignee: manager });
  } catch (err) {
    if (err instanceof HermesError && err.status === 409) return reopened;
    throw err;
  }
}
