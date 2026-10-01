import type { RosterEntry } from "@shared/api";
import { isMandate } from "@shared/flow";
import type { KanbanTask } from "@shared/hermes";
import { AgentChip, formatAge } from "./common";

interface Props {
  task: KanbanTask;
  agents: readonly RosterEntry[];
  now: number;
  onOpen: (id: string) => void;
}

export function TaskCard({ task, agents, now, onOpen }: Props) {
  const warnings = task.warnings?.count ?? 0;
  return (
    <li>
      <button type="button" className="zui-card" onClick={() => onOpen(task.id)}>
        <span className="zui-card__title">{task.title}</span>
        <span className="zui-card__meta">
          <AgentChip profile={task.assignee} agents={agents} />
          {isMandate(task, agents) && <span className="zui-badge zui-badge--mandate">Mandate</span>}
        </span>
        <span className="zui-card__meta zui-card__stats">
          {task.progress && (
            <span title="Subtasks done">
              {task.progress.done}/{task.progress.total}
            </span>
          )}
          <span title="Priority">P{task.priority}</span>
          <span title="Age">{formatAge(task.created_at, now)}</span>
          {(task.comment_count ?? 0) > 0 && <span title="Comments">💬 {task.comment_count}</span>}
          {warnings > 0 && (
            <span className="zui-badge zui-badge--warn" title={task.warnings?.highest_severity ?? "Warnings"}>
              ⚠ {warnings}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
