import type { KanbanTask, TaskStatus } from "@shared/hermes";

export type LaneId = "inbox" | "ready" | "working" | "blocked" | "awaiting" | "done";

export interface Lane {
  id: LaneId;
  label: string;
  statuses: readonly TaskStatus[];
}

/** The manager's view of Hermes' eight statuses. Archived tasks are not shown. */
export const LANES: readonly Lane[] = [
  { id: "inbox", label: "Inbox", statuses: ["triage", "todo", "scheduled"] },
  { id: "ready", label: "Ready", statuses: ["ready"] },
  { id: "working", label: "Working", statuses: ["running"] },
  { id: "blocked", label: "Blocked", statuses: ["blocked"] },
  { id: "awaiting", label: "Awaiting HQ", statuses: ["review"] },
  { id: "done", label: "Done", statuses: ["done"] },
];

export const DONE_PREVIEW = 10;

export function groupByLane(tasks: readonly KanbanTask[]): Record<LaneId, KanbanTask[]> {
  const groups = Object.fromEntries(LANES.map((l) => [l.id, [] as KanbanTask[]])) as Record<LaneId, KanbanTask[]>;
  for (const task of tasks) {
    const lane = LANES.find((l) => l.statuses.includes(task.status));
    if (lane) groups[lane.id].push(task);
  }
  groups.done.sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0));
  return groups;
}

/** On a phone one lane is shown at a time; open on the one that most needs HQ. */
export function defaultLane(groups: Record<LaneId, KanbanTask[]>): LaneId {
  const order: LaneId[] = ["awaiting", "blocked", "working", "ready", "inbox", "done"];
  return order.find((id) => groups[id].length > 0) ?? "inbox";
}
