import { siNotion } from "simple-icons";
import type { RosterEntry } from "@shared/api";
import { findBoardMember } from "@shared/board";
import type { BoardMeeting } from "@shared/meetings";
import { isMeetingActive, useMeetings } from "../api/meetingHooks";
import { useUiStore } from "../state/store";
import { ErrorNote } from "./common";
import { absoluteTime, relativeTime } from "./mandates";
import { meetingsOfKind } from "./leadershipModel";
import { DECISION_LABEL, phaseLabel, STATUS_LABEL } from "./meetingModel";
import { Portrait } from "./Portrait";
import { VoiceModeBadge } from "./VoiceBits";

export function MeetingStatusChip({ meeting }: { meeting: Pick<BoardMeeting, "status"> }) {
  return <span className={`zui-meeting-status zui-meeting-status--${meeting.status}`}>{STATUS_LABEL[meeting.status]}</span>;
}

export function DecisionChip({ decision }: { decision: NonNullable<BoardMeeting["decision"]> }) {
  return <span className={`zui-decision zui-decision--${decision}`}>{DECISION_LABEL[decision]}</span>;
}

export function NotionLink({ url }: { url: string }) {
  return (
    <a className="zui-notion-link" href={url} target="_blank" rel="noreferrer noopener" aria-label="Open the minutes in Notion" title="Open in Notion">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path fill="currentColor" d={siNotion.path} />
      </svg>
    </a>
  );
}

function MeetingItem({ meeting, agents }: { meeting: BoardMeeting; agents: readonly RosterEntry[] }) {
  const openPanel = useUiStore((s) => s.openPanel);
  const now = Date.now() / 1000;
  const live = meeting.status === "live";
  const yours = meeting.status === "awaiting-founder";
  return (
    <li className={`zui-meeting-item${yours ? " zui-meeting-item--yours" : ""}${live ? " zui-meeting-item--live" : ""}`}>
      <button
        type="button"
        className="zui-meeting-item__open"
        aria-label={live ? `Join ${meeting.topic}` : undefined}
        onClick={() => openPanel({ kind: "meeting", id: meeting.id })}
      >
        <span className="zui-meeting-item__top">
          <MeetingStatusChip meeting={meeting} />
          {meeting.mode === "voice" && <VoiceModeBadge />}
          {isMeetingActive(meeting) && !live && <span className="zui-meeting-item__phase">{phaseLabel(meeting)}</span>}
          <span className="zui-meeting-item__time" title={absoluteTime(meeting.updatedAt)}>
            {relativeTime(meeting.updatedAt, now)}
          </span>
        </span>
        <span className="zui-meeting-item__topic">{meeting.topic}</span>
        <span className="zui-meeting-item__bottom">
          <span className="zui-meeting-item__faces">
            {meeting.members.map((m) => {
              const agent = agents.find((a) => a.profile === m);
              return <Portrait key={m} agent={agent} name={findBoardMember(m)?.name ?? agent?.title ?? m} labelled={false} />;
            })}
          </span>
          {meeting.decision && <DecisionChip decision={meeting.decision} />}
          {live && (
            <span className="zui-meeting-item__join" aria-hidden="true">
              Join
            </span>
          )}
        </span>
      </button>
      {meeting.notionPageUrl && <NotionLink url={meeting.notionPageUrl} />}
    </li>
  );
}

export function MeetingsTab({ advisors, agents }: { advisors: readonly RosterEntry[]; agents: readonly RosterEntry[] }) {
  const { data, error, isPending } = useMeetings();
  const openCallMeeting = useUiStore((s) => s.setCallMeetingOpen);
  const meetings = meetingsOfKind(data?.meetings, "board");
  return (
    <div className="zui-meetings">
      <button type="button" className="zui-btn zui-btn--primary zui-meetings__convene" onClick={() => openCallMeeting(true)} disabled={!advisors.some((a) => a.hired)}>
        Call a meeting
      </button>
      <ErrorNote error={error} />
      {isPending && <p className="zui-hint">Loading meetings…</p>}
      {data && meetings.length === 0 && <p className="zui-hint">No board meetings yet.</p>}
      <ul className="zui-meeting-list" aria-label="Board meetings">
        {meetings.map((m) => (
          <MeetingItem key={m.id} meeting={m} agents={agents} />
        ))}
      </ul>
    </div>
  );
}
