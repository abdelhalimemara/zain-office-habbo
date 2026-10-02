import { useId, useState, type FormEvent } from "react";
import { divisionForTenant } from "@shared/divisions";
import { AWAITING_APPROVAL, NO_BRIEF, splitMandateBody, subtaskProgress } from "@shared/flow";
import { useAddComment, useReject, useReopen, useTaskDetail } from "../api/hooks";
import { useUiStore } from "../state/store";
import { ApprovalActions } from "./ApprovalActions";
import { AgentChip, ErrorNote, mandateVpTitle, Text, useRosterAgents } from "./common";
import { Panel } from "./Panel";

export const COMMENT_HELP =
  "Comments are notes on the card. Agents only see them when they next work on this task. They don't start work.";

type CommentMode = "note" | "review-mandate" | "done-mandate";

function CommentBox({ taskId, mode, vpTitle }: { taskId: string; mode: CommentMode; vpTitle?: string }) {
  const add = useAddComment();
  const reject = useReject();
  const reopen = useReopen();
  const [body, setBody] = useState("");
  const id = useId();
  const helpId = useId();
  const text = body.trim();
  const pending = add.isPending || reject.isPending || reopen.isPending;
  const clear = { onSuccess: () => setBody("") };
  const resetAll = () => [add, reject, reopen].forEach((m) => m.reset());

  const addNote = (e?: FormEvent) => {
    e?.preventDefault();
    if (!text) return;
    resetAll();
    add.mutate({ id: taskId, body: text }, clear);
  };
  const sendInstructions = () => {
    resetAll();
    reject.mutate({ id: taskId, reason: text }, clear);
  };
  const reopenWith = (e: FormEvent) => {
    e.preventDefault();
    if (!text) return;
    resetAll();
    reopen.mutate({ id: taskId, instructions: text }, clear);
  };

  const status = add.isSuccess
    ? "Comment posted."
    : reject.isSuccess
      ? `Sent to ${vpTitle} as instructions.`
      : reopen.isSuccess
        ? `Reopened for ${vpTitle}.`
        : "";

  return (
    <form className="zui-form" onSubmit={mode === "done-mandate" ? reopenWith : addNote}>
      <label htmlFor={id} className="zui-label">
        {mode === "done-mandate" ? "Instructions or note" : "Comment"}
      </label>
      <textarea
        id={id}
        className="zui-input"
        rows={2}
        maxLength={mode === "done-mandate" ? 4000 : 20000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-describedby={helpId}
      />
      <p id={helpId} className="zui-hint">
        {COMMENT_HELP}
      </p>
      {mode === "review-mandate" && <p className="zui-hint">Want the VP to act on this? Use 'Send back to VP' above.</p>}
      {mode === "done-mandate" && (
        <p className="zui-hint">This mandate is closed. Reopen it to have {vpTitle} act on your instructions.</p>
      )}
      <div className="zui-row">
        {mode === "done-mandate" ? (
          <>
            <button type="submit" className="zui-btn zui-btn--primary" disabled={pending || !text}>
              {reopen.isPending ? "Reopening…" : "Reopen with instructions"}
            </button>
            <button type="button" className="zui-btn" onClick={() => addNote()} disabled={pending || !text}>
              {add.isPending ? "Posting…" : "Add note only"}
            </button>
          </>
        ) : (
          <>
            <button type="submit" className="zui-btn" disabled={pending || !text}>
              {add.isPending ? "Posting…" : "Add comment"}
            </button>
            {mode === "review-mandate" && (
              <button type="button" className="zui-btn zui-btn--primary" onClick={sendInstructions} disabled={pending || !text}>
                {reject.isPending ? "Sending…" : "Send as instructions to VP"}
              </button>
            )}
          </>
        )}
      </div>
      <p className="zui-status" role="status" aria-live="polite">
        {status}
      </p>
      <ErrorNote error={add.error ?? reject.error ?? reopen.error} />
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
  const vpTitle = task ? mandateVpTitle(task, agents) : undefined;
  const commentMode: CommentMode =
    vpTitle && task?.status === AWAITING_APPROVAL ? "review-mandate" : vpTitle && task?.status === "done" ? "done-mandate" : "note";
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
              <AgentChip profile={task.assignee} agents={agents} size="md" />
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
