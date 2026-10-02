import { useId, useState } from "react";
import type { RosterEntry } from "@shared/api";
import { FOUNDER_REMARK_MAX, MAX_DISCUSSION_ROUNDS, type BoardMeeting, type FounderRemarkRequest, type MeetingTurn } from "@shared/meetings";
import { isMeetingActive, useCancelMeeting, useFounderRemark, useMeeting } from "../api/meetingHooks";
import { useUiStore } from "../state/store";
import { ErrorNote, Text, useRosterAgents } from "./common";
import { absoluteTime, relativeTime } from "./mandates";
import { FOUNDER, groupTurns, isMinutes, shortName, speakerName, tallyVotes, VOTES, waitingFor } from "./meetingModel";
import { DecisionChip, MeetingStatusChip, NotionLink } from "./MeetingsTab";
import { Panel } from "./Panel";
import { Portrait } from "./Portrait";

const BOARD_COLOR = "#C9A227";

function Bubble({ turn, agents, now }: { turn: MeetingTurn; agents: readonly RosterEntry[]; now: number }) {
  const founder = turn.speaker === FOUNDER;
  const agent = agents.find((a) => a.profile === turn.speaker);
  const name = speakerName(turn.speaker, agents);
  return (
    <li className={`zui-turn${founder ? " zui-turn--founder" : ""}`}>
      {!founder && <Portrait agent={agent} name={name} size="md" />}
      <div className="zui-turn__bubble">
        <div className="zui-turn__head">
          <span className="zui-turn__name">{name}</span>
          <time className="zui-turn__time" dateTime={new Date(turn.at * 1000).toISOString()} title={absoluteTime(turn.at)}>
            {relativeTime(turn.at, now)}
          </time>
        </div>
        <p className="zui-turn__text" dir="auto">
          {turn.text}
        </p>
      </div>
    </li>
  );
}

function Minutes({ turns }: { turns: MeetingTurn[] }) {
  return (
    <section className="zui-minutes" aria-label="Minutes">
      <h4 className="zui-minutes__title">Minutes · by the chair</h4>
      {turns.map((t, i) => (
        <p key={i} className="zui-turn__text" dir="auto">
          {t.text}
        </p>
      ))}
    </section>
  );
}

