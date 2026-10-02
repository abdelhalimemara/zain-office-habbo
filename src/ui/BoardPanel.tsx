import { useId, useState, type FormEvent } from "react";
import type { RosterEntry } from "@shared/api";
import { findBoardMember } from "@shared/board";
import { agentActivity, boardConsultations } from "@shared/flow";
import type { KanbanTask } from "@shared/hermes";
import { useBoard, useBoardConsult } from "../api/hooks";
import { useUiStore } from "../state/store";
import { ActivityBadge, AgentChip, ErrorNote, Text, useRosterAgents } from "./common";
import { MeetingsTab } from "./MeetingsTab";
import { Portrait } from "./Portrait";
import { Panel } from "./Panel";
import { VoiceSettings } from "./VoiceSettings";

export const QUESTION_MAX = 8000;
const BOARD_COLOR = "#C9A227";
const RECENT = 10;
const TITLE_PREFIX = "Board consultation: ";

function MemberCard({ agent, loaded }: { agent: RosterEntry; loaded: boolean }) {
  const board = useBoard();
  const openPanel = useUiStore((s) => s.openPanel);
  const member = findBoardMember(agent.profile);
  const activity = board.data && agent.hired ? agentActivity(agent.profile, board.data).activity : null;
  return (
    <li className="zui-board-member">
      <Portrait agent={agent} name={member?.name ?? agent.title} color={BOARD_COLOR} size="lg" vacant={loaded && !agent.hired} />
      <div className="zui-profile__text">
        <button type="button" className="zui-link" onClick={() => openPanel({ kind: "agent", profile: agent.profile })}>
          {member?.name ?? agent.title}
        </button>
        {member && <p className="zui-hint">{member.seat}</p>}
      </div>
      <div className="zui-board-member__status">
        {loaded && (
          <span className={`zui-badge ${agent.hired ? "zui-badge--hired" : "zui-badge--vacant"}`}>{agent.hired ? "Hired" : "Vacant"}</span>
        )}
        {activity && <ActivityBadge activity={activity} />}
      </div>
    </li>
  );
}

function ConsultForm({ advisors, preselect }: { advisors: RosterEntry[]; preselect?: string[] }) {
  const consult = useBoardConsult();
  const [question, setQuestion] = useState("");
  const [related, setRelated] = useState("");
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const questionId = useId();
  const relatedId = useId();
  const hired = advisors.filter((a) => a.hired).map((a) => a.profile);
  const selected = chosen ?? (preselect ? preselect.filter((p) => hired.includes(p)) : hired);

  const toggle = (profile: string) =>
    setChosen(selected.includes(profile) ? selected.filter((p) => p !== profile) : [...selected, profile]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = question.trim();
    if (!text) return setError("Write a question for the board.");
    if (selected.length === 0) return setError("Pick at least one hired advisor.");
    setError(null);
    const relatedTaskId = related.trim();
    consult.mutate(
      { question: text, members: selected, ...(relatedTaskId ? { relatedTaskId } : {}) },
      { onSuccess: () => setQuestion("") },
    );
  };

  if (hired.length === 0) return <p className="zui-hint">No board member is hired yet. Hire one to consult the board.</p>;

  return (
    <form className="zui-form" onSubmit={submit} noValidate>
      <label htmlFor={questionId} className="zui-label">
        Question
      </label>
      <textarea
        id={questionId}
        className="zui-input"
        rows={4}
        maxLength={QUESTION_MAX}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        aria-invalid={error && !question.trim() ? true : undefined}
      />
      <fieldset className="zui-fieldset">
        <legend className="zui-label">Ask</legend>
        {advisors.map((a) => (
          <label key={a.profile} className="zui-check">
            <input type="checkbox" checked={selected.includes(a.profile)} disabled={!a.hired} onChange={() => toggle(a.profile)} />{" "}
            {findBoardMember(a.profile)?.name ?? a.title}
          </label>
        ))}
      </fieldset>
      <label htmlFor={relatedId} className="zui-label">
        Related task <span className="zui-hint">(optional id)</span>
      </label>
      <input id={relatedId} className="zui-input zui-mono" value={related} onChange={(e) => setRelated(e.target.value)} spellCheck={false} />
      {error && <p className="zui-error">{error}</p>}
      <button type="submit" className="zui-btn zui-btn--primary" disabled={consult.isPending}>
        {consult.isPending ? "Sending…" : "Consult the board"}
      </button>
      <p className="zui-status" role="status" aria-live="polite">
        {consult.data
          ? `Sent to ${consult.data.tasks.length} advisor${consult.data.tasks.length === 1 ? "" : "s"}.` +
            (consult.data.telegramSubscribed ? " The CEO will relay the advice on Telegram." : "")
          : ""}
      </p>
      <ErrorNote error={consult.error} />
    </form>
  );
}

