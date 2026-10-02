import type { RosterEntry } from "@shared/api";
import type { DivisionId } from "@shared/divisions";
import type { KanbanBoard, KanbanTask } from "@shared/hermes";
import {
  ACTION_DETAIL_MAX,
  ACTION_TITLE_MAX,
  ACTIONS_MAX,
  LEADERSHIP_SEATS,
  PRIORITIES_MAX,
  type ActionItem,
  type ActionPriority,
  type LeadershipSeat,
  type UpdateActionsRequest,
} from "@shared/leadership";
import type { BoardMeeting, MeetingKind } from "@shared/meetings";

export const LEADERSHIP_COLOR = "#17181A";

export const PRIORITIES: readonly ActionPriority[] = ["P1", "P2", "P3"];

/** How each seat is labelled in the VP room. */
export const SEAT_LABEL: Record<LeadershipSeat, string> = {
  default: "CEO",
  "zain-hq-coo": "COO",
  "zain-studio-vp": "VP Studio",
  "zain-growth-vp": "VP Growth",
  "zain-labs-vp": "VP Labs",
  "zain-tech-vp": "VP Tech",
};

/** The line under a seat: what the exec runs. */
export const SEAT_ROLE: Record<LeadershipSeat, string> = {
  default: "CEO agent",
  "zain-hq-coo": "HQ operations",
  "zain-studio-vp": "Zain Studio",
  "zain-growth-vp": "Zain Growth",
  "zain-labs-vp": "Zain Labs",
  "zain-tech-vp": "Zain Tech",
};

/** The exec who receives a division's mandate; HQ's go to the COO. */
export const DIVISION_HEAD: Record<DivisionId, LeadershipSeat> = {
  hq: "zain-hq-coo",
  studio: "zain-studio-vp",
  growth: "zain-growth-vp",
  labs: "zain-labs-vp",
  tech: "zain-tech-vp",
};

export const DIVISION_OPTIONS: readonly { id: DivisionId; label: string }[] = [
  { id: "hq", label: "HQ / COO" },
  { id: "studio", label: "Studio" },
  { id: "growth", label: "Growth" },
  { id: "labs", label: "Labs" },
  { id: "tech", label: "Tech" },
];

export function isLeadershipSeat(profile: string): profile is LeadershipSeat {
  return (LEADERSHIP_SEATS as readonly string[]).includes(profile);
}

export function meetingKind(m: Pick<BoardMeeting, "kind">): MeetingKind {
  return m.kind ?? "board";
}

