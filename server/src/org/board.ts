import type { Subtask } from "../../../shared/api";
import { allTasks, isMandate, subtaskProgress } from "../../../shared/flow";
import type { KanbanBoard, KanbanTask } from "../../../shared/hermes";
import type { RosterAgent } from "../../../shared/roster";
import type { HermesClient, HermesTaskDetail } from "../hermes/client";
import { fullRoster, type HireStore } from "./hireStore";

/**
 * A mandate waits on its subtasks, so in Hermes they are the mandate's *parents*; Hermes'
 * own `progress`/children point the other way. Archived subtasks are absent from the board,
 * so `link_tasks` from the detail fills them in (without an assignee).
 */
export function subtasksOf(detail: HermesTaskDetail, boardTasks: readonly KanbanTask[]): Subtask[] {
  const onBoard = new Map(boardTasks.map((t) => [t.id, t]));
  const linked = new Map((detail.link_tasks ?? []).map((t) => [t.id, t]));
  return (detail.links?.parents ?? []).flatMap((id): Subtask[] => {
    const t = onBoard.get(id);
    if (t) return [{ id, title: t.title, status: t.status, assignee: t.assignee }];
    const l = linked.get(id);
    return l ? [{ id, title: l.title, status: l.status, assignee: null }] : [];
  });
}

function waitsOnSubtasks(task: KanbanTask, roster: readonly RosterAgent[]): boolean {
  return isMandate(task, roster) && (task.link_counts?.parents ?? 0) > 0;
}

/** The board with `dependencyProgress` on each mandate; a mandate whose detail fails is left as is. */
export async function boardWithProgress(hermes: HermesClient, hires: HireStore): Promise<KanbanBoard> {
  const [board, roster] = await Promise.all([hermes.board(), fullRoster(hires)]);
  const tasks = allTasks(board);
  const mandates = tasks.filter((t) => waitsOnSubtasks(t, roster));
  const progress = new Map<string, { done: number; total: number }>();
  await Promise.all(
    mandates.map(async (m) => {
      try {
        progress.set(m.id, subtaskProgress(subtasksOf(await hermes.task(m.id), tasks)));
      } catch {
        return;
      }
    }),
  );
  if (progress.size === 0) return board;
  return {
    ...board,
    columns: board.columns.map((col) => ({
      ...col,
      tasks: col.tasks.map((t) => {
        const p = progress.get(t.id);
        return p ? { ...t, dependencyProgress: p } : t;
      }),
    })),
  };
}

export async function mandateSubtasks(
  detail: HermesTaskDetail,
  roster: readonly RosterAgent[],
  hermes: HermesClient,
): Promise<Subtask[]> {
  if (!isMandate(detail.task, roster) || !(detail.links?.parents ?? []).length) return [];
  const boardTasks = await hermes.board().then(allTasks, () => []);
  return subtasksOf(detail, boardTasks);
}