function Consultation({ task, agents }: { task: KanbanTask; agents: readonly RosterEntry[] }) {
  const openPanel = useUiStore((s) => s.openPanel);
  const preview = task.result ?? task.latest_summary;
  return (
    <li className="zui-approval-item">
      <button type="button" className="zui-link" onClick={() => openPanel({ kind: "task", id: task.id })}>
        {task.title.startsWith(TITLE_PREFIX) ? task.title.slice(TITLE_PREFIX.length) : task.title}
      </button>
      <div className="zui-card__meta">
        <AgentChip profile={task.assignee} agents={agents} />
        <span className={`zui-status-pill zui-status-pill--${task.status}`}>{task.status}</span>
      </div>
      {preview && <Text className="zui-text--preview">{preview}</Text>}
    </li>
  );
}

export function BoardPanel({ members: preselect, tab: initialTab }: { members?: string[]; tab?: "meetings" | "consult" }) {
  const { agents, loaded } = useRosterAgents();
  const board = useBoard();
  const closePanel = useUiStore((s) => s.closePanel);
  const advisors = agents.filter((a) => a.rank === "board");
  const recent = board.data ? boardConsultations(board.data, agents).slice(0, RECENT) : [];
  const [tab, setTab] = useState<"meetings" | "consult">(initialTab ?? (preselect ? "consult" : "meetings"));
  const tabId = useId();

  return (
    <Panel title="Board of advisors" accent={BOARD_COLOR} onClose={closePanel}>
      <p className="zui-hint">AI advisors modelled on public figures' published thinking. They advise the CEO and founder; they don't run work.</p>
      <div role="tablist" aria-label="Board" className="zui-segmented">
        {(["meetings", "consult"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`${tabId}-${t}`}
            aria-selected={tab === t}
            aria-controls={`${tabId}-panel`}
            className="zui-segmented__tab"
            onClick={() => setTab(t)}
          >
            {t === "meetings" ? "Meetings" : "Consult"}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${tab}`} className="zui-board-tab">
        {tab === "meetings" ? (
          <MeetingsTab advisors={advisors} agents={agents} />
        ) : (
          <>
            <ul className="zui-board-members" aria-label="Board members">
              {advisors.map((a) => (
                <MemberCard key={a.profile} agent={a} loaded={loaded} />
              ))}
            </ul>
            <h3 className="zui-subheading">Consult the board</h3>
            <ConsultForm advisors={advisors} preselect={preselect} />
            <h3 className="zui-subheading">Recent consultations</h3>
            <ErrorNote error={board.error} />
            {board.data && recent.length === 0 && <p className="zui-hint">No consultations yet.</p>}
            <ul className="zui-consultations" aria-label="Recent consultations">
              {recent.map((t) => (
                <Consultation key={t.id} task={t} agents={agents} />
              ))}
            </ul>
            <h3 className="zui-subheading">Voices</h3>
            <VoiceSettings advisors={advisors} agents={agents} />
          </>
        )}
      </div>
    </Panel>
  );
}
