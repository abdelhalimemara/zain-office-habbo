import { divisionForTenant } from "@shared/divisions";
import { AWAITING_APPROVAL, isClientReply, NO_BRIEF, splitMandateBody, subtaskProgress } from "@shared/flow";
import { useTaskDetail } from "../api/hooks";
import { useUiStore } from "../state/store";
import { ApprovalActions } from "./ApprovalActions";
import { CommentBox, type CommentMode } from "./CommentBox";
import { ClientReplyView } from "./ClientReplyView";
import { AgentChip, agentLabel, ErrorNote, mandateVpTitle, Text, useRosterAgents } from "./common";
import { HistoryTimeline } from "./HistoryTimeline";
import { Panel } from "./Panel";
import { SubtaskList, TaskOverviewHeader } from "./TaskOverview";

export { COMMENT_HELP } from "./CommentBox";

function Brief({ body, recipient }: { body: string; recipient: string }) {
  const { brief, instructions } = splitMandateBody(body);
  return (
    <>
      <h3 className="zui-subheading">Brief</h3>
      <Text className={brief === NO_BRIEF ? "zui-text--muted" : undefined}>{brief}</Text>
      {instructions && (
        <details className="zui-instructions">
          <summary>Instructions sent to {recipient}</summary>
          <Text>{instructions}</Text>
        </details>
      )}
    </>
  );
}

export function TaskDrawer({ id }: { id: string }) {
  const { data, error, isPending } = useTaskDetail(id);
  const { agents } = useRosterAgents();
  const closePanel = useUiStore((s) => s.closePanel);
  const task = data?.task;
  const division = divisionForTenant(task?.tenant);
  const assignee = agents.find((a) => a.profile === task?.assignee);
  const assigneeLabel = assignee ? agentLabel(assignee) : "the manager";
  const subtasks = data?.subtasks ?? [];
  const vpTitle = task ? mandateVpTitle(task, agents) : undefined;
  const commentMode: CommentMode =
    vpTitle && task?.status === AWAITING_APPROVAL ? "review-mandate" : vpTitle && task?.status === "done" ? "done-mandate" : "note";
  const clientDecision = !!task && task.status === AWAITING_APPROVAL && isClientReply(task, agents);
  const progress = task?.dependencyProgress ?? (subtasks.length ? subtaskProgress(subtasks) : undefined);

  return (
    <Panel title={task?.title ?? "Task"} accent={division?.color} onClose={closePanel}>
      <ErrorNote error={error} />
      {isPending && <p className="zui-hint">Loading task…</p>}
      {task && data && (
        <>
          <TaskOverviewHeader task={task} division={division} agents={agents} progress={progress} />
          {clientDecision ? (
            <>
              <h3 className="zui-subheading">Client reply</h3>
              <ClientReplyView task={task} agents={agents} />
            </>
          ) : (
            <>
              {task.body && <Brief body={task.body} recipient={assigneeLabel} />}
              {task.latest_summary && <h3 className="zui-subheading">{vpTitle ? "Latest roll-up" : "Latest summary"}</h3>}
              <Text>{task.latest_summary}</Text>
            </>
          )}
          {task.result && <h3 className="zui-subheading">Result</h3>}
          <Text>{task.result}</Text>
          {subtasks.length > 0 && (
            <>
              <h3 className="zui-subheading">Subtasks</h3>
              <SubtaskList subtasks={subtasks} agents={agents} />
            </>
          )}
          <h3 className="zui-subheading">History</h3>
          <HistoryTimeline entries={data.history ?? []} agents={agents} />
          {task.status === AWAITING_APPROVAL && !clientDecision && (
            <>
              <h3 className="zui-subheading">{vpTitle ? "HQ approval" : "Review"}</h3>
              <ApprovalActions taskId={task.id} vpTitle={vpTitle} />
            </>
          )}
          <h3 className="zui-subheading">Comments ({data.comments.length})</h3>
          <ul className="zui-comments">
            {data.comments.map((c) => (
              <li key={c.id} className="zui-comment">
                <AgentChip profile={c.author} agents={agents} />
                <Text>{c.body}</Text>
              </li>
            ))}
          </ul>
          <CommentBox taskId={task.id} mode={commentMode} vpTitle={vpTitle} />
        </>
      )}
    </Panel>
  );
}
