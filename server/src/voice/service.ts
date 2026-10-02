import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BoardMeeting } from "../../../shared/meetings";
import { ROSTER, type RosterAgent } from "../../../shared/roster";
import type { VoicesResponse } from "../../../shared/voice";
import { FOUNDER } from "../board/meetings/rounds";
import { HttpError } from "../http";
import { fallbackVoice, speakers, type VoiceStore } from "./assignments";
import { TTS_MODEL, type ElevenLabsClient } from "./elevenlabs";
import { speechText } from "./speech";

/** One spoken turn: what to say, in which voice, and the cache key for the result. */
export interface Clip {
  key: string;
  voiceId: string;
  text: string;
}

export interface VoiceServiceOptions {
  /** Server cwd; audio is cached under `<root>/.zain/voice-cache`. */
  root: string;
  client: ElevenLabsClient;
  store: VoiceStore;
  /** The roster board seats come from; ROSTER when omitted. */
  roster?: () => Promise<readonly RosterAgent[]>;
  log?: (line: string) => void;
}

export class VoiceService {
  private readonly inflight = new Map<string, Promise<Uint8Array>>();
  private readonly cacheDir: string;
  private readonly log: (line: string) => void;

  constructor(private readonly options: VoiceServiceOptions) {
    this.cacheDir = join(options.root, ".zain", "voice-cache");
    this.log = options.log ?? console.warn;
  }

  async voices(): Promise<VoicesResponse> {
    const [seats, own, configured] = await Promise.all([this.seats(), this.options.store.read(), this.options.client.configured()]);
    return {
      configured,
      voices: seats.map((profile) =>
        own[profile] ? { profile, voiceId: own[profile]!, fallback: false } : { profile, voiceId: fallbackVoice(profile, seats), fallback: true },
      ),
    };
  }

  /** `voiceId` is already validated; null goes back to the stock fallback. */
  async setVoice(profile: string, voiceId: string | null): Promise<VoicesResponse> {
    if (!(await this.seats()).includes(profile)) throw new HttpError(404, `unknown speaker: ${profile}`);
    await this.options.store.set(profile, voiceId);
    return this.voices();
  }

  /** What meeting.turns[index] sounds like; 404 for founder turns, missing turns and turns with nothing to say. */
  async clip(meeting: BoardMeeting, index: number): Promise<Clip> {
    const turn = meeting.turns[index];
    if (!turn) throw new HttpError(404, `meeting ${meeting.id} has no turn ${index}`);
    if (turn.speaker === FOUNDER) throw new HttpError(404, "founder turns have no audio");
    const text = speechText(turn.text);
    if (!text) throw new HttpError(404, "this turn has nothing to say");
    const [seats, own] = await Promise.all([this.seats(), this.options.store.read()]);
    const voiceId = own[turn.speaker] ?? fallbackVoice(turn.speaker, seats);
    const key = createHash("sha256").update(`${voiceId}\0${TTS_MODEL}\0${text}`).digest("hex");
    return { key, voiceId, text };
  }

  /** MP3 for a clip, from the disk cache when present; concurrent requests for one clip share a single synthesis. */
  async audio(clip: Clip): Promise<Uint8Array> {
    const pending = this.inflight.get(clip.key);
    if (pending) return pending;
    const job = this.cachedOrSpoken(clip).finally(() => this.inflight.delete(clip.key));
    this.inflight.set(clip.key, job);
    return job;
  }

  /** Speaks newly recorded board turns of a voice meeting ahead of playback. Fire and forget; failures are logged. */
  prefetch(meeting: BoardMeeting, from: number): void {
    if (meeting.mode !== "voice") return;
    const snapshot = { ...meeting, turns: meeting.turns.slice() };
    const indexes = snapshot.turns.map((t, i) => (i >= from && t.speaker !== FOUNDER ? i : -1)).filter((i) => i >= 0);
    if (indexes.length === 0) return;
    void (async () => {
      if (!(await this.options.client.configured())) return;
      for (const i of indexes) {
        try {
          await this.audio(await this.clip(snapshot, i));
        } catch (err) {
          this.log(`voice: prefetch ${meeting.id} turn ${i} failed (${err instanceof Error ? err.message : "error"})`);
        }
      }
    })().catch(() => undefined);
  }

  transcribe(audio: Uint8Array, contentType: string): Promise<string> {
    return this.options.client.transcribe(audio, contentType);
  }

  private async seats(): Promise<string[]> {
    return speakers((await this.options.roster?.()) ?? ROSTER);
  }

  private async cachedOrSpoken(clip: Clip): Promise<Uint8Array> {
    const file = join(this.cacheDir, `${clip.key}.mp3`);
    try {
      return new Uint8Array(await readFile(file));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const audio = await this.options.client.speak(clip.voiceId, clip.text);
    try {
      await mkdir(this.cacheDir, { recursive: true });
      const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(tmp, audio);
      await rename(tmp, file);
    } catch (err) {
      this.log(`voice: could not cache audio (${err instanceof Error ? err.message : "error"})`);
    }
    return audio;
  }
}
