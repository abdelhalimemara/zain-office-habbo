import { useId, useState, type FormEvent } from "react";
import { LEADERSHIP_SEATS } from "@shared/leadership";
import { MEETING_BRIEF_MAX, MEETING_TOPIC_MAX } from "@shared/meetings";
import { useStartLeadership } from "../api/leadershipHooks";
import { useVoices } from "../api/voiceHooks";
import { useUiStore } from "../state/store";
import { ErrorNote, useRosterAgents } from "./common";
import { defaultTopic, LEADERSHIP_COLOR, SEAT_LABEL, SEAT_ROLE } from "./leadershipModel";
import { Dialog } from "./Panel";
import { Portrait } from "./Portrait";
import { VoicesOffNotice } from "./VoiceBits";

/** "Call a VP meeting": topic, an optional agenda, and who attends. Voice only; opens the room on success. */
export function StartLeadershipDialog() {
  const close = useUiStore((s) => s.setLeadershipDialogOpen);
  const openPanel = useUiStore((s) => s.openPanel);
  const { agents, loaded } = useRosterAgents();
  const voices = useVoices();
  const start = useStartLeadership();
  const seats = LEADERSHIP_SEATS.map((profile) => ({ profile, agent: agents.find((a) => a.profile === profile) }));
  const hired = seats.filter((s) => s.agent?.hired).map((s) => s.profile as string);
  const [topic, setTopic] = useState(() => defaultTopic());
  const [brief, setBrief] = useState("");
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [errors, setErrors] = useState<{ topic?: string; brief?: string; members?: string }>({});
  const ids = { topic: useId(), brief: useId(), briefHint: useId() };
  const members = chosen ?? hired;
  const onClose = () => close(false);

  const toggle = (p: string) => setChosen(members.includes(p) ? members.filter((m) => m !== p) : [...members, p]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (start.isPending) return;
    const t = topic.trim();
    const found = {
      ...(!t ? { topic: "Give the meeting a topic." } : t.length > MEETING_TOPIC_MAX ? { topic: `Keep the topic to ${MEETING_TOPIC_MAX} characters.` } : {}),
      ...(brief.length > MEETING_BRIEF_MAX ? { brief: `Keep the agenda to ${MEETING_BRIEF_MAX} characters.` } : {}),
      ...(members.length === 0 ? { members: "Invite at least one hired exec." } : {}),
    };
    setErrors(found);
    if (Object.keys(found).length) return;
    start.mutate(
      { topic: t, ...(brief.trim() ? { brief: brief.trim() } : {}), members: LEADERSHIP_SEATS.filter((p) => members.includes(p)) },
      {
        onSuccess: ({ meeting }) => {
          onClose();
          openPanel({ kind: "leadership", id: meeting.id });
        },
      },
    );
  };

  return (
    <Dialog title="Call a VP meeting" accent={LEADERSHIP_COLOR} onClose={onClose}>
      <form className="zui-form zui-lead-start" onSubmit={submit} noValidate aria-label="VP meeting details">
        <p className="zui-hint">A live voice room with your CEO agent, COO and VPs. It ends with tasks you review and assign, not a vote.</p>
        {voices.data && !voices.data.configured && <VoicesOffNotice detail="The meeting can still be called; the room opens once it is." />}
        <label className="zui-label" htmlFor={ids.topic}>
          Topic
        </label>
        <input id={ids.topic} className="zui-input" value={topic} onChange={(e) => setTopic(e.target.value)} aria-invalid={errors.topic ? true : undefined} />
        {errors.topic && <p className="zui-error">{errors.topic}</p>}
        <label className="zui-label" htmlFor={ids.brief}>
          Agenda or brief <span className="zui-hint">(optional)</span>
        </label>
        <textarea
          id={ids.brief}
          className="zui-input"
          rows={4}
          value={brief}
          placeholder={"1. Close the Riyadh anchor client\n2. Hiring plan for Growth"}
          onChange={(e) => setBrief(e.target.value)}
          aria-describedby={ids.briefHint}
          aria-invalid={errors.brief ? true : undefined}
        />
        <p id={ids.briefHint} className="zui-hint zui-convene__hint">
          Add numbered points to go item by item.
        </p>
        {errors.brief && <p className="zui-error">{errors.brief}</p>}
        <fieldset className="zui-fieldset">
          <legend className="zui-label">Attendees</legend>
          <ul className="zui-lead-seats">
            {seats.map(({ profile, agent }) => {
              const vacant = loaded && !agent?.hired;
              const on = members.includes(profile);
              return (
                <li key={profile}>
                  <label className={`zui-lead-seat${on ? " zui-lead-seat--on" : ""}${vacant ? " zui-lead-seat--vacant" : ""}`}>
                    <input type="checkbox" className="zui-sr-only" checked={on} disabled={!agent?.hired} onChange={() => toggle(profile)} />
                    <Portrait agent={agent} name={SEAT_LABEL[profile]} size="md" vacant={vacant} />
                    <span className="zui-lead-seat__role">{SEAT_LABEL[profile]}</span>
                    <span className="zui-lead-seat__name">{vacant ? "Not hired" : (agent?.name ?? SEAT_ROLE[profile])}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {errors.members && <p className="zui-error">{errors.members}</p>}
        </fieldset>
        <ErrorNote error={start.error} />
        <div className="zui-row">
          <button type="submit" className="zui-btn zui-btn--primary" disabled={start.isPending}>
            {start.isPending ? "Opening the room…" : "Start the meeting"}
          </button>
          <button type="button" className="zui-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
