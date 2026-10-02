import { VOICE_ID_PATTERN, type VoicesResponse } from "@shared/voice";

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
