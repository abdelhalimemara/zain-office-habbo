import { useEffect, useRef, useState } from "react";
import type { RosterEntry } from "@shared/api";
import type { BoardMeeting } from "@shared/meetings";
import { isLeadershipSeat, SEAT_LABEL, seatName } from "./leadershipModel";
import { formatElapsed, liveCopy, type Caption, type LiveCopy } from "./liveModel";
import { FOUNDER, speakerName } from "./meetingModel";
import { Portrait } from "./Portrait";
import { useLiveRoom, type LiveRoom as Room } from "./useLiveRoom";
import { Equalizer, MicIcon } from "./VoiceBits";

interface Seat {
  profile: string;
  name: string;
  /** The exec's seat in the VP room ("VP Growth"), shown under the name. */
  role?: string;
}

/**
 * Seats in the room: the session's speakers once joined, the invited members before. The VP room names each exec
 * from the roster with their seat (Omar Khalid, VP Growth…) whatever the session calls them.
 */
function seatsFor(meeting: BoardMeeting, room: Room, agents: readonly RosterEntry[]): Seat[] {
  const leadership = meeting.kind === "leadership";
  const seat = (profile: string, given?: string): Seat =>
    leadership && isLeadershipSeat(profile)
      ? { profile, name: seatName(profile, agents), role: SEAT_LABEL[profile] }
      : { profile, name: given ?? speakerName(profile, agents) };
  const fromSession = room.speakers.map((s) => seat(s.profile, s.name));
  const seats = fromSession.length ? fromSession : meeting.members.map((m) => seat(m));
  return seats.filter((s, i) => seats.findIndex((x) => x.profile === s.profile) === i);
}

/** A caption's speaker: "Omar Khalid · VP Growth" in the VP room, the member's name in the board room. */
function nameOf(profile: string, seats: readonly Seat[], agents: readonly RosterEntry[]): string {
  if (profile === FOUNDER) return "You";
  const seat = seats.find((s) => s.profile === profile);
  if (!seat) return speakerName(profile, agents);
  return seat.role ? `${seat.name} · ${seat.role}` : seat.name;
}

function SeatStrip({ seats, room, agents }: { seats: readonly Seat[]; room: Room; agents: readonly RosterEntry[] }) {
  const all: Seat[] = [...seats, { profile: FOUNDER, name: "You" }];
  return (
    <ul className="zui-seats" aria-label="Seats">
      {all.map((s) => {
        const speaking = room.speaker === s.profile;
        const founder = s.profile === FOUNDER;
        return (
          <li key={s.profile} className={`zui-seat${speaking ? " zui-seat--speaking" : ""}${founder ? " zui-seat--you" : ""}`} aria-current={speaking ? "true" : undefined}>
            <span className="zui-seat__face">
              {founder ? (
                <span className="zui-avatar zui-avatar--md zui-seat__you" aria-hidden="true">
                  <MicIcon />
                </span>
              ) : (
                <Portrait agent={agents.find((a) => a.profile === s.profile)} name={s.name} size="md" />
              )}
              {speaking && (
                <span className="zui-seat__eq">
                  <Equalizer />
                </span>
              )}
            </span>
            <span className="zui-seat__name">{s.name}</span>
            {s.role && <span className="zui-seat__role">{s.role}</span>}
            {founder && room.muted && <span className="zui-seat__muted">Muted</span>}
          </li>
        );
      })}
    </ul>
  );
}

