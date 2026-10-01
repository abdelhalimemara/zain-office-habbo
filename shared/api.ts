/**
 * Contract between the web app (src/) and the local server (server/).
 * The server owns the Hermes session token; the browser never sees it.
 * All kanban calls are pinned to KANBAN_BOARD.
 */
import type { DivisionId } from "./divisions";
import type { KanbanBoard, KanbanComment, KanbanTask } from "./hermes";
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
  board: string;
}

export type BoardResponse = KanbanBoard;

export interface TaskDetailResponse {
  task: KanbanTask;
  comments: KanbanComment[];
  parents: string[];
  children: string[];
}

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
