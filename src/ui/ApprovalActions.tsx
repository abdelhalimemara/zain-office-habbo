import { useId, useState, type FormEvent } from "react";
import { useApprove, useReject } from "../api/hooks";
import { ErrorNote } from "./common";

export function ApprovalActions({ taskId }: { taskId: string }) {
  const approve = useApprove();
  const reject = useReject();
  const [text, setText] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const fieldId = useId();
  const errorId = useId();
  const pending = approve.isPending || reject.isPending;

  const onApprove = () => {
    setReasonError(null);
    reject.reset();
    approve.mutate({ id: taskId, note: text.trim() || undefined });
  };

  const onReject = (e: FormEvent) => {
    e.preventDefault();
    const reason = text.trim();
    if (!reason) {
      setReasonError("A reason is required to request changes.");
      return;
    }
    setReasonError(null);
    approve.reset();
    reject.mutate({ id: taskId, reason });
  };

  return (
    <form className="zui-approval" onSubmit={onReject} noValidate>
      <label htmlFor={fieldId} className="zui-label">
        Note to manager <span className="zui-hint">(required to request changes)</span>
      </label>
      <textarea
        id={fieldId}
        className="zui-input"
        rows={2}
        maxLength={20000}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (reasonError) setReasonError(null);
        }}
        aria-invalid={reasonError ? true : undefined}
        aria-describedby={reasonError ? errorId : undefined}
      />
      {reasonError && (
        <p id={errorId} className="zui-error">
          {reasonError}
        </p>
      )}
      <div className="zui-row">
        <button type="button" className="zui-btn zui-btn--primary" onClick={onApprove} disabled={pending}>
          {approve.isPending ? "Approving…" : "Approve"}
        </button>
        <button type="submit" className="zui-btn zui-btn--danger" disabled={pending}>
          {reject.isPending ? "Sending…" : "Request changes"}
        </button>
      </div>
      <p className="zui-status" role="status" aria-live="polite">
        {approve.isSuccess ? "Approved — marked done." : reject.isSuccess ? "Sent back to the manager." : ""}
      </p>
      <ErrorNote error={approve.error ?? reject.error} />
    </form>
  );
}
