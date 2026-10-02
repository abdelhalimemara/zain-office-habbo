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
  reopen: (id: string) => `/api/tasks/${encodeURIComponent(id)}/reopen`,
  unblock: (id: string) => `/api/tasks/${encodeURIComponent(id)}/unblock`,
  boardConsult: "/api/board/consult",
  roster: "/api/roster",
  hire: "/api/hire",
  headcountCatalog: "/api/headcount/catalog",
  connections: "/api/connections",
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
  /** `ready` when Telegram has a home channel, so the CEO can be woken for approvals; set via /sethome. */
  telegramApprovals: "ready" | "needs-sethome" | "unknown";
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
  /** Human-readable timeline, oldest first; noise (heartbeats, spawns, workspace tips) removed. */
  history: TaskHistoryEntry[];
}

export type TaskHistoryKind =
  | "created"
  | "started"
  | "subtask-linked"
  | "blocked"
  | "unblocked"
  | "review-requested"
  | "sent-back"
  | "completed"
  | "commented"
  | "status";

export interface TaskHistoryEntry {
  id: number;
  kind: TaskHistoryKind;
  /** Unix seconds. */
  at: number;
  /** Roster profile or UI author when known. */
  actor: string | null;
  /** One line, plain text, ≤ 280 chars (summary, reason, comment excerpt, linked task id…). */
  text: string | null;
  /** Related task id (e.g. the linked subtask). */
  relatedTaskId?: string;
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
  /** True when Telegram will wake the CEO on this mandate's review, block and completion. */
  telegramSubscribed: boolean;
  /** Why not, when telegramSubscribed is false; the mandate is still created. */
  telegramReason?: WakeReason;
}

export type WakeReason = "no-home-channel" | "cli-failed" | "invalid-task-id" | "hermes-unavailable";

export interface ApproveRequest {
  note?: string;
  /**
   * Client replies only: the exact text to send (HQ's edit of the draft, 1..4000 chars). Without
   * it the agent's draft (its review summary) is approved as written.
   */
  finalText?: string;
}

export interface RejectRequest {
  reason: string;
}

/** Reopen a `done` or `review` mandate with instructions for its VP (1..4000 chars) → 200 ApprovalResponse; 409 otherwise. */
export interface ReopenRequest {
  instructions: string;
}

/** Unblock a `blocked` mandate with instructions for its VP (1..4000 chars) → 200 ApprovalResponse; 409 otherwise. */
export interface UnblockRequest {
  instructions: string;
}

/** Approve / reject / reopen / unblock → 200; approve and reject answer 409 when the task is not in `review`. */
export interface ApprovalResponse {
  task: KanbanTask;
}

/** Ask the board: one task per member. `members` defaults to every hired board member. */
export interface BoardConsultRequest {
  question: string;
  members?: string[];
  relatedTaskId?: string;
}

/** 201: one "Board consultation" task per member; each wakes the CEO on Telegram when possible. */
export interface BoardConsultResponse {
  tasks: KanbanTask[];
  /** True when every task will wake the CEO on Telegram. */
  telegramSubscribed: boolean;
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

/** Green = ok, yellow = degraded or needs attention, red = down or misconfigured, grey = intentionally off. */
export type ConnectionStatus = "ok" | "warn" | "error" | "off";

export type ConnectionKind = "channel" | "mcp" | "cli";

export interface Connection {
  /** Stable id, e.g. "channel:telegram", "channel:whatsapp", "mcp:adspirer", "cli:ntn". */
  id: string;
  kind: ConnectionKind;
  /** Display name, e.g. "Telegram", "WhatsApp · Ahmad", "Notion CLI". */
  name: string;
  status: ConnectionStatus;
  /** One plain-text line explaining the status (never secrets). */
  detail: string;
  /** Hermes profile it belongs to, when not the default/global one. */
  profile?: string;
  /** Unix seconds of the last check. */
  checkedAt: number;
}

export interface ConnectionsResponse {
  connections: Connection[];
}
