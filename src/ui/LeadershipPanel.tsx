import type { RosterEntry } from "@shared/api";
import { LEADERSHIP_SEATS } from "@shared/leadership";
import type { BoardMeeting } from "@shared/meetings";
import { useMeeting, useMeetings } from "../api/meetingHooks";
import { useUiStore } from "../state/store";
import { ErrorNote, Text, useRosterAgents } from "./common";
import { LEADERSHIP_COLOR, meetingsOfKind, seatLabel } from "./leadershipModel";
import { LeadershipRoom } from "./LeadershipRoom";
import { absoluteTime, relativeTime } from "./mandates";
import { MeetingStatusChip } from "./MeetingsTab";
import { Panel } from "./Panel";
import { Portrait } from "./Portrait";
import { VoiceSettings } from "./VoiceSettings";

function actionCount(m: BoardMeeting): string | null {
  const n = m.outcome?.actions.filter((a) => a.status !== "dropped").length ?? 0;
  if (m.status !== "review" && m.status !== "assigned") return null;
  return `${n} ${n === 1 ? "action" : "actions"}`;
}

function LeadershipItem({ meeting, agents }: { meeting: BoardMeeting; agents: readonly RosterEntry[] }) {
  const openPanel = useUiStore((s) => s.openPanel);
  const now = Date.now() / 1000;
  const live = meeting.status === "live";
  const yours = meeting.status === "review";
  const count = actionCount(meeting);
  return (
    <li className={`zui-meeting-item${yours ? " zui-meeting-item--yours" : ""}${live ? " zui-meeting-item--live" : ""}`}>
      <button
        type="button"
        className="zui-meeting-item__open"
        aria-label={live ? `Join ${meeting.topic}` : undefined}
        onClick={() => openPanel({ kind: "leadership", id: meeting.id })}
      >
        <span className="zui-meeting-item__top">
          <MeetingStatusChip meeting={meeting} />
          {count && <span className="zui-meeting-item__phase">{count}</span>}
          <span className="zui-meeting-item__time" title={absoluteTime(meeting.updatedAt)}>
            {relativeTime(meeting.updatedAt, now)}
          </span>
        </span>
        <span className="zui-meeting-item__topic">{meeting.topic}</span>
        <span className="zui-meeting-item__bottom">
          <span className="zui-meeting-item__faces">
            {meeting.members.map((m) => (
              <Portrait key={m} agent={agents.find((a) => a.profile === m)} name={seatLabel(m, agents)} labelled={false} />
            ))}
          </span>
          {live && (
            <span className="zui-meeting-item__join" aria-hidden="true">
              Join
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function LeadershipList({ agents }: { agents: readonly RosterEntry[] }) {
  const { data, error, isPending } = useMeetings();
  const openDialog = useUiStore((s) => s.setLeadershipDialogOpen);
  const meetings = meetingsOfKind(data?.meetings, "leadership");
  const anyHired = LEADERSHIP_SEATS.some((p) => agents.find((a) => a.profile === p)?.hired);
  return (
    <div className="zui-meetings">
      <p className="zui-hint">Meet Susu, your COO and VPs by voice to set the week's priorities. The meeting ends with tasks you assign to the divisions.</p>
      <button type="button" className="zui-btn zui-btn--primary zui-meetings__convene" onClick={() => openDialog(true)} disabled={!anyHired} aria-haspopup="dialog">
        Start a VP meeting
      </button>
      <ErrorNote error={error} />
      {isPending && <p className="zui-hint">Loading meetings…</p>}
      {data && meetings.length === 0 && <p className="zui-hint">No VP meetings yet.</p>}
      <ul className="zui-meeting-list" aria-label="VP meetings">
        {meetings.map((m) => (
          <LeadershipItem key={m.id} meeting={m} agents={agents} />
        ))}
      </ul>
      <details className="zui-instructions">
        <summary>Exec voices</summary>
        <VoiceSettings agents={agents} groups={["leadership"]} />
      </details>
    </div>
  );
}

function MeetingView({ id, agents }: { id: string; agents: readonly RosterEntry[] }) {
  const { data, error, isPending } = useMeeting(id);
  const openPanel = useUiStore((s) => s.openPanel);
  const closePanel = useUiStore((s) => s.closePanel);
  const meeting = data?.meeting;
  return (
    <Panel title={meeting?.topic ?? "VP meeting"} accent={LEADERSHIP_COLOR} onClose={closePanel} className="zui-panel--meeting">
      <div className="zui-meeting__bar">
        <button type="button" className="zui-link" onClick={() => openPanel({ kind: "leadership" })}>
          ‹ All VP meetings
        </button>
        {meeting && <MeetingStatusChip meeting={meeting} />}
      </div>
      <ErrorNote error={error} />
      {isPending && <p className="zui-hint">Loading meeting…</p>}
      {meeting && (
        <>
          {meeting.brief && (
            <details className="zui-instructions">
              <summary>Agenda</summary>
              <Text>{meeting.brief}</Text>
            </details>
          )}
          <LeadershipRoom meeting={meeting} agents={agents} />
        </>
      )}
    </Panel>
  );
}

/** The VP room: leadership meetings, or one of them when `id` is set. */
export function LeadershipPanel({ id }: { id?: string }) {
  const { agents } = useRosterAgents();
  const closePanel = useUiStore((s) => s.closePanel);
  if (id) return <MeetingView id={id} agents={agents} />;
  return (
    <Panel title="Leadership" accent={LEADERSHIP_COLOR} onClose={closePanel} className="zui-panel--meeting">
      <LeadershipList agents={agents} />
    </Panel>
  );
}