function Captions({ captions, seats, agents, speaker }: { captions: readonly Caption[]; seats: readonly Seat[]; agents: readonly RosterEntry[]; speaker: string | null }) {
  const list = useRef<HTMLOListElement>(null);
  // Follow the newest caption inside the list only, so the panel itself doesn't jump away from the seats.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [captions.length]);
  const lastBoard = [...captions].reverse().find((c) => c.speaker === speaker);
  return (
    <ol ref={list} className="zui-turns zui-live__captions" aria-label="Live captions" aria-live="polite">
      {captions.map((c) => {
        const founder = c.speaker === FOUNDER;
        const name = nameOf(c.speaker, seats, agents);
        return (
          <li key={c.key} className={`zui-turn${founder ? " zui-turn--founder" : ""}${c === lastBoard ? " zui-turn--current" : ""}`}>
            {!founder && <Portrait agent={agents.find((a) => a.profile === c.speaker)} name={name} size="md" />}
            <div className="zui-turn__bubble">
              <div className="zui-turn__head">
                <span className="zui-turn__name">{name}</span>
              </div>
              <p className="zui-turn__text" dir="auto">
                {c.text}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function statusLine(room: Room, copy: LiveCopy): string {
  switch (room.phase) {
    case "joining":
      return "Connecting to the room…";
    case "connected":
      return room.status === "connected" || room.status === "connecting" ? `Live · ${formatElapsed((room.now - (room.connectedAt ?? room.now)) / 1000)}` : "Reconnecting…";
    case "dropped":
      return "Disconnected";
    case "ending":
      return "Call ended";
    case "ended":
      return copy.ended;
    default:
      return "Not in the room";
  }
}

function LevelMeter({ level, muted }: { level: number; muted: boolean }) {
  const pct = Math.round(level * 100);
  return (
    <span className={`zui-meter${muted ? " zui-meter--muted" : ""}`} role="meter" aria-label="Mic level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span className="zui-meter__fill" style={{ transform: `scaleX(${Math.max(0.02, level)})` }} />
    </span>
  );
}

function EndControl({ room, copy }: { room: Room; copy: LiveCopy }) {
  const [confirming, setConfirming] = useState(false);
  if (!room.canEnd || room.phase === "ending" || room.phase === "ended") return null;
  if (!confirming)
    return (
      <button type="button" className="zui-btn zui-btn--primary" onClick={() => setConfirming(true)}>
        {copy.endButton}
      </button>
    );
  return (
    <div className="zui-confirm" role="group" aria-label="Confirm end meeting">
      <span>{copy.confirmQuestion}</span>
      <button
        type="button"
        className="zui-btn zui-btn--primary"
        onClick={() => {
          setConfirming(false);
          room.end();
        }}
      >
        {copy.confirmButton}
      </button>
      <button type="button" className="zui-btn" onClick={() => setConfirming(false)}>
        Keep talking
      </button>
    </div>
  );
}

/** A voice meeting's live room: always-on mic, the board (or the execs) in their own voices, captions per speaker. */
export function LiveRoom({ meeting, agents }: { meeting: BoardMeeting; agents: readonly RosterEntry[] }) {
  const room = useLiveRoom(meeting);
  const copy = liveCopy(meeting.kind);
  const seats = seatsFor(meeting, room, agents);
  const inCall = room.phase === "connected";
  const busy = room.phase === "joining" || room.phase === "ending";
  const retry = room.error?.kind === "end" ? room.end : room.join;

  return (
    <section className={`zui-live zui-live--${room.phase}`} aria-label="Live room">
      <div className="zui-live__top">
        <span className="zui-live__status" role="status" aria-live="polite">
          <span className="zui-live__dot" aria-hidden="true" />
          {statusLine(room, copy)}
        </span>
        {inCall && (
          <span className="zui-hint">
            {room.mode === "speaking" ? copy.speaking : room.captions.length === 0 ? copy.waiting : "The floor is open. Just talk."}
          </span>
        )}
      </div>
      <SeatStrip seats={seats} room={room} agents={agents} />

      {room.error && (
        <div className="zui-live__error" role="alert">
          <p>{room.error.message}</p>
          {room.error.kind !== "not-live" && !busy && !room.saving && (
            <button type="button" className="zui-btn" onClick={retry}>
              {room.error.kind === "end" ? "Try again" : room.phase === "dropped" ? "Rejoin" : "Retry"}
            </button>
          )}
        </div>
      )}

      {(room.phase === "idle" || room.phase === "joining") && !room.error && (
        <div className="zui-live__join">
          <button type="button" className="zui-btn zui-btn--gold zui-live__join-btn" onClick={room.join} disabled={room.phase === "joining" || room.saving}>
            <MicIcon />
            {room.phase === "joining" ? "Joining…" : room.saving ? "Saving the last session…" : "Join the room"}
          </button>
          <p className="zui-hint">{copy.joinHint}</p>
        </div>
      )}

      {inCall && (
        <div className="zui-live__controls">
          <button
            type="button"
            className={`zui-btn zui-live__mute${room.muted ? " zui-live__mute--off" : ""}`}
            aria-pressed={room.muted}
            onClick={room.toggleMute}
          >
            <MicIcon />
            {room.muted ? "Unmute" : "Mute"}
          </button>
          <LevelMeter level={room.inputLevel} muted={room.muted} />
          <button type="button" className="zui-btn zui-live__leave" onClick={room.leave}>
            Leave
          </button>
          <EndControl room={room} copy={copy} />
        </div>
      )}

      {room.phase === "ending" ? (
        <p className="zui-waiting" role="status">
          <span className="zui-waiting__dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          {copy.ending}
        </p>
      ) : (
        !inCall && <EndControl room={room} copy={copy} />
      )}

      {room.captions.length > 0 ? (
        <Captions captions={room.captions} seats={seats} agents={agents} speaker={room.speaker} />
      ) : (
        inCall && <p className="zui-hint zui-live__empty">Captions appear here as people speak.</p>
      )}
    </section>
  );
}
