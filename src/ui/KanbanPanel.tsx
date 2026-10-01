import { getDivision, type DivisionId } from "@shared/divisions";
import { agentActivity, tasksForTenant } from "@shared/flow";
import { TASK_STATUSES } from "@shared/hermes";
import { useBoard } from "../api/hooks";
import { useUiStore } from "../state/store";
import { ActivityBadge, divisionManager, ErrorNote, useRosterAgents } from "./common";
import { Panel } from "./Panel";
import { TaskCard } from "./TaskCard";

export function KanbanPanel({ division }: { division: DivisionId }) {
  const d = getDivision(division);
  const board = useBoard();
  const { agents } = useRosterAgents();
  const openPanel = useUiStore((s) => s.openPanel);
  const closePanel = useUiStore((s) => s.closePanel);
  const manager = divisionManager(division, agents);
  const tasks = board.data ? tasksForTenant(board.data, d.tenant) : [];
  const managerActivity = board.data ? agentActivity(manager.profile, board.data).activity : null;

  return (
    <Panel title={`${d.name} · Kanban`} accent={d.color} onClose={closePanel} wide>
      <section className="zui-manager">
        <div>
          <strong>{manager.title}</strong> <span className="zui-mono">{manager.profile}</span>
          {managerActivity && <ActivityBadge activity={managerActivity} />}
        </div>
        <button type="button" className="zui-btn zui-btn--primary" onClick={() => openPanel({ kind: "mandate", division })}>
          New mandate
        </button>
      </section>
      <ErrorNote error={board.error} />
      {board.isPending && <p className="zui-hint">Loading board…</p>}
      <div className="zui-kanban">
        {TASK_STATUSES.map((status) => {
          const col = tasks.filter((t) => t.status === status);
          return (
            <section key={status} className="zui-column" aria-label={`${status} (${col.length})`}>
              <h3 className="zui-column__title">
                {status} <span className="zui-count">{col.length}</span>
              </h3>
              <ul className="zui-column__list">
                {col.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    agents={agents}
                    now={board.data?.now ?? Date.now() / 1000}
                    onOpen={(id) => openPanel({ kind: "task", id })}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Panel>
  );
}
