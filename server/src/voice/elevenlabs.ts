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
const CONVAI_TIMEOUT_MS = 30_000;
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

type Operation = "speech" | "transcription" | "agent setup" | "live session" | "conversation";

/** Upstream failures become clean errors for the browser; the detail goes to the server log only. */
function upstreamError(status: number, detail: UpstreamDetail, op: Operation): HttpError {
  if (detail.status === "quota_exceeded") return new HttpError(429, "ElevenLabs quota exceeded");
  if (status === 401 || status === 403) return new HttpError(502, "ElevenLabs rejected the API key");
  if (status === 429) return new HttpError(429, "ElevenLabs is busy; try again shortly");
  if (op === "speech" && (status === 404 || detail.status === "voice_not_found")) return new HttpError(502, "ElevenLabs could not find this voice");
  if (op === "transcription" && (status === 400 || status === 422)) return new HttpError(422, "ElevenLabs could not transcribe this audio");
  if (op === "agent setup" && status === 404) return new HttpError(404, "ElevenLabs has no such agent");
  if (op === "conversation" && status === 404) return new HttpError(404, "ElevenLabs has no such conversation");
  return new HttpError(502, `ElevenLabs ${op} failed (HTTP ${status})`);
}

const EXTENSIONS: Record<string, string> = { webm: "webm", ogg: "ogg", mp4: "mp4", "x-m4a": "m4a", mpeg: "mp3", wav: "wav", "x-wav": "wav" };

function fileName(contentType: string): string {
  const sub = contentType.split(";")[0]!.trim().toLowerCase().replace(/^audio\//, "");
  return `speech.${EXTENSIONS[sub] ?? "bin"}`;
}

const JSON_HEADERS = { "Content-Type": "application/json" };
export const AGENT_ID = /^agent_[A-Za-z0-9]{8,64}$/;

function agentId(data: { agent_id?: unknown } | null): string {
  const id = data?.agent_id;
  if (typeof id !== "string" || !AGENT_ID.test(id)) throw new HttpError(502, "ElevenLabs returned no agent id");
  return id;
}

/** The parts of GET /v1/convai/conversations/{id} the live room reads. */
export interface LabsConversation {
  agent_id?: string;
  /** "initiated" | "in-progress" | "processing" | "done" | "failed" */
  status: string;
  metadata?: { start_time_unix_secs?: number };
  transcript: { role?: string; message?: string | null; time_in_call_secs?: number }[];
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
    const res = await this.call(
      "POST",
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
    const res = await this.call("POST", "/speech-to-text", {}, form, STT_TIMEOUT_MS, "transcription");
    const data = (await res.json().catch(() => null)) as { text?: unknown; language_code?: unknown } | null;
    if (!data || typeof data.text !== "string") throw new HttpError(502, "ElevenLabs returned no transcript");
    const text = data.text.trim();
    if (!text) this.log(`elevenlabs: empty transcript for ${audio.byteLength} bytes of ${contentType} (language ${String(data.language_code ?? "unknown")})`);
    return text;
  }

  /** Creates a Conversational AI agent; returns its id. */
  async createAgent(config: object): Promise<string> {
    const res = await this.call("POST", "/convai/agents/create", JSON_HEADERS, JSON.stringify(config), CONVAI_TIMEOUT_MS, "agent setup");
    return agentId((await res.json().catch(() => null)) as { agent_id?: unknown } | null);
  }

  /** Replaces an agent's configuration; 404 (HttpError) when the agent no longer exists. */
  async updateAgent(id: string, config: object): Promise<void> {
    await this.call("PATCH", `/convai/agents/${encodeURIComponent(id)}`, JSON_HEADERS, JSON.stringify(config), CONVAI_TIMEOUT_MS, "agent setup");
  }

  /** A short-lived websocket URL for one conversation with the agent; the key never appears in it. */
  async signedUrl(id: string): Promise<string> {
    const key = await this.requireKey();
    const res = await this.call("GET", `/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(id)}`, {}, undefined, CONVAI_TIMEOUT_MS, "live session");
    const data = (await res.json().catch(() => null)) as { signed_url?: unknown } | null;
    const url = data?.signed_url;
    if (typeof url !== "string" || !/^wss:\/\/[^\s]+$/.test(url) || url.includes(key)) throw new HttpError(502, "ElevenLabs returned no session URL");
    return url;
  }

  /** A conversation's details and transcript. */
  async conversation(id: string): Promise<LabsConversation> {
    const res = await this.call("GET", `/convai/conversations/${encodeURIComponent(id)}`, {}, undefined, CONVAI_TIMEOUT_MS, "conversation");
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!data || typeof data.status !== "string" || !Array.isArray(data.transcript)) throw new HttpError(502, "ElevenLabs returned no conversation");
    return data as unknown as LabsConversation;
  }

  private async requireKey(): Promise<string> {
    const key = await this.key();
    if (!key) throw new HttpError(503, NOT_CONFIGURED);
    return key;
  }

  private async call(method: string, path: string, headers: Record<string, string>, body: BodyInit | undefined, timeoutMs: number, op: Operation): Promise<Response> {
    const key = await this.requireKey();
    let res: Response;
    try {
      res = await this.fetchImpl(`${BASE}${path}`, {
        method,
        headers: { ...headers, "xi-api-key": key },
        ...(body === undefined ? {} : { body }),
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
