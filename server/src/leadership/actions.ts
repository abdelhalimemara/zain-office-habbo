import { randomBytes } from "node:crypto";
import { DIVISIONS, type DivisionId } from "../../../shared/divisions";
import {
  ACTION_DETAIL_MAX,
  ACTION_TITLE_MAX,
  ACTIONS_MAX,
  PRIORITIES_MAX,
  type ActionItem,
  type ActionPriority,
  type UpdateActionsRequest,
} from "../../../shared/leadership";
import { badRequest } from "../http";

export const ACTION_ID = /^act_[a-f0-9]{8}$/;
export const PRIORITIES: readonly ActionPriority[] = ["P1", "P2", "P3"];
const DUE = /^\d{4}-\d{2}-\d{2}$/;

export const newActionId = () => `act_${randomBytes(4).toString("hex")}`;

/** A real calendar date in YYYY-MM-DD. */
export function isDueDate(value: unknown): value is string {
  if (typeof value !== "string" || !DUE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** A division id, also from its name or tenant ("Studio", "Zain Studio", "zain-studio") as an agent may write it. */
function division(value: unknown): DivisionId | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  const found = DIVISIONS.find((d) => d.id === v || d.tenant === v || d.name.toLowerCase() === v || d.name.toLowerCase() === `zain ${v}`);
  return found?.id ?? null;
}

export type Drafted = Omit<ActionItem, "id" | "status" | "taskId">;

/** One drafted action checked against the contract, or the reason it is dropped. Tolerant of case and stray spaces. */
export function draftedAction(raw: unknown): Drafted | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "not an object";
  const r = raw as Record<string, unknown>;
  const div = division(r.division);
  if (!div) return `unknown division ${JSON.stringify(r.division)}`;
  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title || title.length > ACTION_TITLE_MAX) return "title missing or too long";
  const detail = r.detail === undefined || r.detail === null ? "" : typeof r.detail === "string" ? r.detail.trim() : null;
  if (detail === null || detail.length > ACTION_DETAIL_MAX) return "detail is not text or too long";
  const priority = typeof r.priority === "string" ? (r.priority.trim().toUpperCase() as ActionPriority) : null;
  if (!priority || !PRIORITIES.includes(priority)) return `priority ${JSON.stringify(r.priority)} is not P1, P2 or P3`;
  if (r.due !== undefined && r.due !== null && r.due !== "" && !isDueDate(r.due)) return `due ${JSON.stringify(r.due)} is not YYYY-MM-DD`;
  return { division: div, title, detail, priority, ...(isDueDate(r.due) ? { due: r.due } : {}) };
}

/** JSON candidates in an answer: fenced blocks first, then the outermost braces. */
function candidates(text: string): string[] {
  const fenced = [...text.matchAll(/```[a-zA-Z]*\s*\n?([\s\S]*?)```/g)].map((m) => m[1]!.trim());
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  return [...fenced, ...(first >= 0 && last > first ? [text.slice(first, last + 1)] : [])];
}

/**
 * The CEO agent's drafting answer: {"priorities", "actions": [...]}, tolerating prose around it. Invalid actions are
 * dropped (each with a log line); null when no usable JSON object is found at all.
 */
export function parseDraft(text: string, log: (line: string) => void = () => undefined): { priorities: string; actions: Drafted[] } | null {
  for (const candidate of candidates(text)) {
    let data: unknown;
    try {
      data = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    const d = data as Record<string, unknown>;
    if (!Array.isArray(d.actions) && typeof d.priorities !== "string") continue;
    const priorities = typeof d.priorities === "string" ? d.priorities.trim().slice(0, PRIORITIES_MAX) : "";
    const actions: Drafted[] = [];
    for (const [i, raw] of (Array.isArray(d.actions) ? d.actions : []).entries()) {
      const a = draftedAction(raw);
      if (typeof a === "string") log(`leadership: dropped drafted action ${i + 1} (${a})`);
      else if (actions.length >= ACTIONS_MAX) log(`leadership: dropped drafted action ${i + 1} (more than ${ACTIONS_MAX})`);
      else actions.push(a);
    }
    return { priorities, actions };
  }
  return null;
}

/** The founder's edited list (UpdateActionsRequest), validated; ids are kept only when the caller recognises them. */
export function parseUpdateActions(body: Record<string, unknown>): UpdateActionsRequest {
  const { priorities, actions } = body;
  if (priorities !== undefined && (typeof priorities !== "string" || priorities.length > PRIORITIES_MAX)) {
    throw badRequest(`priorities must be text of at most ${PRIORITIES_MAX} characters`);
  }
  if (!Array.isArray(actions)) throw badRequest("actions must be an array");
  if (actions.length > ACTIONS_MAX) throw badRequest(`at most ${ACTIONS_MAX} actions`);
  const parsed = actions.map((raw, i) => {
    const a = draftedAction(raw);
    if (typeof a === "string") throw badRequest(`action ${i + 1}: ${a}`);
    const id = (raw as Record<string, unknown>).id;
    if (id !== undefined && (typeof id !== "string" || !ACTION_ID.test(id))) throw badRequest(`action ${i + 1}: invalid id`);
    return { id: (id as string | undefined) ?? "", ...a };
  });
  return { ...(typeof priorities === "string" ? { priorities: priorities.trim() } : {}), actions: parsed };
}

/** AssignActionsRequest.ids, validated. */
export function parseAssign(body: Record<string, unknown>): string[] | undefined {
  const { ids } = body;
  if (ids === undefined || ids === null) return undefined;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > ACTIONS_MAX * 2 || !ids.every((x) => typeof x === "string" && ACTION_ID.test(x))) {
    throw badRequest("ids must be a non-empty array of action ids");
  }
  return [...new Set(ids as string[])];
}
