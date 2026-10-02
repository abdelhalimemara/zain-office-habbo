import type { RosterEntry } from "@shared/api";
import type { BoardMeeting } from "@shared/meetings";
import { speakerName } from "./meetingModel";
import { Portrait } from "./Portrait";
import type { VoiceQueue } from "./useVoiceQueue";
import { Equalizer, SpeakerIcon, VoicesOffNotice } from "./VoiceBits";

function nowLine(queue: VoiceQueue, name: string | null): string {
  if (queue.status === "blocked") return "Your browser is waiting for a click to play the board.";
  if (!name) return queue.remaining > 0 ? "Getting the next speaker ready…" : "You're up to date.";
  if (queue.status === "loading") return `Getting ${name}'s voice…`;
  if (queue.status === "paused") return `Paused · ${name}`;
  return `${name} is speaking`;
}

/** The voice meeting's playback bar: who is speaking, play/pause, skip and mute. */
export function VoicePlayer({ meeting, agents, queue, configured }: { meeting: BoardMeeting; agents: readonly RosterEntry[]; queue: VoiceQueue; configured: boolean }) {
  if (!configured) return <VoicesOffNotice detail="This voice meeting is shown as text until it is." />;
  const turn = queue.current !== null ? meeting.turns[queue.current] : undefined;
  const name = turn ? speakerName(turn.speaker, agents) : null;
  const speaking = queue.status === "playing" && !queue.muted;
  const playing = queue.status === "playing" || queue.status === "loading";
  return (
    <section className={`zui-player${speaking ? " zui-player--speaking" : ""}`} aria-label="Voice playback">
      <span className="zui-player__face">
        {turn ? (
          <Portrait agent={agents.find((a) => a.profile === turn.speaker)} name={name!} size="md" />
        ) : (
          <span className="zui-player__idle" aria-hidden="true">
            <SpeakerIcon />
          </span>
        )}
      </span>
      <div className="zui-player__text">
        <span className="zui-player__now" role="status" aria-live="polite">
          {speaking && <Equalizer />}
          {nowLine(queue, name)}
        </span>
        {queue.remaining > 0 && <span className="zui-hint">{queue.remaining} more to hear</span>}
      </div>
      <div className="zui-player__controls">
        {queue.status === "blocked" ? (
          <button type="button" className="zui-btn zui-btn--gold" onClick={queue.play}>
            Start listening
          </button>
        ) : (
          <button
            type="button"
            className="zui-btn zui-btn--icon zui-player__btn"
            aria-label={playing ? "Pause" : "Play"}
            onClick={playing ? queue.pause : queue.play}
            disabled={queue.current === null}
          >
            {playing ? (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path fill="currentColor" d="M6 4h4v16H6zM14 4h4v16h-4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path fill="currentColor" d="M7 4v16l13-8z" />
              </svg>
            )}
          </button>
        )}
        <button type="button" className="zui-btn zui-btn--icon zui-player__btn" aria-label="Skip" onClick={queue.skip} disabled={queue.current === null}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path fill="currentColor" d="M5 4v16l10-8zM16 4h3v16h-3z" />
          </svg>
        </button>
        <button type="button" className="zui-btn zui-btn--icon zui-player__btn" aria-label={queue.muted ? "Unmute" : "Mute"} aria-pressed={queue.muted} onClick={queue.toggleMute}>
          <SpeakerIcon off={queue.muted} />
        </button>
      </div>
    </section>
  );
}
