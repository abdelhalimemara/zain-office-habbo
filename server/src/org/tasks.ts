import type { CreateMandateRequest, CreateMandateResponse, TaskDetailResponse } from "../../../shared/api";
import { DIVISION_IDS, divisionForTenant, getDivision, type DivisionId } from "../../../shared/divisions";
import { AWAITING_APPROVAL } from "../../../shared/flow";
import type { KanbanTask } from "../../../shared/hermes";
import { managerOf } from "../../../shared/roster";
import type { HermesClient } from "../hermes/client";
import { HttpError, badRequest, optionalString, requiredString } from "../http";
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
    triage: true,
  });
  const telegramSubscribed = await hermes.subscribeHome(task.id, "telegram");
  return { task, telegramSubscribed };
}

export async function taskDetail(id: string, hermes: HermesClient): Promise<TaskDetailResponse> {
  const detail = await hermes.task(id);
  return {
    task: detail.task,
    comments: detail.comments ?? [],
    parents: detail.links?.parents ?? [],
    children: detail.links?.children ?? [],
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
 * as human approval. complete_task overwrites `result`, so the manager's roll-up is resent.
 */
export async function approve(id: string, note: string | undefined, hermes: HermesClient): Promise<KanbanTask> {
  const task = await requireAwaitingApproval(id, hermes);
  const summary = note ? `Approved by HQ: ${note}` : "Approved by HQ";
  await hermes.addComment(id, summary, UI_AUTHOR);
  return hermes.updateTask(id, { status: "done", summary, ...(task.result ? { result: task.result } : {}) });
}

/**
 * review → todo is routed by Hermes to reopen_review_task, which lands on `ready` (or `todo`
 * while parents are open) and restores the implementer, so the manager re-runs with the comment.
 * The assignee is re-pinned to the division manager in case the review was routed elsewhere.
 */
export async function reject(id: string, reason: string, hermes: HermesClient, hires: HireStore): Promise<KanbanTask> {
  const task = await requireAwaitingApproval(id, hermes);
  await hermes.addComment(id, `Changes requested by HQ: ${reason}`, UI_AUTHOR);
  const reopened = await hermes.updateTask(id, { status: "todo" });
  const division = divisionForTenant(task.tenant);
  if (!division) return reopened;
  const manager = managerOf(division.id, await fullRoster(hires)).profile;
  return reopened.assignee === manager ? reopened : hermes.updateTask(id, { assignee: manager });
}
