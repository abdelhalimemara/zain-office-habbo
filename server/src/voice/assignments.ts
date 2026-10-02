import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { boardMembers, type RosterAgent } from "../../../shared/roster";
import { CHAIR_PROFILE, VOICE_ID_PATTERN } from "../../../shared/voice";

/** Stock premade ElevenLabs voices, used by speakers without a voice of their own. */
export const STOCK_VOICES = [
  "JBFqnCBsd6RMkjVDRZzb", // George
  "pNInz6obpgDQGcFmaJgB", // Adam
  "onwK4e9ZLuTAKqWW03F9", // Daniel
  "nPczCjzI2devNBz1zQrb", // Brian
  "TX3LPaxmHKxFdv7VOQHJ", // Liam
  "pqHfZKP75CvOlQylNhV4", // Bill
] as const;

/** Who can speak in a meeting: the chair, then every board seat in roster order. */
export function speakers(roster: readonly RosterAgent[]): string[] {
  return [CHAIR_PROFILE, ...boardMembers(roster).map((a) => a.profile)];
}

/** A stable stock voice: by seat order, so the first six speakers all sound different. */
export function fallbackVoice(profile: string, seats: readonly string[]): string {
  const seat = seats.indexOf(profile);
  const n = seat >= 0 ? seat : createHash("sha256").update(profile).digest().readUInt32BE(0);
  return STOCK_VOICES[n % STOCK_VOICES.length]!;
}

/** Speaker profile → the member's own ElevenLabs voice id. */
export type VoiceMap = Record<string, string>;

export interface VoiceStore {
  read(): Promise<VoiceMap>;
  /** Sets (or with null clears) one speaker's voice; returns the updated map. */
  set(profile: string, voiceId: string | null): Promise<VoiceMap>;
}

function clean(data: unknown): VoiceMap {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return Object.fromEntries(Object.entries(data).filter((e): e is [string, string] => typeof e[1] === "string" && VOICE_ID_PATTERN.test(e[1])));
}

function update(map: VoiceMap, profile: string, voiceId: string | null): VoiceMap {
  const next = { ...map };
  if (voiceId === null) delete next[profile];
  else next[profile] = voiceId;
  return next;
}

export function memoryVoiceStore(initial: VoiceMap = {}): VoiceStore {
  let map = { ...initial };
  return {
    read: async () => ({ ...map }),
    set: async (profile, voiceId) => {
      map = update(map, profile, voiceId);
      return { ...map };
    },
  };
}

/** Voice assignments persisted to `<root>/.zain/voices.json`; writes are serialized. */
export function fileVoiceStore(root: string): VoiceStore {
  const file = join(root, ".zain", "voices.json");

  async function read(): Promise<VoiceMap> {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
    return clean(JSON.parse(raw));
  }

  let queue: Promise<unknown> = Promise.resolve();
  return {
    read,
    set: (profile, voiceId) => {
      const write = queue.then(async () => {
        const next = update(await read(), profile, voiceId);
        await mkdir(dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
        await rename(tmp, file);
        return next;
      });
      queue = write.catch(() => undefined);
      return write;
    },
  };
}
