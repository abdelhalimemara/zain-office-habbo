import { useEffect, useId, useRef, useState } from "react";
import type { RosterEntry } from "@shared/api";
import { FOUNDER_REMARK_MAX, MAX_DISCUSSION_ROUNDS, type BoardMeeting, type FounderRemarkRequest, type MeetingTurn } from "@shared/meetings";
import { isMeetingActive, useCancelMeeting, useFounderRemark, useMeeting } from "../api/meetingHooks";
import { useVoices } from "../api/voiceHooks";
import { useUiStore } from "../state/store";
import { ErrorNote, Text, useRosterAgents } from "./common";
import { absoluteTime, relativeTime } from "./mandates";
import { FOUNDER, groupTurns, isMinutes, shortName, speakerName, tallyVotes, VOTES, waitingFor } from "./meetingModel";
import { DecisionChip, MeetingStatusChip, NotionLink } from "./MeetingsTab";
import { MicButton } from "./MicButton";
import { Panel } from "./Panel";
import { Portrait } from "./Portrait";
import { useVoiceQueue, type VoiceQueue } from "./useVoiceQueue";
import { Equalizer, SpeakerIcon, VoiceModeBadge } from "./VoiceBits";
import { VoicePlayer } from "./VoicePlayer";

const BOARD_COLOR = "#C9A227";

/** The server needs remark text; with none typed, the founder's choice is said in words. */
export const DEFAULT_REMARK: Record<NonNullable<FounderRemarkRequest["next"]>, string> = {
  continue: "Please continue.",
  "extra-round": "Please take another discussion round.",
  "to-vote": "Please move to the vote.",
};

/** Voice controls a transcript gets in a voice meeting whose audio is reachable. */
interface TurnVoice {
  meeting: BoardMeeting;
  queue: VoiceQueue;
}

function Bubble({ turn, agents, now, voice }: { turn: MeetingTurn; agents: readonly RosterEntry[]; now: number; voice?: TurnVoice }) {
  const founder = turn.speaker === FOUNDER;
  const agent = agents.find((a) => a.profile === turn.speaker);
  const name = speakerName(turn.speaker, agents);
  const index = voice && !founder ? voice.meeting.turns.indexOf(turn) : -1;
  const current = index >= 0 && voice!.queue.current === index;
  const speaking = current && voice!.queue.status === "playing";
  const failed = index >= 0 ? voice!.queue.failed.get(index) : undefined;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (current) ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [current]);
  return (
    <li ref={ref} className={`zui-turn${founder ? " zui-turn--founder" : ""}${current ? " zui-turn--current" : ""}${speaking ? " zui-turn--speaking" : ""}`}>
      {!founder && <Portrait agent={agent} name={name} size="md" />}
      <div className="zui-turn__bubble">
        <div className="zui-turn__head">
          <span className="zui-turn__name">{name}</span>
          {speaking && <Equalizer />}
          <time className="zui-turn__time" dateTime={new Date(turn.at * 1000).toISOString()} title={absoluteTime(turn.at)}>
            {relativeTime(turn.at, now)}
          </time>
          {index >= 0 && (
            <button type="button" className="zui-turn__play" aria-label={`Play ${name}'s turn`} title={failed ?? "Play this turn"} onClick={() => voice!.queue.replay(index)}>
              <SpeakerIcon off={!!failed} />
            </button>
          )}
        </div>
        <p className="zui-turn__text" dir="auto">
          {turn.text}
        </p>
        {failed && <span className="zui-turn__fallback">{failed} · text only</span>}
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

function Composer({ meeting, voice, onRecord }: { meeting: BoardMeeting; voice: boolean; onRecord?: () => void }) {
  const remark = useFounderRemark();
  const [text, setText] = useState("");
  const id = useId();
  const send = (next: NonNullable<FounderRemarkRequest["next"]>) =>
    remark.mutate({ id: meeting.id, text: text.trim() || DEFAULT_REMARK[next], next }, { onSuccess: () => setText("") });
  const canExtend = meeting.discussionRounds < MAX_DISCUSSION_ROUNDS;
  return (
    <section className="zui-composer" aria-label="Your remarks">
      <label htmlFor={id} className="zui-label">
        Your remarks to the board <span className="zui-hint">(optional)</span>
      </label>
      <textarea id={id} className="zui-input" rows={3} maxLength={FOUNDER_REMARK_MAX} dir="auto" value={text} onChange={(e) => setText(e.target.value)} />
      {voice && <MicButton disabled={remark.isPending} onRecord={onRecord} onText={(said) => setText((t) => (t.trim() ? `${t.trimEnd()} ${said}` : said).slice(0, FOUNDER_REMARK_MAX))} />}
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

function Transcript({ meeting, agents, voice }: { meeting: BoardMeeting; agents: readonly RosterEntry[]; voice?: TurnVoice }) {
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
                <Bubble key={`${t.speaker}-${t.at}-${i}`} turn={t} agents={agents} now={now} voice={voice} />
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
  const isVoice = meeting?.mode === "voice";
  const voices = useVoices(isVoice);
  const configured = voices.data?.configured !== false;
  const queue = useVoiceQueue(id, meeting?.turns ?? [], isVoice && configured && !voices.isPending);
  const turnVoice = meeting && isVoice && configured ? { meeting, queue } : undefined;

  return (
    <Panel title={meeting?.topic ?? "Board meeting"} accent={BOARD_COLOR} onClose={closePanel} className="zui-panel--meeting">
      <div className="zui-meeting__bar">
        <button type="button" className="zui-link" onClick={() => openPanel({ kind: "board", tab: "meetings" })}>
          ‹ All meetings
        </button>
        {meeting && <MeetingStatusChip meeting={meeting} />}
        {isVoice && <VoiceModeBadge />}
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
          {isVoice && <VoicePlayer meeting={meeting} agents={agents} queue={queue} configured={configured} />}
          <Transcript meeting={meeting} agents={agents} voice={turnVoice} />
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
          {meeting.status === "awaiting-founder" && <Composer meeting={meeting} voice={isVoice} onRecord={queue.pause} />}
          {isMeetingActive(meeting) && <CancelMeeting id={meeting.id} />}
        </>
      )}
    </Panel>
  );
}
