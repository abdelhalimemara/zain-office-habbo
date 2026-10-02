import { useState } from "react";
import type { RosterEntry } from "@shared/api";
import type { BoardMeeting } from "@shared/meetings";
import { useBoard } from "../api/hooks";
import { useCancelMeeting } from "../api/meetingHooks";
import { ActionSummary } from "./ActionRow";
import { ActionReview } from "./ActionReview";
import { ErrorNote, Text } from "./common";
import { draftsFrom, findTask, seatLabel } from "./leadershipModel";
import { absoluteTime } from "./mandates";
import { Bubble } from "./MeetingRoom";
import { LiveRoom } from "./LiveRoom";

function Transcript({ meeting, agents }: { meeting: BoardMeeting; agents: readonly RosterEntry[] }) {
  const now = Date.now() / 1000;
  if (meeting.turns.length === 0) return <p className="zui-hint">No transcript.</p>;
  const turns = [...meeting.turns].sort((a, b) => a.at - b.at);
  return (
    <ol className="zui-turns" aria-label="Transcript">
      {turns.map((t, i) => (
        <Bubble key={`${t.speaker}-${t.at}-${i}`} turn={t} agents={agents} now={now} name={seatLabel(t.speaker, agents)} />
      ))}
    </ol>
  );
}

function Drafting({ meeting, agents }: { meeting: BoardMeeting; agents: readonly RosterEntry[] }) {
  return (
    <>
      <p className="zui-waiting zui-lead-drafting" role="status" aria-live="polite">
        <span className="zui-waiting__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        Susu is turning the meeting into tasks…
      </p>
      <h3 className="zui-subheading">Transcript</h3>
      <Transcript meeting={meeting} agents={agents} />
    </>
  );
}

function Assigned({ meeting, agents }: { meeting: BoardMeeting; agents: readonly RosterEntry[] }) {
  const board = useBoard();
  const rows = draftsFrom(meeting.outcome?.actions);
  const at = meeting.outcome?.assignedAt;
  return (
    <>
      <section className="zui-lead-summary" aria-label="This week's priorities">
        <h3 className="zui-subheading">This week's priorities</h3>
        {meeting.outcome?.priorities ? <Text>{meeting.outcome.priorities}</Text> : <p className="zui-hint">No priorities were written down.</p>}
      </section>
      <div className="zui-review__bar">
        <h3 className="zui-subheading">Actions</h3>
        {at && <span className="zui-hint">Assigned {absoluteTime(at)}</span>}
      </div>
      <ol className="zui-actions" aria-label="Actions">
        {rows.map((r) => (
          <ActionSummary key={r.key} row={r} agents={agents} task={findTask(board.data, r.taskId)} />
        ))}
      </ol>
      <details className="zui-instructions">
        <summary>Transcript</summary>
        <Transcript meeting={meeting} agents={agents} />
      </details>
    </>
  );
}

function CancelLeadership({ id }: { id: string }) {
  const cancel = useCancelMeeting();
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <button type="button" className="zui-btn zui-meeting__cancel" onClick={() => setConfirming(true)}>
        Cancel meeting
      </button>
    );
  return (
    <div className="zui-confirm" role="group" aria-label="Confirm cancel">
      <span>Cancel this meeting? No tasks will be created.</span>
      <button type="button" className="zui-btn zui-btn--danger" disabled={cancel.isPending} onClick={() => cancel.mutate(id)}>
        {cancel.isPending ? "Cancelling…" : "Cancel meeting"}
      </button>
      <button type="button" className="zui-btn" disabled={cancel.isPending} onClick={() => setConfirming(false)}>
        Keep meeting
      </button>
      <ErrorNote error={cancel.error} />
    </div>
  );
}

/** One leadership meeting through its lifecycle: live room → drafting → review → assigned. */
export function LeadershipRoom({ meeting, agents }: { meeting: BoardMeeting; agents: readonly RosterEntry[] }) {
  switch (meeting.status) {
    case "live":
      return (
        <>
          <LiveRoom meeting={meeting} agents={agents} />
          <CancelLeadership id={meeting.id} />
        </>
      );
    case "drafting":
      return (
        <>
          <Drafting meeting={meeting} agents={agents} />
          <CancelLeadership id={meeting.id} />
        </>
      );
    case "review":
      return (
        <>
          <ActionReview key={meeting.id} meeting={meeting} agents={agents} />
          <details className="zui-instructions">
            <summary>Transcript</summary>
            <Transcript meeting={meeting} agents={agents} />
          </details>
          <CancelLeadership id={meeting.id} />
        </>
      );
    case "assigned":
      return <Assigned meeting={meeting} agents={agents} />;
    default:
      return (
        <>
          <p className="zui-hint">This meeting was cancelled.</p>
          <details className="zui-instructions">
            <summary>Transcript</summary>
            <Transcript meeting={meeting} agents={agents} />
          </details>
        </>
      );
  }
}