/** The meetings of one kind, newest activity first; a meeting without a kind is a board meeting. */
export function meetingsOfKind<T extends Pick<BoardMeeting, "kind" | "updatedAt">>(meetings: readonly T[] | undefined, kind: MeetingKind): T[] {
  return (meetings ?? []).filter((m) => meetingKind(m) === kind).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** "CEO", "COO", "VP Studio"…, or the roster name for anyone else. */
export function seatLabel(profile: string, agents: readonly RosterEntry[]): string {
  if (isLeadershipSeat(profile)) return SEAT_LABEL[profile];
  const agent = agents.find((a) => a.profile === profile);
  return agent ? (agent.name ?? agent.title) : profile;
}

/** The Monday of `date`'s week, at local midnight. */
export function mondayOf(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Weekly priorities · week of 28 Sep 2026" (fixed month names: browsers disagree on "Sep" and "Sept"). */
export function defaultTopic(now: Date = new Date()): string {
  const m = mondayOf(now);
  return `Weekly priorities · week of ${m.getDate()} ${MONTHS[m.getMonth()]} ${m.getFullYear()}`;
}

/** One row of the review editor: the action as the founder is editing it. */
export interface DraftAction {
  /** Stable React key; the server id for drafted rows, a local one for added rows. */
  key: string;
  /** Server id; absent until a row added here is saved. */
  id?: string;
  division: DivisionId;
  title: string;
  detail: string;
  priority: ActionPriority;
  due: string;
  status: ActionItem["status"];
  taskId?: string;
}

let localSeq = 0;

export function toDraft(a: ActionItem): DraftAction {
  return { key: a.id, id: a.id, division: a.division, title: a.title, detail: a.detail, priority: a.priority, due: a.due ?? "", status: a.status, ...(a.taskId ? { taskId: a.taskId } : {}) };
}

export function newDraft(priority: ActionPriority = "P2", division: DivisionId = "hq"): DraftAction {
  localSeq += 1;
  return { key: `local-${Date.now().toString(36)}-${localSeq}`, division, title: "", detail: "", priority, due: "", status: "proposed" };
}

/** The editable rows of an outcome: dropped actions are left out, P1 first. */
export function draftsFrom(actions: readonly ActionItem[] | undefined): DraftAction[] {
  return sortByPriority((actions ?? []).filter((a) => a.status !== "dropped").map(toDraft));
}

/** Stable sort, P1 → P3. */
export function sortByPriority<T extends { priority: ActionPriority }>(rows: readonly T[]): T[] {
  return rows.map((r, i) => ({ r, i })).sort((a, b) => PRIORITIES.indexOf(a.r.priority) - PRIORITIES.indexOf(b.r.priority) || a.i - b.i).map((x) => x.r);
}

export function priorityCounts(rows: readonly { priority: ActionPriority }[]): Record<ActionPriority, number> {
  return { P1: rows.filter((r) => r.priority === "P1").length, P2: rows.filter((r) => r.priority === "P2").length, P3: rows.filter((r) => r.priority === "P3").length };
}

export interface RowErrors {
  title?: string;
  detail?: string;
  due?: string;
}

export interface ReviewErrors {
  priorities?: string;
  list?: string;
  rows: Record<string, RowErrors>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Problems against the limits in shared/leadership.ts; empty when the draft can be saved. */
export function validateReview(priorities: string, rows: readonly DraftAction[]): ReviewErrors {
  const errors: ReviewErrors = { rows: {} };
  if (priorities.length > PRIORITIES_MAX) errors.priorities = `Keep the priorities to ${PRIORITIES_MAX} characters.`;
  if (rows.length > ACTIONS_MAX) errors.list = `At most ${ACTIONS_MAX} actions.`;
  for (const r of rows) {
    if (r.status === "assigned") continue;
    const e: RowErrors = {};
    const title = r.title.trim();
    if (!title) e.title = "Give the action a title.";
    else if (title.length > ACTION_TITLE_MAX) e.title = `Keep the title to ${ACTION_TITLE_MAX} characters.`;
    if (r.detail.length > ACTION_DETAIL_MAX) e.detail = `Keep the detail to ${ACTION_DETAIL_MAX} characters.`;
    if (r.due && !validDate(r.due)) e.due = "Use a real date.";
    if (Object.keys(e).length) errors.rows[r.key] = e;
  }
  return errors;
}

export function hasErrors(e: ReviewErrors): boolean {
  return Boolean(e.priorities || e.list || Object.keys(e.rows).length);
}

/** The PUT body: the full list replaces the drafted one, so assigned rows are sent unchanged too. */
export function toUpdateRequest(priorities: string, rows: readonly DraftAction[]): UpdateActionsRequest {
  return {
    priorities: priorities.trim(),
    actions: rows.map((r) => ({
      id: r.id ?? r.key,
      division: r.division,
      title: r.title.trim(),
      detail: r.detail.trim(),
      priority: r.priority,
      ...(r.due ? { due: r.due } : {}),
    })),
  };
}

/** Rows still waiting to become mandates. */
export function pendingRows(rows: readonly DraftAction[]): DraftAction[] {
  return rows.filter((r) => r.status === "proposed");
}

export function mandatesQuestion(n: number): string {
  return `Create ${n} ${n === 1 ? "mandate" : "mandates"} for the divisions?`;
}

/** The mandate a row became, from the live kanban board. */
export function findTask(board: KanbanBoard | undefined, id: string | undefined): KanbanTask | undefined {
  if (!board || !id) return undefined;
  for (const c of board.columns) {
    const t = c.tasks.find((x) => x.id === id);
    if (t) return t;
  }
  return undefined;
}
