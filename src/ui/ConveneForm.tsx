import { useId, useState, type FormEvent } from "react";
import type { RosterEntry } from "@shared/api";
import { findBoardMember } from "@shared/board";
import { MAX_DISCUSSION_ROUNDS, MEETING_BRIEF_MAX, MEETING_TOPIC_MAX, type BoardMeeting, type MeetingMode } from "@shared/meetings";
import { useStartMeeting } from "../api/meetingHooks";
import { useVoices } from "../api/voiceHooks";
import { ErrorNote } from "./common";
import { VoiceTag, VoicesOffNotice } from "./VoiceBits";
import { voiceStatus } from "./voiceModel";

interface Props {
  advisors: readonly RosterEntry[];
  mode: MeetingMode;
  onStarted: (meeting: BoardMeeting) => void;
  onCancel: () => void;
  cancelLabel?: string;
}

export function ConveneForm({ advisors, mode, onStarted, onCancel, cancelLabel = "Cancel" }: Props) {
  const start = useStartMeeting();
  const voices = useVoices();
  const voice = mode === "voice";
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
    const input = voice ? { topic: t, brief: brief.trim(), members, mode } : { topic: t, brief: brief.trim(), members, boardOnly, mode, discussionRounds: rounds };
    start.mutate(input, { onSuccess: ({ meeting }) => onStarted(meeting) });
  };

  return (
    <form className="zui-form zui-convene" onSubmit={submit} noValidate aria-label={voice ? "Voice meeting details" : "Chat meeting details"}>
      {voice && voices.data && !voices.data.configured && <VoicesOffNotice />}
      <label className="zui-label" htmlFor={ids.topic}>
        Topic <span className="zui-hint">({topic.trim().length}/{MEETING_TOPIC_MAX})</span>
      </label>
      <input id={ids.topic} className="zui-input" value={topic} autoFocus onChange={(e) => setTopic(e.target.value)} aria-invalid={errors.topic ? true : undefined} />
      {errors.topic && <p className="zui-error">{errors.topic}</p>}
      <label className="zui-label" htmlFor={ids.brief}>
        Brief <span className="zui-hint">(context, numbers, the decision you need)</span>
      </label>
      <textarea id={ids.brief} className="zui-input" rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} aria-invalid={errors.brief ? true : undefined} />
      {voice && <p className="zui-hint zui-convene__hint">Add an agenda (numbered points) if you want them to go item by item.</p>}
      {errors.brief && <p className="zui-error">{errors.brief}</p>}
      <fieldset className="zui-fieldset">
        <legend className="zui-label">Members</legend>
        {advisors.map((a) => (
          <label key={a.profile} className="zui-check zui-convene__member">
            <input type="checkbox" checked={members.includes(a.profile)} disabled={!a.hired} onChange={() => toggle(a.profile)} />
            {findBoardMember(a.profile)?.name ?? a.title}
            {!a.hired && <span className="zui-hint"> (vacant)</span>}
            {voice && a.hired && members.includes(a.profile) && <VoiceTag status={voiceStatus(a.profile, voices.data)} />}
          </label>
        ))}
        {errors.members && <p className="zui-error">{errors.members}</p>}
      </fieldset>
      {!voice && (
        <>
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
        </>
      )}
      <ErrorNote error={start.error} />
      <div className="zui-row">
        <button type="submit" className="zui-btn zui-btn--primary" disabled={start.isPending}>
          {start.isPending ? "Convening…" : "Convene"}
        </button>
        <button type="button" className="zui-btn" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </form>
  );
}