function Votes({ meeting, agents }: { meeting: BoardMeeting; agents: readonly RosterEntry[] }) {
  if (meeting.votes.length === 0) return null;
  const tally = tallyVotes(meeting.votes);
  const label = (v: string) => VOTES.find((x) => x.vote === v)?.label ?? v;
  return (
    <section className="zui-votes" aria-label="Votes">
      <div className="zui-tally" role="img" aria-label={tally.map((t) => `${t.label} ${t.count}`).join(", ")}>
        {tally
          .filter((t) => t.count > 0)
          .map((t) => (
            <span key={t.vote} className={`zui-tally__seg zui-tally__seg--${t.vote}`} style={{ width: `${t.percent}%` }} />
          ))}
      </div>
      <ul className="zui-tally__legend">
        {tally.map((t) => (
          <li key={t.vote} className={`zui-tally__key zui-tally__key--${t.vote}`}>
            {t.label} <strong>{t.count}</strong>
          </li>
        ))}
      </ul>
      <ul className="zui-vote-list" aria-label="Votes by member">
        {meeting.votes.map((v) => {
          const agent = agents.find((a) => a.profile === v.member);
          const name = speakerName(v.member, agents);
          return (
            <li key={v.member} className="zui-vote">
              <Portrait agent={agent} name={name} />
              <div className="zui-vote__text">
                <div className="zui-vote__head">
                  <span className="zui-turn__name">{name}</span>
                  <span className={`zui-vote__chip zui-tally__key--${v.vote}`}>{label(v.vote)}</span>
                </div>
                <p className="zui-vote__why" dir="auto">
                  {v.rationale}
                </p>
                {v.conditions && (
                  <p className="zui-vote__why" dir="auto">
                    <span className="zui-hint">Conditions: </span>
                    {v.conditions}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Composer({ meeting }: { meeting: BoardMeeting }) {
  const remark = useFounderRemark();
  const [text, setText] = useState("");
  const id = useId();
  const send = (next: NonNullable<FounderRemarkRequest["next"]>) =>
    remark.mutate({ id: meeting.id, text: text.trim(), next }, { onSuccess: () => setText("") });
  const canExtend = meeting.discussionRounds < MAX_DISCUSSION_ROUNDS;
  return (
    <section className="zui-composer" aria-label="Your remarks">
      <label htmlFor={id} className="zui-label">
        Your remarks to the board <span className="zui-hint">(optional)</span>
      </label>
      <textarea id={id} className="zui-input" rows={3} maxLength={FOUNDER_REMARK_MAX} dir="auto" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="zui-row">
        <button type="button" className="zui-btn zui-btn--primary" disabled={remark.isPending} onClick={() => send("continue")}>
          Continue
        </button>
        <button type="button" className="zui-btn" disabled={remark.isPending || !canExtend} onClick={() => send("extra-round")} title={canExtend ? undefined : `At most ${MAX_DISCUSSION_ROUNDS} discussion rounds`}>
          Add another round
        </button>
        <button type="button" className="zui-btn" disabled={remark.isPending} onClick={() => send("to-vote")}>
          Go to vote
        </button>
      </div>
      <p className="zui-status" role="status" aria-live="polite">
        {remark.isPending ? "Sending…" : remark.isSuccess ? "Sent — the board is back in session." : ""}
      </p>
      <ErrorNote error={remark.error} />
    </section>
  );
}

function CancelMeeting({ id }: { id: string }) {
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
      <span>Cancel this meeting? The board stops discussing.</span>
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

function Transcript({ meeting, agents }: { meeting: BoardMeeting; agents: readonly RosterEntry[] }) {
  const now = Date.now() / 1000;
  const waiting = waitingFor(meeting);
  return (
    <div className="zui-transcript">
      {groupTurns(meeting).map((g) =>
        g.key === "minutes" ? (
          <Minutes key={g.key} turns={g.turns} />
        ) : (
          <section key={g.key} className="zui-round" aria-label={g.label}>
            <h4 className="zui-round__title">{g.label}</h4>
            <ol className="zui-turns">
              {g.turns.map((t, i) => (
                <Bubble key={`${t.speaker}-${t.at}-${i}`} turn={t} agents={agents} now={now} />
              ))}
            </ol>
          </section>
        ),
      )}
      {meeting.status === "voting" || meeting.votes.length > 0 ? <Votes meeting={meeting} agents={agents} /> : null}
      {waiting.length > 0 && (
        <p className="zui-waiting" role="status" aria-live="polite">
          <span className="zui-waiting__dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          Waiting for {waiting.map((p) => shortName(p, agents)).join(", ")}…
        </p>
      )}
    </div>
  );
}

export function MeetingRoom({ id }: { id: string }) {
  const { data, error, isPending } = useMeeting(id);
  const { agents } = useRosterAgents();
  const openPanel = useUiStore((s) => s.openPanel);
  const closePanel = useUiStore((s) => s.closePanel);
  const meeting = data?.meeting;
  const hasMinutes = meeting?.turns.some(isMinutes) ?? false;

  return (
    <Panel title={meeting?.topic ?? "Board meeting"} accent={BOARD_COLOR} onClose={closePanel} className="zui-panel--meeting">
      <div className="zui-meeting__bar">
        <button type="button" className="zui-link" onClick={() => openPanel({ kind: "board", tab: "meetings" })}>
          ‹ All meetings
        </button>
        {meeting && <MeetingStatusChip meeting={meeting} />}
        {meeting?.decision && <DecisionChip decision={meeting.decision} />}
        {meeting?.notionPageUrl && <NotionLink url={meeting.notionPageUrl} />}
      </div>
      {meeting?.notionSyncError && (
        <p className="zui-hint zui-meeting__sync" role="status">
          Notion sync failed: {meeting.notionSyncError}
        </p>
      )}
      <ErrorNote error={error} />
      {isPending && <p className="zui-hint">Loading meeting…</p>}
      {meeting && (
        <>
          {meeting.brief && (
            <details className="zui-instructions">
              <summary>Brief</summary>
              <Text>{meeting.brief}</Text>
            </details>
          )}
          <Transcript meeting={meeting} agents={agents} />
          {meeting.status === "concluded" && meeting.conclusion && !hasMinutes && (
            <section className="zui-minutes" aria-label="Conclusion">
              <h4 className="zui-minutes__title">Conclusion</h4>
              <p className="zui-turn__text" dir="auto">
                {meeting.conclusion}
              </p>
            </section>
          )}
          {meeting.status === "concluded" && meeting.decision && (
            <section className="zui-conclusion" aria-label="Decision">
              <span className="zui-hint">The board's decision</span>
              <DecisionChip decision={meeting.decision} />
            </section>
          )}
          {meeting.status === "awaiting-founder" && <Composer meeting={meeting} />}
          {isMeetingActive(meeting) && <CancelMeeting id={meeting.id} />}
        </>
      )}
    </Panel>
  );
}
