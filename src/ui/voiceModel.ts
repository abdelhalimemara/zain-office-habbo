import type { MeetingTurn } from "@shared/meetings";
import { VOICE_ID_PATTERN, type VoicesResponse } from "@shared/voice";
import { FOUNDER } from "./meetingModel";

export const PLAYED_KEY_PREFIX = "zui.voice.played.";
export const MUTED_KEY = "zui.voice.muted";

/** Indices into meeting.turns that have audio: everyone's but the founder's. */
export function voicedIndices(turns: readonly Pick<MeetingTurn, "speaker">[]): number[] {
  return turns.flatMap((t, i) => (t.speaker === FOUNDER ? [] : [i]));
}

/** The earliest voiced turn not yet heard and not known to have no audio this session. */
export function nextUnplayed(turns: readonly Pick<MeetingTurn, "speaker">[], played: ReadonlySet<number>, failed: ReadonlySet<number>): number | null {
  return voicedIndices(turns).find((i) => !played.has(i) && !failed.has(i)) ?? null;
}

/** Voiced turns still waiting to be heard. */
export function unplayedCount(turns: readonly Pick<MeetingTurn, "speaker">[], played: ReadonlySet<number>, failed: ReadonlySet<number>): number {
  return voicedIndices(turns).filter((i) => !played.has(i) && !failed.has(i)).length;
}

export function loadPlayed(meetingId: string): Set<number> {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(PLAYED_KEY_PREFIX + meetingId) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((n): n is number => Number.isInteger(n) && n >= 0) : []);
  } catch {
    return new Set();
  }
}

export function savePlayed(meetingId: string, played: ReadonlySet<number>): void {
  try {
    window.localStorage.setItem(PLAYED_KEY_PREFIX + meetingId, JSON.stringify([...played].sort((a, b) => a - b)));
  } catch {
    return;
  }
}

export function loadMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
  } catch {
    return;
  }
}

/** Why a turn falls back to text, from the audio request's HTTP status (0: no response). */
export function audioFailure(status: number): string {
  if (status === 503) return "Voice unavailable";
  if (status === 404) return "No audio for this turn";
  if (status === 0) return "Couldn't play";
  return `Audio failed (${status})`;
}

export type VoiceStatus = "own" | "stock";

/** Own voice when the server says the member has one; stock otherwise (including when unknown). */
export function voiceStatus(profile: string, voices: VoicesResponse | undefined): VoiceStatus {
  const v = voices?.voices.find((x) => x.profile === profile);
  return v && !v.fallback ? "own" : "stock";
}

export const VOICE_STATUS_LABEL: Record<VoiceStatus, string> = { own: "Own voice", stock: "Stock voice" };

/** Null when the pasted id looks like an ElevenLabs voice id, else what's wrong with it. */
export function voiceIdError(raw: string): string | null {
  const id = raw.trim();
  if (!id) return "Paste an ElevenLabs voice id.";
  if (!VOICE_ID_PATTERN.test(id)) return "Voice ids are 10–40 letters and digits, with no spaces or symbols.";
  return null;
}

/** Recorder formats in preference order: Chrome/Firefox take webm/opus, Safari takes mp4. */
export const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"] as const;

export function pickRecordingType(isSupported: (type: string) => boolean): string | undefined {
  return RECORDING_TYPES.find((t) => {
    try {
      return isSupported(t);
    } catch {
      return false;
    }
  });
}

/** The Content-Type to upload with: the bare mime, without codec parameters. */
export function uploadType(blobType: string, fallback = "audio/webm"): string {
  const base = blobType.split(";")[0]!.trim().toLowerCase();
  return base.startsWith("audio/") || base.startsWith("video/") ? base.replace(/^video\//, "audio/") : fallback;
}

/** 0:07, 1:05… */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
