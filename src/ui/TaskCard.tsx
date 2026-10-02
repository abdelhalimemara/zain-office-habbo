import type { RosterEntry } from "@shared/api";
import { isClientReply, isMandate } from "@shared/flow";
import { findUnit } from "@shared/units";
import type { KanbanTask } from "@shared/hermes";
import { ChannelIcon } from "./ChannelIcon";
import { parseClientReply } from "./clientReply";
import { AgentChip, formatAge } from "./common";

interface Props {
  task: KanbanTask;
  agents: readonly RosterEntry[];
  now: number;
  /** The raw Hermes status, shown when the card's lane spans several statuses. */
  statusTag?: string;
  onOpen: (id: string) => void;
}

function ClientReplyBadge({ task }: { task: KanbanTask }) {
  const { channel } = parseClientReply(task);
  return (
    <span className="zui-badge zui-badge--client">
      {channel && <ChannelIcon channel={channel} />}
      Client reply
    </span>
  );
}

export function TaskCard({ task, agents, now, statusTag, onOpen }: Props) {
  const warnings = task.warnings?.count ?? 0;
  const unit = findUnit(agents.find((a) => a.profile === task.assignee)?.unit);
  return (
    <li>
      <button type="button" className="zui-card" onClick={() => onOpen(task.id)}>
        <span className="zui-card__title">{task.title}</span>
        <span className="zui-card__meta">
          <AgentChip profile={task.assignee} agents={agents} />
          {unit && <span className="zui-tag zui-tag--unit" title="Unit">{unit.name}</span>}
          {isMandate(task, agents) && <span className="zui-badge zui-badge--mandate">Mandate</span>}
          {isClientReply(task, agents) && <ClientReplyBadge task={task} />}
          {statusTag && <span className="zui-tag" title="Hermes status">{statusTag}</span>}
        </span>
        <span className="zui-card__meta zui-card__stats">
          {task.dependencyProgress && (
            <span title="Subtasks done">
              {task.dependencyProgress.done}/{task.dependencyProgress.total} subtasks
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
