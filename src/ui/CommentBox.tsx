import { useId, useState, type FormEvent } from "react";
import { useAddComment, useReject, useReopen } from "../api/hooks";
import { ErrorNote } from "./common";

export const COMMENT_HELP =
  "Comments are notes on the card. Agents only see them when they next work on this task. They don't start work.";

export type CommentMode = "note" | "review-mandate" | "done-mandate";

export function CommentBox({ taskId, mode, vpTitle }: { taskId: string; mode: CommentMode; vpTitle?: string }) {
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
