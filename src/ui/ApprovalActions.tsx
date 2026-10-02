import { useId, useState, type FormEvent } from "react";
import { useApprove, useReject } from "../api/hooks";
import { ErrorNote } from "./common";

interface Props {
  taskId: string;
  /** The VP's title when the task is a mandate: HQ's choice is then close vs. send back to them. */
  vpTitle?: string;
}

function useInstructions(required: string) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const errorId = useId();
  const field = {
    id: fieldId,
    className: "zui-input",
    rows: 2,
    maxLength: 2000,
    value: text,
    onChange: (e: { target: { value: string } }) => {
      setText(e.target.value);
      if (error) setError(null);
    },
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
  } as const;
  const require = (): string | null => {
    const value = text.trim();
    if (!value) setError(required);
    return value || null;
  };
  const errorNote = error && (
    <p id={errorId} className="zui-error">
      {error}
    </p>
  );
  return { text, field, fieldId, require, errorNote, clearError: () => setError(null) };
}

function MandateActions({ taskId, vpTitle }: Required<Props>) {
  const approve = useApprove();
  const reject = useReject();
  const [confirming, setConfirming] = useState(false);
  const notes = useInstructions(`Write instructions for ${vpTitle} to send this back.`);
  const helpId = useId();
  const pending = approve.isPending || reject.isPending;

  const sendBack = (e: FormEvent) => {
    e.preventDefault();
    const reason = notes.require();
    if (!reason) return;
    approve.reset();
    setConfirming(false);
    reject.mutate({ id: taskId, reason });
  };

  const close = () => {
    notes.clearError();
    reject.reset();
    approve.mutate({ id: taskId }, { onSettled: () => setConfirming(false) });
  };

  return (
    <form className="zui-approval" onSubmit={sendBack} noValidate>
      <label htmlFor={notes.fieldId} className="zui-label">
        Instructions for {vpTitle}
      </label>
      <textarea {...notes.field} />
      {notes.errorNote}
      <div className="zui-row">
        <button type="submit" className="zui-btn zui-btn--primary" disabled={pending}>
          {reject.isPending ? "Sending…" : "Send back to VP"}
        </button>
      </div>
      <div className="zui-approval__close">
        {confirming ? (
          <div className="zui-confirm" role="group" aria-label="Confirm close">
            <span>Close this mandate as done?</span>
            <button type="button" className="zui-btn zui-btn--danger" onClick={close} disabled={pending}>
              {approve.isPending ? "Closing…" : "Confirm"}
            </button>
            <button type="button" className="zui-btn" onClick={() => setConfirming(false)} disabled={approve.isPending}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="zui-btn" aria-describedby={helpId} onClick={() => setConfirming(true)} disabled={pending}>
            Approve &amp; close
          </button>
        )}
        <p id={helpId} className="zui-hint">
          Marks the mandate done. Agents stop working on it.
        </p>
      </div>
      <p className="zui-status" role="status" aria-live="polite">
        {approve.isSuccess ? "Closed — marked done." : reject.isSuccess ? `Sent back to ${vpTitle}.` : ""}
      </p>
      <ErrorNote error={approve.error ?? reject.error} />
    </form>
  );
}

function ReviewActions({ taskId }: { taskId: string }) {
  const approve = useApprove();
  const reject = useReject();
  const notes = useInstructions("A note is required to send this back.");
  const pending = approve.isPending || reject.isPending;

  const onApprove = () => {
    notes.clearError();
    reject.reset();
    approve.mutate({ id: taskId, note: notes.text.trim() || undefined });
  };

  const onSendBack = (e: FormEvent) => {
    e.preventDefault();
    const reason = notes.require();
    if (!reason) return;
    approve.reset();
    reject.mutate({ id: taskId, reason });
  };

  return (
    <form className="zui-approval" onSubmit={onSendBack} noValidate>
      <label htmlFor={notes.fieldId} className="zui-label">
        Note to assignee <span className="zui-hint">(required to send back)</span>
      </label>
      <textarea {...notes.field} />
      {notes.errorNote}
      <div className="zui-row">
        <button type="button" className="zui-btn zui-btn--primary" onClick={onApprove} disabled={pending}>
          {approve.isPending ? "Approving…" : "Approve"}
        </button>
        <button type="submit" className="zui-btn" disabled={pending}>
          {reject.isPending ? "Sending…" : "Send back"}
        </button>
      </div>
      <p className="zui-status" role="status" aria-live="polite">
        {approve.isSuccess ? "Approved — marked done." : reject.isSuccess ? "Sent back to the assignee." : ""}
      </p>
      <ErrorNote error={approve.error ?? reject.error} />
    </form>
  );
}

export function ApprovalActions({ taskId, vpTitle }: Props) {
  return vpTitle ? <MandateActions taskId={taskId} vpTitle={vpTitle} /> : <ReviewActions taskId={taskId} />;
}
