import { useId, useState, type FormEvent } from "react";
import { divisionForTenant } from "@shared/divisions";
import { AWAITING_APPROVAL, isMandate, NO_BRIEF, splitMandateBody, subtaskProgress } from "@shared/flow";
import { useAddComment, useTaskDetail } from "../api/hooks";
import { useUiStore } from "../state/store";
import { ApprovalActions } from "./ApprovalActions";
import { AgentChip, ErrorNote, Text, useRosterAgents } from "./common";
import { Panel } from "./Panel";

function CommentBox({ taskId }: { taskId: string }) {
  const add = useAddComment();
  const [body, setBody] = useState("");
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    add.mutate({ id: taskId, body: text }, { onSuccess: () => setBody("") });
  };
  return (
    <form className="zui-form" onSubmit={submit}>
      <label htmlFor={id} className="zui-label">
        Add comment
      </label>
      <textarea id={id} className="zui-input" rows={2} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} />
      <button type="submit" className="zui-btn" disabled={add.isPending || !body.trim()}>
        {add.isPending ? "Posting…" : "Post comment"}
      </button>
      <p className="zui-status" role="status" aria-live="polite">
        {add.isSuccess ? "Comment posted." : ""}
      </p>
      <ErrorNote error={add.error} />
    </form>
  );
}

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
  const openPanel = useUiStore((s) => s.openPanel);
  const task = data?.task;
  const division = divisionForTenant(task?.tenant);
  const subtasks = data?.subtasks ?? [];
  const progress = task?.dependencyProgress ?? (subtasks.length ? subtaskProgress(subtasks) : undefined);

  return (
    <Panel title={task?.title ?? "Task"} accent={division?.color} onClose={closePanel}>
      <ErrorNote error={error} />
      {isPending && <p className="zui-hint">Loading task…</p>}
      {task && data && (
        <>
          <dl className="zui-facts">
            <dt>Status</dt>
            <dd>
              <span className={`zui-status-pill zui-status-pill--${task.status}`}>{task.status}</span>
            </dd>
            <dt>Assignee</dt>
            <dd>
              <AgentChip profile={task.assignee} agents={agents} />
            </dd>
            {division && (
              <>
                <dt>Division</dt>
                <dd>{division.name}</dd>
              </>
            )}
            <dt>Priority</dt>
            <dd>P{task.priority}</dd>
            {progress && (
              <>
                <dt>Subtasks</dt>
                <dd>
                  {progress.done}/{progress.total} subtasks done
                </dd>
              </>
            )}
          </dl>
          {subtasks.length > 0 && (
            <>
              <h3 className="zui-subheading">Subtasks</h3>
              <ul className="zui-subtasks" aria-label="Subtasks">
                {subtasks.map((s) => (
                  <li key={s.id} className="zui-subtask">
                    <button type="button" className="zui-link" onClick={() => openPanel({ kind: "task", id: s.id })}>
                      {s.title}
                    </button>{" "}
                    <span className={`zui-status-pill zui-status-pill--${s.status}`}>{s.status}</span>{" "}
                    <AgentChip profile={s.assignee} agents={agents} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {task.body && <Brief body={task.body} recipient={agents.find((a) => a.profile === task.assignee)?.title ?? "the manager"} />}
          {task.latest_summary && <h3 className="zui-subheading">Latest summary</h3>}
          <Text>{task.latest_summary}</Text>
          {task.result && <h3 className="zui-subheading">Result</h3>}
          <Text>{task.result}</Text>
          {task.status === AWAITING_APPROVAL && (
            <>
              <h3 className="zui-subheading">{isMandate(task, agents) ? "HQ approval" : "Review"}</h3>
              <ApprovalActions taskId={task.id} />
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
          <CommentBox taskId={task.id} />
        </>
      )}
    </Panel>
  );
}
