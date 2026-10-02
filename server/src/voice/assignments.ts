import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LEADERSHIP_SEATS } from "../../../shared/leadership";
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

/**
 * Stock premade voices for the leadership room's seats (the CEO agent keeps the chair's voice), distinct from each
 * other and from the board's. Premade voices work in agents; library voices with live moderation are refused.
 */
export const LEADERSHIP_STOCK_VOICES: Readonly<Record<string, string>> = {
  "zain-hq-coo": "CwhRBWXzGAHq8TQ4Fs17", // Roger
  "zain-studio-vp": "EXAVITQu4vr4xnSDxMaL", // Sarah
  "zain-growth-vp": "cjVigY5qzO86Huf0OWal", // Eric
  "zain-labs-vp": "XrExE9yKIg1WjnnlVkGX", // Matilda
  "zain-tech-vp": "iP95p4xoKVk53GoZ742B", // Chris
};

/** Who can speak in a meeting: the chair, every board seat in roster order, then the leadership room's executives. */
export function speakers(roster: readonly RosterAgent[]): string[] {
  const board = boardMembers(roster).map((a) => a.profile);
  return [CHAIR_PROFILE, ...board, ...LEADERSHIP_SEATS.filter((p) => p !== CHAIR_PROFILE && !board.includes(p))];
}

/** A stable stock voice: an executive's own stock voice, else by seat order, so the first six speakers all sound different. */
export function fallbackVoice(profile: string, seats: readonly string[]): string {
  const exec = LEADERSHIP_STOCK_VOICES[profile];
  if (exec) return exec;
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
