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
