import { CHAIR_PROFILE, splitBySpeaker, type LiveSpeaker } from "@shared/voice";
import { ApiRequestError } from "../api/client";
import { FOUNDER } from "./meetingModel";

/** One caption bubble in the live room: a single speaker's words from one message. */
export interface Caption {
  key: string;
  /** "u-<event>" or "a-<event>": captions from one message share it, so a resent message replaces its own. */
  event: string;
  /** Board member profile, CHAIR_PROFILE, or FOUNDER for the founder's own words. */
  speaker: string;
  text: string;
}

/** The parts of the SDK's MessagePayload the room uses. */
export interface LiveMessage {
  role: "user" | "agent";
  message: string;
  event_id: number;
}

/** Captions kept on screen; older ones are already in the server transcript. */
export const MAX_CAPTIONS = 200;

/** The profile behind a multi-voice tag; untagged agent text belongs to the chair. */
export function profileForTag(tag: string | null, speakers: readonly LiveSpeaker[]): string {
  return (tag && speakers.find((s) => s.tag === tag)?.profile) || CHAIR_PROFILE;
}

export function messageCaptions(msg: LiveMessage, speakers: readonly LiveSpeaker[]): Caption[] {
  const event = `${msg.role === "user" ? "u" : "a"}-${msg.event_id}`;
  if (msg.role === "user") {
    const text = msg.message.trim();
    return text ? [{ key: event, event, speaker: FOUNDER, text }] : [];
  }
  return splitBySpeaker(msg.message, speakers).map((p, i) => ({ key: `${event}-${i}`, event, speaker: profileForTag(p.tag, speakers), text: p.text }));
}

/** Adds a message's captions in order; a message resent with the same event id replaces its earlier captions in place. */
export function addMessage(captions: readonly Caption[], msg: LiveMessage, speakers: readonly LiveSpeaker[]): Caption[] {
  const added = messageCaptions(msg, speakers);
  const event = added[0]?.event ?? `${msg.role === "user" ? "u" : "a"}-${msg.event_id}`;
  const at = captions.findIndex((c) => c.event === event);
  const next = at < 0 ? [...captions, ...added] : [...captions.slice(0, at), ...added, ...captions.slice(at).filter((c) => c.event !== event)];
  return next.slice(-MAX_CAPTIONS);
}

/** The board's latest message, as its per-speaker captions. */
export function latestAgentParts(captions: readonly Caption[]): Caption[] {
  const last = [...captions].reverse().find((c) => c.speaker !== FOUNDER);
  return last ? captions.filter((c) => c.event === last.event) : [];
}

/** Roughly how fast the voices read, to follow a multi-speaker message from one member to the next. */
export const SPOKEN_CHARS_PER_SECOND = 15;

/** Who in a multi-speaker message is talking `elapsedMs` after it started, by each part's share of the text. */
export function speakerAt(parts: readonly Pick<Caption, "speaker" | "text">[], elapsedMs: number): string | null {
  let budget = (Math.max(0, elapsedMs) / 1000) * SPOKEN_CHARS_PER_SECOND;
  for (const p of parts) {
    if (budget < p.text.length) return p.speaker;
    budget -= p.text.length;
  }
  return parts.at(-1)?.speaker ?? null;
}

/** The seat to light: the founder while their voice is detected, else the member speaking, else nobody. */
export function currentSpeaker(input: { mode: "speaking" | "listening"; userTalking: boolean; parts: readonly Caption[]; elapsedMs: number }): string | null {
  if (input.userTalking) return FOUNDER;
  if (input.mode !== "speaking") return null;
  return speakerAt(input.parts, input.elapsedMs);
}

/** Voice activity above this lights "You"; it has to fall below the lower bound to switch off, so it doesn't flicker. */
export const VAD_ON = 0.6;
export const VAD_OFF = 0.3;

export function nextUserTalking(talking: boolean, vadScore: number): boolean {
  return talking ? vadScore >= VAD_OFF : vadScore >= VAD_ON;
}

export type LiveErrorKind = "mic" | "no-mic" | "not-configured" | "not-live" | "session" | "end";

export interface LiveError {
  kind: LiveErrorKind;
  message: string;
}

/** What went wrong while joining, in words the founder can act on. */
export function joinError(err: unknown): LiveError {
  const name = err instanceof DOMException || (err instanceof Error && err.name) ? (err as Error).name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return { kind: "mic", message: "Microphone access is blocked. Allow the mic for this site in your browser, then try again." };
  if (name === "NotFoundError" || name === "NotReadableError") return { kind: "no-mic", message: "No working microphone was found. Plug one in or free it from another app, then try again." };
  if (err instanceof ApiRequestError) {
    if (err.status === 503) return { kind: "not-configured", message: "ElevenLabs isn't connected. Add ELEVENLABS_API_KEY to the Hermes .env, then try again." };
    if (err.status === 409) return { kind: "not-live", message: "This meeting isn't live any more." };
    if (err.status === 429) return { kind: "session", message: "ElevenLabs is busy or out of quota. Wait a moment, then try again." };
    if (err.status === 504) return { kind: "session", message: "ElevenLabs took too long to answer. Try again." };
    return { kind: "session", message: `Couldn't open the room: ${err.message}` };
  }
  return { kind: "session", message: `Couldn't connect to the room${err instanceof Error && err.message ? `: ${err.message}` : "."}` };
}

/** Seconds → "4:05" for the call timer. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
}
