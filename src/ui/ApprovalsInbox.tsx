import { DIVISIONS } from "@shared/divisions";
import { pendingApprovals } from "@shared/flow";
import { useBoard } from "../api/hooks";
import { useUiStore } from "../state/store";
import { ApprovalActions } from "./ApprovalActions";
import { AgentChip, ErrorNote, Text, useRosterAgents } from "./common";
import { Panel } from "./Panel";

export function ApprovalsInbox() {
  const board = useBoard();
  const { agents } = useRosterAgents();
  const openPanel = useUiStore((s) => s.openPanel);
  const closePanel = useUiStore((s) => s.closePanel);
  const pending = board.data ? pendingApprovals(board.data, agents) : [];
  const groups = DIVISIONS.map((d) => ({ d, tasks: pending.filter((t) => t.tenant === d.tenant) }));
  const other = pending.filter((t) => !DIVISIONS.some((d) => d.tenant === t.tenant));

  return (
    <Panel title={`Approvals (${pending.length})`} onClose={closePanel}>
      <ErrorNote error={board.error} />
      {board.isPending && <p className="zui-hint">Loading…</p>}
      {board.data && pending.length === 0 && <p className="zui-hint">Nothing awaiting HQ approval.</p>}
      {[...groups, { d: { id: "other", name: "Other", color: "#8A93A3" }, tasks: other }]
        .filter((g) => g.tasks.length > 0)
        .map(({ d, tasks }) => (
          <section key={d.id} className="zui-group" style={{ borderColor: d.color }}>
            <h3 className="zui-group__title" style={{ color: d.color }}>
              {d.name}
            </h3>
            {tasks.map((t) => (
              <article key={t.id} className="zui-approval-item">
                <button type="button" className="zui-link" onClick={() => openPanel({ kind: "task", id: t.id })}>
                  {t.title}
                </button>
                <div className="zui-card__meta">
                  <AgentChip profile={t.assignee} agents={agents} />
                </div>
                <Text className="zui-text--preview">{t.latest_summary ?? t.result}</Text>
                <ApprovalActions taskId={t.id} />
              </article>
            ))}
          </section>
        ))}
    </Panel>
  );
}
