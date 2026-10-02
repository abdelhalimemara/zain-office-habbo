import { useId, useState, type FormEvent } from "react";
import { useReject } from "../api/hooks";
import { CHANNEL_LABEL, useApproveClientReply, type ClientReplyDetails } from "./clientReply";
import { ErrorNote } from "./common";

export const FINAL_TEXT_MAX = 4000;
const NOTES_MAX = 2000;

interface Props {
  taskId: string;
  details: ClientReplyDetails;
  /** First name of the agent who drafted it, e.g. "Ahmad". */
  agentName: string;
}

export function ClientReplyActions({ taskId, details, agentName }: Props) {
  const approve = useApproveClientReply();
  const reject = useReject();
  const draft = details.draft ?? "";
  const [text, setText] = useState(draft);
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const replyId = useId();
  const notesId = useId();
  const errorId = useId();
  const pending = approve.isPending || reject.isPending;
  const edited = text !== draft;
  const client = details.client ?? "the client";
  const via = details.channel ? CHANNEL_LABEL[details.channel] : "their channel";

  const askToSend = () => {
    reject.reset();
    if (!text.trim()) return setError("The reply can't be empty.");
    setError(null);
    setConfirming(true);
  };

  const send = () => {
    approve.mutate({ id: taskId, finalText: edited ? text : undefined }, { onSettled: () => setConfirming(false) });
  };

  const sendBack = (e: FormEvent) => {
    e.preventDefault();
    const reason = notes.trim();
    approve.reset();
    setConfirming(false);
    if (!reason) return setError(`Write notes for ${agentName} to send this back.`);
    setError(null);
    reject.mutate({ id: taskId, reason });
  };

  return (
    <form className="zui-approval zui-client-actions" onSubmit={sendBack} noValidate>
      <label htmlFor={replyId} className="zui-label">
        Reply to send {edited && <span className="zui-hint">(edited)</span>}
      </label>
      <textarea
        id={replyId}
        className="zui-input zui-client-actions__reply"
        dir="auto"
        rows={5}
        maxLength={FINAL_TEXT_MAX}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setConfirming(false);
        }}
      />
      {confirming ? (
        <div className="zui-confirm" role="group" aria-label="Confirm send">
          <span>
            Send this to {client} via {via}?
          </span>
          <button type="button" className="zui-btn zui-btn--primary" onClick={send} disabled={pending}>
            {approve.isPending ? "Sending…" : "Confirm"}
          </button>
          <button type="button" className="zui-btn" onClick={() => setConfirming(false)} disabled={approve.isPending}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="zui-row">
          <button type="button" className="zui-btn zui-btn--primary" onClick={askToSend} disabled={pending}>
            Approve &amp; send
          </button>
        </div>
      )}
      <div className="zui-approval__close">
        <label htmlFor={notesId} className="zui-label">
          Notes for {agentName} <span className="zui-hint">(required to send back)</span>
        </label>
        <textarea
          id={notesId}
          className="zui-input"
          rows={2}
          maxLength={NOTES_MAX}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error && !notes.trim() ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        <button type="submit" className="zui-btn" disabled={pending}>
          {reject.isPending ? "Sending…" : `Send back to ${agentName}`}
        </button>
      </div>
      {error && (
        <p id={errorId} className="zui-error">
          {error}
        </p>
      )}
      <p className="zui-status" role="status" aria-live="polite">
        {approve.isSuccess ? `Approved — ${agentName} will send it to ${client}.` : reject.isSuccess ? `Sent back to ${agentName}.` : ""}
      </p>
      <ErrorNote error={approve.error ?? reject.error} />
    </form>
  );
}
