import { useId, useState, type FormEvent } from "react";
import { siNotion } from "simple-icons";
import type { RosterEntry } from "@shared/api";
import { findBoardMember } from "@shared/board";
import { MAX_DISCUSSION_ROUNDS, MEETING_BRIEF_MAX, MEETING_TOPIC_MAX, type BoardMeeting } from "@shared/meetings";
import { isMeetingActive, useMeetings, useStartMeeting } from "../api/meetingHooks";
import { useUiStore } from "../state/store";
import { ErrorNote } from "./common";
import { absoluteTime, relativeTime } from "./mandates";
import { DECISION_LABEL, phaseLabel, STATUS_LABEL } from "./meetingModel";
import { Portrait } from "./Portrait";

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
  return (
    <li className={`zui-meeting-item${meeting.status === "awaiting-founder" ? " zui-meeting-item--yours" : ""}`}>
      <button type="button" className="zui-meeting-item__open" onClick={() => openPanel({ kind: "meeting", id: meeting.id })}>
        <span className="zui-meeting-item__top">
          <MeetingStatusChip meeting={meeting} />
          {isMeetingActive(meeting) && <span className="zui-meeting-item__phase">{phaseLabel(meeting)}</span>}
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
        </span>
      </button>
      {meeting.notionPageUrl && <NotionLink url={meeting.notionPageUrl} />}
    </li>
  );
}

function ConveneForm({ advisors, onDone }: { advisors: readonly RosterEntry[]; onDone: () => void }) {
  const start = useStartMeeting();
  const openPanel = useUiStore((s) => s.openPanel);
  const hired = advisors.filter((a) => a.hired).map((a) => a.profile);
  const [topic, setTopic] = useState("");
  const [brief, setBrief] = useState("");
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [boardOnly, setBoardOnly] = useState(false);
  const [rounds, setRounds] = useState(1);
  const [errors, setErrors] = useState<{ topic?: string; brief?: string; members?: string }>({});
  const ids = { topic: useId(), brief: useId(), rounds: useId() };
  const members = chosen ?? hired;

  const toggle = (p: string) => setChosen(members.includes(p) ? members.filter((m) => m !== p) : [...members, p]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = topic.trim();
    const found = {
      ...(!t ? { topic: "Give the meeting a topic." } : t.length > MEETING_TOPIC_MAX ? { topic: `Keep the topic to ${MEETING_TOPIC_MAX} characters.` } : {}),
      ...(brief.length > MEETING_BRIEF_MAX ? { brief: `Keep the brief to ${MEETING_BRIEF_MAX} characters.` } : {}),
      ...(members.length === 0 ? { members: "Invite at least one hired advisor." } : {}),
    };
    setErrors(found);
    if (Object.keys(found).length) return;
    start.mutate(
      { topic: t, brief: brief.trim(), members, boardOnly, discussionRounds: rounds },
      {
        onSuccess: ({ meeting }) => {
          onDone();
          openPanel({ kind: "meeting", id: meeting.id });
        },
      },
    );
  };

  return (
    <form className="zui-form zui-convene" onSubmit={submit} noValidate aria-label="Convene the board">
      <label className="zui-label" htmlFor={ids.topic}>
        Topic <span className="zui-hint">({topic.trim().length}/{MEETING_TOPIC_MAX})</span>
      </label>
      <input id={ids.topic} className="zui-input" value={topic} onChange={(e) => setTopic(e.target.value)} aria-invalid={errors.topic ? true : undefined} />
      {errors.topic && <p className="zui-error">{errors.topic}</p>}
      <label className="zui-label" htmlFor={ids.brief}>
        Brief <span className="zui-hint">(context, numbers, the decision you need)</span>
      </label>
      <textarea id={ids.brief} className="zui-input" rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} aria-invalid={errors.brief ? true : undefined} />
      {errors.brief && <p className="zui-error">{errors.brief}</p>}
      <fieldset className="zui-fieldset">
        <legend className="zui-label">Members</legend>
        {advisors.map((a) => (
          <label key={a.profile} className="zui-check">
            <input type="checkbox" checked={members.includes(a.profile)} disabled={!a.hired} onChange={() => toggle(a.profile)} />
            {findBoardMember(a.profile)?.name ?? a.title}
            {!a.hired && <span className="zui-hint"> (vacant)</span>}
          </label>
        ))}
        {errors.members && <p className="zui-error">{errors.members}</p>}
      </fieldset>
      <label className="zui-check">
        <input type="checkbox" checked={boardOnly} onChange={(e) => setBoardOnly(e.target.checked)} />
        Board discusses on its own <span className="zui-hint">(no pauses for your remarks)</span>
      </label>
      <label className="zui-label" htmlFor={ids.rounds}>
        Discussion rounds
      </label>
      <select id={ids.rounds} className="zui-input" value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>
        {Array.from({ length: MAX_DISCUSSION_ROUNDS }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <ErrorNote error={start.error} />
      <div className="zui-row">
        <button type="submit" className="zui-btn zui-btn--primary" disabled={start.isPending}>
          {start.isPending ? "Convening…" : "Convene"}
        </button>
        <button type="button" className="zui-btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function MeetingsTab({ advisors, agents }: { advisors: readonly RosterEntry[]; agents: readonly RosterEntry[] }) {
  const { data, error, isPending } = useMeetings();
  const [convening, setConvening] = useState(false);
  const meetings = [...(data?.meetings ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="zui-meetings">
      {convening ? (
        <ConveneForm advisors={advisors} onDone={() => setConvening(false)} />
      ) : (
        <button type="button" className="zui-btn zui-btn--primary zui-meetings__convene" onClick={() => setConvening(true)} disabled={!advisors.some((a) => a.hired)}>
          Convene the board
        </button>
      )}
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
