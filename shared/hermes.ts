/** Shapes returned by the Hermes kanban plugin (plugins/kanban/dashboard/plugin_api.py). */

export const TASK_STATUSES = [
  "triage",
  "todo",
  "scheduled",
  "ready",
  "running",
  "blocked",
  "review",
  "done",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number] | "archived";

export interface KanbanTask {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: TaskStatus;
  priority: number;
  created_by: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  tenant: string | null;
  result: string | null;
  latest_summary?: string | null;
  current_run_started_at?: number | null;
  link_counts?: { parents: number; children: number };
  comment_count?: number;
  /** Children done / total; null when the task has no children. */
  progress?: { done: number; total: number } | null;
  warnings?: { count: number; highest_severity: string | null } | null;
}

export interface KanbanColumn {
  name: TaskStatus;
  tasks: KanbanTask[];
}

export interface KanbanBoard {
  columns: KanbanColumn[];
  tenants: string[];
  assignees: string[];
  latest_event_id: number;
  now: number;
}

export interface KanbanComment {
  id: number;
  task_id: string;
  author: string;
  body: string;
  created_at: number;
}

export interface CreateTaskInput {
  title: string;
  body?: string;
  assignee?: string;
  tenant?: string;
  priority?: number;
  parents?: string[];
  triage?: boolean;
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  assignee?: string;
  priority?: number;
  title?: string;
  body?: string;
  result?: string;
  block_reason?: string;
  summary?: string;
}

export interface HermesProfile {
  name: string;
  is_default: boolean;
  model: string | null;
  provider: string | null;
  description: string;
  skill_count: number;
}
