import { useId, useState, type FormEvent } from "react";
import type { RosterEntry } from "@shared/api";
import { findBoardMember } from "@shared/board";
import { CHAIR_PROFILE, type VoicesResponse } from "@shared/voice";
import { useSetVoice, useVoices } from "../api/voiceHooks";
import { ErrorNote } from "./common";
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

/** Each board member's ElevenLabs voice, plus the CEO's office, which reads the minutes. */
export function VoiceSettings({ advisors, agents }: { advisors: readonly RosterEntry[]; agents: readonly RosterEntry[] }) {
  const voices = useVoices();
  const ceo = agents.find((a) => a.profile === CHAIR_PROFILE);
  const speakers: Speaker[] = [
    { profile: CHAIR_PROFILE, agent: ceo, name: ceo?.name ? `${ceo.name}, CEO` : "CEO", seat: "Takes the notes and reads the minutes" },
    ...advisors.map((a) => ({ profile: a.profile, agent: a, name: findBoardMember(a.profile)?.name ?? a.title, seat: findBoardMember(a.profile)?.seat ?? a.title })),
  ];
  return (
    <section className="zui-voices" aria-label="Voices">
      <p className="zui-hint">
        Voices for voice meetings. Members without their own voice use a stock ElevenLabs voice. Copy a voice's ID from your ElevenLabs voice library.
      </p>
      {voices.data && !voices.data.configured && <VoicesOffNotice detail="Voices you set here are kept and used once it is." />}
      <ErrorNote error={voices.error} />
      <ul className="zui-voice-list">
        {speakers.map((s) => (
          <VoiceRow key={s.profile} speaker={s} voices={voices.data} />
        ))}
      </ul>
    </section>
  );
}
