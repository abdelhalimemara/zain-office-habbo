import type { KanbanBoard, KanbanTask, TaskStatus } from "../../shared/hermes";
import { BOARD_MEMBERS } from "../../shared/board";
import { KANBAN, TELEGRAM_HOME, json, task, type Handler } from "./helpers";

const STATUSES: TaskStatus[] = ["triage", "todo", "ready", "running", "blocked", "review", "done"];
const MAX_TASKS = 80;

/** An in-memory kanban board behind the Hermes routes the meetings engine uses. */
export function fakeKanban(hiredProfiles: readonly string[] = BOARD_MEMBERS.map((m) => m.profile)) {
  const tasks = new Map<string, KanbanTask>();
  let next = 0;

  const board = (): KanbanBoard => ({
    columns: STATUSES.map((name) => ({ name, tasks: [...tasks.values()].filter((t) => t.status === name) })),
    tenants: [],
    assignees: [],
    latest_event_id: 1,
    now: 1,
  });

  const routes: Record<string, Handler> = {
    "GET /api/profiles": () => ({ profiles: [{ name: "default" }, ...hiredProfiles.map((name) => ({ name }))] }),
    [`GET ${KANBAN}/home-channels`]: () => ({ home_channels: [TELEGRAM_HOME] }),
    [`GET ${KANBAN}/board`]: () => board(),
    [`POST ${KANBAN}/tasks`]: (c) => {
      const body = c.body as Partial<KanbanTask> & { triage?: boolean };
      const created = task({ id: `t_${++next}`, status: "ready", result: null, latest_summary: null, ...body });
      tasks.set(created.id, created);
      return { task: created };
    },
  };
  for (let i = 1; i <= MAX_TASKS; i++) {
    const id = `t_${i}`;
    routes[`GET ${KANBAN}/tasks/${id}`] = () =>
      tasks.has(id) ? { task: tasks.get(id), comments: [], links: { parents: [], children: [] } } : json({ detail: "not found" }, 404);
    routes[`PATCH ${KANBAN}/tasks/${id}`] = (c) => {
      const current = tasks.get(id)!;
      const updated = { ...current, ...(c.body as Partial<KanbanTask>) };
      tasks.set(id, updated);
      return { task: updated };
    };
  }

  const byTitle = (fragment: string) => [...tasks.values()].filter((t) => t.title.includes(fragment));

  return {
    routes,
    tasks,
    byTitle,
    complete(id: string, result: string | null, latest_summary: string | null = null) {
      tasks.set(id, { ...tasks.get(id)!, status: "done", result, latest_summary });
    },
    /** Completes every open task whose title contains `fragment`, with `answer(task)` as the result. */
    completeAll(fragment: string, answer: (t: KanbanTask) => string) {
      for (const t of byTitle(fragment)) if (t.status !== "done" && t.status !== "archived") this.complete(t.id, answer(t));
    },
  };
}
