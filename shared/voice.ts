/**
 * ElevenLabs voices for board meetings. The API key lives in the default Hermes profile's .env
 * (ELEVENLABS_API_KEY) and never leaves the server; the browser only ever gets audio bytes and text.
 */

/** Speaker → ElevenLabs voice id. Speakers are board member profiles plus the CEO's office ("default"), which reads the minutes. */
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
/**
 * The CEO's Hermes profile, which only takes the minutes. It is not a board member and has no seat or voice in the
 * live room: the founder is the CEO there and leads the meeting. (The name is kept for compatibility.)
 */
export const CHAIR_PROFILE = "default";

/** One member in the live room: the agent switches to their voice inside <tag>…</tag>. */
export interface LiveSpeaker {
  /** Multi-voice label, e.g. "Hormozi". Letters only. */
  tag: string;
  /** Board member's Hermes profile. */
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

/**
 * Splits an agent message into per-speaker parts by its multi-voice tags. There is no chair: untagged text goes to
 * the member who spoke just before it in the message; untagged text that opens the message comes back with tag null,
 * for the caller to give to the previous speaker or drop.
 */
export function splitBySpeaker(text: string, speakers: readonly LiveSpeaker[]): { tag: string | null; text: string }[] {
  const tags = speakers.map((s) => s.tag).filter(Boolean).join("|");
  if (!tags) return text.trim() ? [{ tag: null, text: text.trim() }] : [];
  const re = new RegExp(`<(${tags})>([\\s\\S]*?)(?:</\\1>|$)`, "g");
  const parts: { tag: string | null; text: string }[] = [];
  const untagged = (said: string) => {
    if (!said) return;
    const prev = parts.at(-1);
    if (prev) prev.text = `${prev.text} ${said}`;
    else parts.push({ tag: null, text: said });
  };
  let last = 0;
  for (const m of text.matchAll(re)) {
    const [whole, tag = "", said = ""] = m;
    untagged(text.slice(last, m.index).trim());
    if (said.trim()) parts.push({ tag, text: said.trim() });
    last = (m.index ?? 0) + whole.length;
  }
  untagged(text.slice(last).trim());
  return parts;
}
