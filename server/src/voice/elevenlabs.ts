import { join } from "node:path";
import { hermesHome } from "../clientChannels/hermesPaths";
import { readEnvKey, redact } from "../connections/run";
import type { FetchLike } from "../hermes/client";
import { HttpError } from "../http";

const BASE = "https://api.elevenlabs.io/v1";
/** Multilingual: board members speak Arabic as well as English. */
export const TTS_MODEL = "eleven_multilingual_v2";
export const STT_MODEL = "scribe_v1";
const TTS_TIMEOUT_MS = 60_000;
const STT_TIMEOUT_MS = 90_000;
export const NOT_CONFIGURED = "ElevenLabs is not configured";

/** Resolves the API key at call time; null when it is not set. */
export type KeySource = () => Promise<string | null>;

/** Reads ELEVENLABS_API_KEY from the default profile's .env at call time; it never leaves the request header. */
export function envApiKey(home = hermesHome()): KeySource {
  return () => readEnvKey(join(home, ".env"), "ELEVENLABS_API_KEY");
}

interface UpstreamDetail {
  status?: string;
  message?: string;
}

async function errorDetail(res: Response): Promise<UpstreamDetail> {
  try {
    const data = (await res.json()) as { detail?: unknown };
    const d = data?.detail;
    if (typeof d === "string") return { message: d };
    if (d && typeof d === "object" && !Array.isArray(d)) {
      const { status, message } = d as Record<string, unknown>;
      return { status: typeof status === "string" ? status : undefined, message: typeof message === "string" ? message : undefined };
    }
  } catch {
    // Non-JSON error bodies carry nothing worth keeping.
  }
  return {};
}

type Operation = "speech" | "transcription";

/** Upstream failures become clean errors for the browser; the detail goes to the server log only. */
function upstreamError(status: number, detail: UpstreamDetail, op: Operation): HttpError {
  if (detail.status === "quota_exceeded") return new HttpError(429, "ElevenLabs quota exceeded");
  if (status === 401 || status === 403) return new HttpError(502, "ElevenLabs rejected the API key");
  if (status === 429) return new HttpError(429, "ElevenLabs is busy; try again shortly");
  if (op === "speech" && (status === 404 || detail.status === "voice_not_found")) return new HttpError(502, "ElevenLabs could not find this voice");
  if (op === "transcription" && (status === 400 || status === 422)) return new HttpError(422, "ElevenLabs could not transcribe this audio");
  return new HttpError(502, `ElevenLabs ${op} failed (HTTP ${status})`);
}

const EXTENSIONS: Record<string, string> = { webm: "webm", ogg: "ogg", mp4: "mp4", "x-m4a": "m4a", mpeg: "mp3", wav: "wav", "x-wav": "wav" };

function fileName(contentType: string): string {
  const sub = contentType.split(";")[0]!.trim().toLowerCase().replace(/^audio\//, "");
  return `speech.${EXTENSIONS[sub] ?? "bin"}`;
}

export class ElevenLabsClient {
  constructor(
    private readonly key: KeySource,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly log: (line: string) => void = console.warn,
  ) {}

  async configured(): Promise<boolean> {
    return !!(await this.key());
  }

  /** Text to MP3 (44.1 kHz, 128 kbps) in the given voice. */
  async speak(voiceId: string, text: string): Promise<Uint8Array> {
    const res = await this.post(
      `/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      { "Content-Type": "application/json", Accept: "audio/mpeg" },
      JSON.stringify({ text, model_id: TTS_MODEL }),
      TTS_TIMEOUT_MS,
      "speech",
    );
    const audio = new Uint8Array(await res.arrayBuffer());
    if (audio.byteLength === 0) throw new HttpError(502, "ElevenLabs returned no audio");
    return audio;
  }

  /** Recorded speech (any audio/* type) to text. */
  async transcribe(audio: Uint8Array, contentType: string): Promise<string> {
    const form = new FormData();
    form.append("model_id", STT_MODEL);
    form.append("file", new Blob([audio as Uint8Array<ArrayBuffer>], { type: contentType }), fileName(contentType));
    const res = await this.post("/speech-to-text", {}, form, STT_TIMEOUT_MS, "transcription");
    const data = (await res.json().catch(() => null)) as { text?: unknown } | null;
    if (!data || typeof data.text !== "string") throw new HttpError(502, "ElevenLabs returned no transcript");
    return data.text.trim();
  }

  private async post(path: string, headers: Record<string, string>, body: BodyInit, timeoutMs: number, op: Operation): Promise<Response> {
    const key = await this.key();
    if (!key) throw new HttpError(503, NOT_CONFIGURED);
    let res: Response;
    try {
      res = await this.fetchImpl(`${BASE}${path}`, {
        method: "POST",
        headers: { ...headers, "xi-api-key": key },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "error";
      if (name === "TimeoutError" || name === "AbortError") throw new HttpError(504, `ElevenLabs ${op} timed out`);
      throw new HttpError(502, "ElevenLabs is unreachable");
    }
    if (res.ok) return res;
    const detail = await errorDetail(res);
    const why = [detail.status, detail.message].filter(Boolean).join(": ");
    this.log(`elevenlabs: ${op} failed (HTTP ${res.status}${why ? `, ${redact(why, [key])}` : ""})`);
    throw upstreamError(res.status, detail, op);
  }
}
