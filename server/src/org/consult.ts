import type { BoardConsultRequest, BoardConsultResponse } from "../../../shared/api";
import { boardMembers } from "../../../shared/roster";
import type { HermesClient } from "../hermes/client";
import { HttpError, TASK_ID, badRequest, requiredString } from "../http";
import type { CeoWake } from "../telegram/ceoWake";
import { CONSULTATION_PREFIX } from "./boardPersona";
import { fullRoster, type HireStore } from "./hireStore";

const QUESTION_MAX = 8000;
const TITLE_QUESTION_CHARS = 80;
const HQ_TENANT = "zain-hq";

export function parseConsult(body: Record<string, unknown>): BoardConsultRequest {
  const question = requiredString(body, "question", 1, QUESTION_MAX);
  const members = body.members;
  if (members !== undefined && (!Array.isArray(members) || members.length === 0 || !members.every((m) => typeof m === "string"))) {
    throw badRequest("members must be a non-empty array of board profiles");
  }
  const related = body.relatedTaskId;
  if (related !== undefined && related !== null && (typeof related !== "string" || !TASK_ID.test(related))) {
    throw badRequest("relatedTaskId must be a task id");
  }
  return {
    question,
    ...(members ? { members: [...new Set(members as string[])] } : {}),
    ...(typeof related === "string" ? { relatedTaskId: related } : {}),
  };
}

export function consultationTitle(question: string): string {
  const oneLine = question.replace(/\s+/g, " ").trim();
  const short = oneLine.length > TITLE_QUESTION_CHARS ? `${oneLine.slice(0, TITLE_QUESTION_CHARS).trimEnd()}…` : oneLine;
  return `${CONSULTATION_PREFIX}${short}`;
}

export function consultationBody({ question, relatedTaskId }: BoardConsultRequest): string {
  return [question, ...(relatedTaskId ? ["", `Related task: ${relatedTaskId}`] : []), "", "Answer per your board charter."].join("\n");
}

/**
 * The board seats to address: the requested ones (each must be a hired seat), or every hired
 * seat in board order. Hermes runs profiles, so a vacant seat cannot be asked.
 */
export async function hiredBoardMembers(
  requested: readonly string[] | undefined,
  deps: { hermes: HermesClient; hires: HireStore },
): Promise<string[]> {
  const [roster, profiles] = await Promise.all([fullRoster(deps.hires), deps.hermes.listProfiles()]);
  const seats = boardMembers(roster).map((a) => a.profile);
  const hired = new Set(profiles.map((p) => p.name));
  const unknown = (requested ?? []).filter((m) => !seats.includes(m));
  if (unknown.length) throw badRequest(`not board members: ${unknown.join(", ")}`);
  const members = requested ? [...requested] : seats.filter((p) => hired.has(p));
  const vacant = members.filter((m) => !hired.has(m));
  if (vacant.length) throw new HttpError(409, `not hired yet: ${vacant.join(", ")}`);
  if (members.length === 0) throw new HttpError(409, "no board members are hired yet");
  return members;
}

/** One consultation task per advisor; only hired advisors can be asked, since Hermes runs profiles. */
export async function consultBoard(
  req: BoardConsultRequest,
  deps: { hermes: HermesClient; hires: HireStore; ceoWake: CeoWake },
): Promise<BoardConsultResponse> {
  const members = await hiredBoardMembers(req.members, deps);

  const title = consultationTitle(req.question);
  const body = consultationBody(req);
  const tasks = [];
  let allSubscribed = true;
  for (const assignee of members) {
    const task = await deps.hermes.createTask({ title, body, assignee, tenant: HQ_TENANT, triage: false });
    tasks.push(task);
    allSubscribed = (await deps.ceoWake.subscribe(task.id)).subscribed && allSubscribed;
  }
  return { tasks, telegramSubscribed: allSubscribed };
}
