import type { RosterEntry, Subtask } from "@shared/api";
import type { Division } from "@shared/divisions";
import { isClientReply, isMandate } from "@shared/flow";
import type { KanbanTask } from "@shared/hermes";
import { useUiStore } from "../state/store";
import { AgentChip, agentLabel } from "./common";
import { LaneChip, ProgressBar } from "./LaneChip";
import { Portrait } from "./Portrait";

interface HeaderProps {
  task: KanbanTask;
  division: Division | undefined;
  agents: readonly RosterEntry[];
  progress: { done: number; total: number } | undefined;
}

export function TaskOverviewHeader({ task, division, agents, progress }: HeaderProps) {
  return (
    <section className="zui-overview" aria-label="Overview">
      <div className="zui-overview__row">
        <LaneChip status={task.status} hqDecision={isMandate(task, agents) || isClientReply(task, agents)} />
        {division && (
          <span className="zui-overview__division">
            <span className="zui-dot-mark" style={{ background: division.color }} aria-hidden="true" />
            {division.name}
          </span>
        )}
        <span className="zui-overview__priority" title="Priority">
          P{task.priority}
        </span>
      </div>
      <div className="zui-overview__row">
        <AgentChip profile={task.assignee} agents={agents} size="md" />
      </div>
      {progress && progress.total > 0 && (
        <div className="zui-overview__progress">
          <span>
            {progress.done}/{progress.total} subtasks done
          </span>
          <ProgressBar done={progress.done} total={progress.total} label="Subtasks done" />
        </div>
      )}
    </section>
  );
}

export function SubtaskList({ subtasks, agents }: { subtasks: readonly Subtask[]; agents: readonly RosterEntry[] }) {
  const openPanel = useUiStore((s) => s.openPanel);
  return (
    <ul className="zui-subtasks" aria-label="Subtasks">
      {subtasks.map((s) => {
        const agent = agents.find((a) => a.profile === s.assignee);
        const name = agent ? agentLabel(agent) : (s.assignee ?? "Unassigned");
        return (
          <li key={s.id} className="zui-subtask">
            <Portrait agent={agent} name={name} size="md" vacant={agent ? !agent.hired : false} />
            <span className="zui-subtask__text">
              <button type="button" className="zui-link" onClick={() => openPanel({ kind: "task", id: s.id })}>
                {s.title}
              </button>
              <span className="zui-subtask__who">{name}</span>
            </span>
            <LaneChip status={s.status} hqDecision={false} />
          </li>
        );
      })}
    </ul>
  );
}
