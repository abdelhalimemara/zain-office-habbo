/**
 * Contract between the web app (src/) and the local server (server/).
 * The server owns the Hermes session token; the browser never sees it.
 * All kanban calls are pinned to KANBAN_BOARD. Timestamps are unix seconds (passed through from Hermes).
 * Errors are non-2xx with ApiError: 400 invalid, 404, 409 wrong state, 413 body > 128KB, 415 non-JSON,
 * 403 foreign host/origin, 502 Hermes unreachable or token rejected.
 */
import type { DivisionId } from "./divisions";
import type { KanbanBoard, KanbanComment, KanbanTask, TaskStatus } from "./hermes";
import type { RosterAgent } from "./roster";

export const API = {
  health: "/api/health",
  board: "/api/board",
  task: (id: string) => `/api/tasks/${encodeURIComponent(id)}`,
  taskComments: (id: string) => `/api/tasks/${encodeURIComponent(id)}/comments`,
  mandates: "/api/mandates",
  approve: (id: string) => `/api/approvals/${encodeURIComponent(id)}/approve`,
  reject: (id: string) => `/api/approvals/${encodeURIComponent(id)}/reject`,
  roster: "/api/roster",
  hire: "/api/hire",
  headcountCatalog: "/api/headcount/catalog",
} as const;

export interface HealthResponse {
  ok: boolean;
  hermes: "reachable" | "unreachable" | "unauthorized";
  telegram: "connected" | "disconnected" | "unknown";
  /**
   * Hermes `kanban.review_dispatch` (default on): when on, a Hermes review agent claims every
   * `review` task and may approve mandates before HQ sees them.
   */
  reviewDispatch: "on" | "off" | "unknown";
  board: string;
  /** Present when the server runs the dependency reconciler (it does outside tests). */
  reconciler?: ReconcilerStatus;
}

/** The last completed reconciler run: unix seconds (null before the first) and edges repaired in it. */
export interface ReconcilerStatus {
  lastRunAt: number | null;
  repaired: number;
}

export type BoardResponse = KanbanBoard;

export interface Subtask {
  id: string;
  title: string;
  status: TaskStatus;
  assignee: string | null;
}

export interface TaskDetailResponse {
  task: KanbanTask;
  comments: KanbanComment[];
  /** Raw Hermes links. A mandate's subtasks are its *parents* (the mandate waits on them). */
  parents: string[];
  children: string[];
  /** The mandate's subtasks (from its parents); empty for non-mandates. */
  subtasks: Subtask[];
}

/** POST taskComments → 201 TaskDetailResponse (refreshed). */
export interface AddCommentRequest {
  body: string;
}

/** Integer in -100..100; 0 is normal. */
export interface CreateMandateRequest {
  division: DivisionId;
  title: string;
  body?: string;
  priority?: number;
}

export interface CreateMandateResponse {
  task: KanbanTask;
  /** False when no Telegram home channel is configured; the mandate is still created. */
  telegramSubscribed: boolean;
}

export interface ApproveRequest {
  note?: string;
}

export interface RejectRequest {
  reason: string;
}

/** Approve / reject → 200; 409 when the task is not in `review`. */
export interface ApprovalResponse {
  task: KanbanTask;
}

export interface RosterEntry extends RosterAgent {
  /** True when the Hermes profile exists. */
  hired: boolean;
  model: string | null;
}

export interface RosterResponse {
  agents: RosterEntry[];
}

export type HireRequest = Omit<RosterAgent, "reviewer"> & { reviewer?: boolean };

export interface HireStep {
  step: "create-profile" | "write-soul" | "describe" | "install-skill";
  target: string;
  ok: boolean;
  error?: string;
}

/** Always 200; check `ok` and each step. */
export interface HireResponse {
  ok: boolean;
  profile: string;
  steps: HireStep[];
}

export interface HeadcountDepartment {
  id: string;
  skills: string[];
}

export interface HeadcountCatalogResponse {
  departments: HeadcountDepartment[];
}

export interface ApiError {
  error: string;
}
