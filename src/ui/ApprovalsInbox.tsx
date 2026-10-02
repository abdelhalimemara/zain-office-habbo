import { DIVISIONS } from "@shared/divisions";
import type { RosterEntry } from "@shared/api";
import { pendingApprovals, waitingSubtaskReviews } from "@shared/flow";
import type { KanbanTask } from "@shared/hermes";
import { useBoard } from "../api/hooks";
import { useUiStore } from "../state/store";
import { ApprovalActions } from "./ApprovalActions";
import { AgentChip, ErrorNote, mandateVpTitle, Text, useRosterAgents } from "./common";
import { Panel } from "./Panel";

function ApprovalItem({ task: t, agents }: { task: KanbanTask; agents: readonly RosterEntry[] }) {
  const openPanel = useUiStore((s) => s.openPanel);
  return (
    <article className="zui-approval-item">
      <button type="button" className="zui-link" onClick={() => openPanel({ kind: "task", id: t.id })}>
        {t.title}
      </button>
      <div className="zui-card__meta">
        <AgentChip profile={t.assignee} agents={agents} />
      </div>
      <Text className="zui-text--preview">{t.latest_summary ?? t.result}</Text>
      <ApprovalActions taskId={t.id} vpTitle={mandateVpTitle(t, agents)} />
    </article>
  );
}

export function ApprovalsInbox() {
  const board = useBoard();
  const { agents } = useRosterAgents();
  const closePanel = useUiStore((s) => s.closePanel);
  const pending = board.data ? pendingApprovals(board.data, agents) : [];
  const subtasks = board.data ? waitingSubtaskReviews(board.data, agents) : [];
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
          <section key={d.id} className="zui-group">
            <h3 className="zui-group__title">
              <span className="zui-dot-mark" style={{ background: d.color }} aria-hidden="true" />
              {d.name}
            </h3>
            {tasks.map((t) => (
              <ApprovalItem key={t.id} task={t} agents={agents} />
            ))}
          </section>
        ))}
      {subtasks.length > 0 && (
        <details className="zui-group zui-subreviews">
          <summary className="zui-group__title">Subtasks waiting for review ({subtasks.length})</summary>
          <p className="zui-hint">Specialist tasks parked in review. Not HQ approvals — approve or send back to unstick them.</p>
          {subtasks.map((t) => (
            <ApprovalItem key={t.id} task={t} agents={agents} />
          ))}
        </details>
      )}
    </Panel>
  );
}
