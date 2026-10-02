import { useId, useState, type FormEvent } from "react";
import type { RosterEntry } from "@shared/api";
import { findBoardMember } from "@shared/board";
import { LEADERSHIP_SEATS } from "@shared/leadership";
import { CHAIR_PROFILE, type VoicesResponse } from "@shared/voice";
import { useSetVoice, useVoices } from "../api/voiceHooks";
import { ErrorNote } from "./common";
import { SEAT_LABEL, SEAT_ROLE } from "./leadershipModel";
import { Portrait } from "./Portrait";
import { VoiceTag, VoicesOffNotice } from "./VoiceBits";
import { voiceIdError, voiceStatus } from "./voiceModel";

interface Speaker {
  profile: string;
  agent?: RosterEntry;
  name: string;
  seat: string;
}

function VoiceRow({ speaker, voices }: { speaker: Speaker; voices: VoicesResponse | undefined }) {
  const save = useSetVoice();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();
  const status = voiceStatus(speaker.profile, voices);
  const current = voices?.voices.find((v) => v.profile === speaker.profile);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = voiceIdError(draft);
    setError(found);
    if (found) return;
    save.mutate({ profile: speaker.profile, voiceId: draft.trim() }, { onSuccess: () => setDraft("") });
  };

  return (
    <li className="zui-voice-row">
      <div className="zui-voice-row__who">
        <Portrait agent={speaker.agent} name={speaker.name} size="md" />
        <div className="zui-profile__text">
          <strong className="zui-voice-row__name">{speaker.name}</strong>
          <span className="zui-hint">{speaker.seat}</span>
        </div>
        <VoiceTag status={status} />
      </div>
      <form className="zui-voice-row__form" onSubmit={submit} noValidate aria-label={`${speaker.name}'s voice`}>
        <label className="zui-sr-only" htmlFor={inputId}>
          ElevenLabs voice id for {speaker.name}
        </label>
        <input
          id={inputId}
          className="zui-input zui-mono"
          value={draft}
          placeholder={status === "own" && current ? current.voiceId : "Paste an ElevenLabs voice id"}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        <button type="submit" className="zui-btn" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
        {status === "own" && (
          <button type="button" className="zui-btn" disabled={save.isPending} onClick={() => save.mutate({ profile: speaker.profile, voiceId: null })}>
            Use stock
          </button>
        )}
      </form>
      {error && (
        <p id={errorId} className="zui-error">
          {error}
        </p>
      )}
      <ErrorNote error={save.error} />
    </li>
  );
}

type VoiceGroup = "board" | "leadership";

function boardSpeakers(advisors: readonly RosterEntry[], agents: readonly RosterEntry[], withCeo: boolean): Speaker[] {
  const ceo = agents.find((a) => a.profile === CHAIR_PROFILE);
  return [
    ...(withCeo ? [{ profile: CHAIR_PROFILE, agent: ceo, name: ceo?.name ? `${ceo.name}, CEO` : "CEO", seat: "Takes the notes and reads the minutes" }] : []),
    ...advisors.map((a) => ({ profile: a.profile, agent: a, name: findBoardMember(a.profile)?.name ?? a.title, seat: findBoardMember(a.profile)?.seat ?? a.title })),
  ];
}

/** The CEO agent, COO and VPs who speak in the VP room. */
function leadershipSpeakers(agents: readonly RosterEntry[], withCeo: boolean): Speaker[] {
  return LEADERSHIP_SEATS.filter((p) => withCeo || p !== CHAIR_PROFILE).map((profile) => ({
    profile,
    agent: agents.find((a) => a.profile === profile),
    name: SEAT_LABEL[profile],
    seat: profile === CHAIR_PROFILE ? "CEO agent · also reads the board minutes" : SEAT_ROLE[profile],
  }));
}

/**
 * ElevenLabs voices for voice meetings: board members plus the CEO's office (which reads the minutes), and the
 * execs in the VP room. The CEO agent is one voice in both rooms, so it is listed once.
 */
export function VoiceSettings({ advisors = [], agents, groups = ["board", "leadership"] }: { advisors?: readonly RosterEntry[]; agents: readonly RosterEntry[]; groups?: readonly VoiceGroup[] }) {
  const voices = useVoices();
  const both = groups.includes("board") && groups.includes("leadership");
  const sections = groups.map((g) => ({
    group: g,
    title: g === "board" ? "Board" : "Leadership room",
    speakers: g === "board" ? boardSpeakers(advisors, agents, true) : leadershipSpeakers(agents, !both),
  }));
  return (
    <section className="zui-voices" aria-label="Voices">
      <p className="zui-hint">
        Voices for voice meetings. Anyone without their own voice uses a stock ElevenLabs voice. Copy a voice's ID from your ElevenLabs voice library.
      </p>
      {voices.data && !voices.data.configured && <VoicesOffNotice detail="Voices you set here are kept and used once it is." />}
      <ErrorNote error={voices.error} />
      {sections.map((sec) => (
        <div key={sec.group} className="zui-voice-group">
          {groups.length > 1 && <h4 className="zui-voice-group__title">{sec.title}</h4>}
          <ul className="zui-voice-list" aria-label={`${sec.title} voices`}>
            {sec.speakers.map((sp) => (
              <VoiceRow key={sp.profile} speaker={sp} voices={voices.data} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
