/**
 * ElevenLabs voices for board meetings. The API key lives in the default Hermes profile's .env
 * (ELEVENLABS_API_KEY) and never leaves the server; the browser only ever gets audio bytes and text.
 */

/** Speaker → ElevenLabs voice id. Speakers are board member profiles plus the chair ("default"). */
export interface VoiceAssignment {
  profile: string;
  /** The voice the member speaks with: their own if set, else a stock fallback. */
  voiceId: string;
  /** True when the member has no voice of their own and uses a stock ElevenLabs voice. */
  fallback: boolean;
}

export interface VoicesResponse {
  /** ELEVENLABS_API_KEY is present in the default profile's .env. */
  configured: boolean;
  voices: VoiceAssignment[];
}

export interface SetVoiceRequest {
  /** An ElevenLabs voice id, or null to go back to the stock fallback. */
  voiceId: string | null;
}

export interface TranscribeResponse {
  text: string;
}

export const VOICE_API = {
  voices: "/api/board/voices",
  voice: (profile: string) => `/api/board/voices/${encodeURIComponent(profile)}`,
  /** GET → audio/mpeg for meeting.turns[index]; 404 for founder turns. */
  turnAudio: (meetingId: string, index: number) =>
    `/api/board/meetings/${encodeURIComponent(meetingId)}/turns/${index}/audio`,
  /** POST raw audio (webm/ogg/mp4/wav body, Content-Type set) → TranscribeResponse. */
  transcribe: "/api/board/voice/transcribe",
} as const;

/** ElevenLabs voice ids are short alphanumeric strings. */
export const VOICE_ID_PATTERN = /^[A-Za-z0-9]{10,40}$/;
export const TRANSCRIBE_MAX_BYTES = 10 * 1024 * 1024;
/** Speaker id used for the chair's minutes turns. */
export const CHAIR_PROFILE = "default";

/** One member in the live room: the agent switches to their voice inside <tag>…</tag>. */
export interface LiveSpeaker {
  /** Multi-voice label, e.g. "Hormozi". Letters only. */
  tag: string;
  /** Hermes profile, or CHAIR_PROFILE for the chair. */
  profile: string;
  name: string;
}

/** What the browser needs to open the live room with @elevenlabs/client. */
export interface LiveSessionResponse {
  /** Short-lived signed websocket URL for the board room agent. Never contains the API key. */
  signedUrl: string;
  /** Pass as `overrides` to Conversation.startSession: the meeting's prompt, first message and language. */
  overrides: {
    agent: { prompt: { prompt: string }; firstMessage: string; language: string };
  };
  speakers: LiveSpeaker[];
}

export interface EndLiveRequest {
  /** The ElevenLabs conversation id from the session; the server pulls the transcript from ElevenLabs. */
  conversationId: string;
  /** false: save a dropped session's transcript and keep the meeting live (reconnect). Default true: go to the vote. */
  final?: boolean;
}

export const LIVE_API = {
  /** POST → LiveSessionResponse. Only for meetings with mode "voice" and status "live". */
  session: (meetingId: string) => `/api/board/meetings/${encodeURIComponent(meetingId)}/live`,
  /** POST EndLiveRequest → MeetingResponse: transcript appended as turns, meeting moves to the vote. */
  end: (meetingId: string) => `/api/board/meetings/${encodeURIComponent(meetingId)}/live/end`,
} as const;

/** Splits an agent message into per-speaker parts by its multi-voice tags; untagged text belongs to the chair. */
export function splitBySpeaker(text: string, speakers: readonly LiveSpeaker[]): { tag: string | null; text: string }[] {
  const tags = speakers.map((s) => s.tag).join("|");
  if (!tags) return text.trim() ? [{ tag: null, text: text.trim() }] : [];
  const re = new RegExp(`<(${tags})>([\\s\\S]*?)(?:</\\1>|$)`, "g");
  const parts: { tag: string | null; text: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const [whole, tag = "", said = ""] = m;
    const before = text.slice(last, m.index).trim();
    if (before) parts.push({ tag: null, text: before });
    if (said.trim()) parts.push({ tag, text: said.trim() });
    last = (m.index ?? 0) + whole.length;
  }
  const rest = text.slice(last).trim();
  if (rest) parts.push({ tag: null, text: rest });
  return parts;
}
