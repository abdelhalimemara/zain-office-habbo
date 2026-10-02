import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CHAIR_PROFILE, type VoiceAssignment } from "../../../shared/voice";
import { speakerName } from "../board/meetings/rounds";
import { execName, isLeadershipSeat, leadershipTag } from "../leadership/seats";
import { HttpError } from "../http";
import { AGENT_ID, type ElevenLabsClient } from "./elevenlabs";

export const AGENT_NAME = "Zain Board Room";
export const LEADERSHIP_AGENT_NAME = "Zain Leadership Room";
/** English agents speak with a v2 model; the Arabic preset switches the call to v2.5 multilingual. */
export const LIVE_TTS_MODEL = "eleven_flash_v2";
/** Fast, follows the tagging rules well and plays several characters convincingly. */
export const LIVE_LLM = "claude-haiku-4-5";
/** ElevenLabs allows at most 10 voices per agent, the default included. */
const MAX_VOICES = 10;
/** Seconds of founder silence before the board carries on talking among themselves. */
export const TURN_TIMEOUT_SECONDS = 6;
const MAX_DURATION_SECONDS = 3600;

/** Multi-voice label for a board member: letters only, e.g. zain-board-hormozi → Hormozi. The CEO's office and the executives have none. */
export function speakerTag(profile: string): string {
  if (profile === CHAIR_PROFILE || isLeadershipSeat(profile)) return "";
  const last = profile.split("-").filter(Boolean).at(-1) ?? "";
  const letters = last.replace(/[^A-Za-z]/g, "");
  return letters ? letters[0]!.toUpperCase() + letters.slice(1).toLowerCase() : "";
}

/** One live room on its own ElevenLabs agent: who has a voice label in it, and where its agent id is kept. */
export interface LiveRoom {
  /** Key in .zain/elevenlabs.json. */
  key: string;
  name: string;
  /** The base prompt; every session replaces it with the meeting's own prompt (platform_settings.overrides). */
  basePrompt: string;
  /** Voice label for a profile; "" leaves the profile out of the room. */
  tag: (profile: string) => string;
  speakerName: (profile: string) => string;
}

export const BOARD_ROOM: LiveRoom = {
  key: "boardRoom",
  name: AGENT_NAME,
  basePrompt:
    "You voice the members of Zain Group's board of advisors in live board meetings. Each session supplies the meeting's prompt; without one, say only that the meeting has not been set up.",
  tag: speakerTag,
  speakerName,
};

export const LEADERSHIP_ROOM: LiveRoom = {
  key: "leadershipRoom",
  name: LEADERSHIP_AGENT_NAME,
  basePrompt:
    "You voice Zain Group's executives (Susu the CEO agent, the COO and the division VPs) in the founder's weekly priorities meeting. Each session supplies the meeting's prompt; without one, say only that the meeting has not been set up.",
  tag: leadershipTag,
  speakerName: execName,
};

/**
 * A live room agent's full configuration, built from the current voice assignments. Only the room's members get a
 * voice label (in the board room the CEO only takes the minutes); the first member's voice is the default for any
 * stray untagged text. The first message is empty, so the agent waits for the founder to open.
 */
export function agentConfig(voices: readonly VoiceAssignment[], room: LiveRoom = BOARD_ROOM): Record<string, unknown> {
  const fallback = voices.find((v) => room.tag(v.profile));
  const seen = new Set<string>();
  const supported = voices
    .map((v) => ({ tag: room.tag(v.profile), v }))
    .filter(({ tag }) => tag && !seen.has(tag) && seen.add(tag))
    .slice(0, MAX_VOICES)
    .map(({ tag, v }) => {
      const name = room.speakerName(v.profile);
      return { label: tag, voice_id: v.voiceId, description: `${name}: every line ${name} says.` };
    });
  return {
    name: room.name,
    tags: ["zain-hq"],
    conversation_config: {
      agent: {
        first_message: "",
        language: "en",
        prompt: {
          prompt: room.basePrompt,
          llm: LIVE_LLM,
          temperature: 0.8,
          built_in_tools: {
            language_detection: { type: "system", name: "language_detection", description: "", params: { system_tool_type: "language_detection" } },
          },
        },
      },
      language_presets: { ar: { overrides: { agent: { first_message: "" } } } },
      tts: { model_id: LIVE_TTS_MODEL, ...(fallback ? { voice_id: fallback.voiceId } : {}), supported_voices: supported },
      turn: { turn_timeout: TURN_TIMEOUT_SECONDS, turn_eagerness: "normal", silence_end_call_timeout: -1 },
      conversation: {
        max_duration_seconds: MAX_DURATION_SECONDS,
        // "interruption" keeps barge-in on: the founder can cut the board off mid-sentence.
        client_events: ["audio", "interruption", "agent_response", "user_transcript", "agent_response_correction"],
      },
    },
    platform_settings: {
      // Only signed URLs from this server can start a conversation.
      auth: { enable_auth: true },
      overrides: { conversation_config_override: { agent: { prompt: { prompt: true }, first_message: true, language: true } } },
    },
  };
}

export interface AgentRecord {
  agentId: string;
  /** Hash of the configuration last sent, so unchanged voices cost no API call. */
  configHash: string;
}

export interface AgentStore {
  read(): Promise<AgentRecord | null>;
  write(record: AgentRecord): Promise<void>;
}

export function memoryAgentStore(initial: AgentRecord | null = null): AgentStore {
  let record = initial;
  return { read: async () => record, write: async (r) => void (record = r) };
}

/** Writes to one agents file, serialized across every store that shares it. */
const fileQueues = new Map<string, Promise<unknown>>();

async function readAgents(file: string): Promise<Record<string, unknown>> {
  try {
    const data: unknown = JSON.parse(await readFile(file, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A room's agent id, kept under its own key in `<root>/.zain/elevenlabs.json`; other rooms' entries are left as they are. */
export function fileAgentStore(root: string, key = BOARD_ROOM.key): AgentStore {
  const file = join(root, ".zain", "elevenlabs.json");
  return {
    async read() {
      const r = (await readAgents(file))[key] as Partial<AgentRecord> | undefined;
      return r && typeof r.agentId === "string" && AGENT_ID.test(r.agentId) && typeof r.configHash === "string" ? (r as AgentRecord) : null;
    },
    write(record) {
      const run = (fileQueues.get(file) ?? Promise.resolve()).then(async () => {
        const next = { ...(await readAgents(file)), [key]: record };
        await mkdir(dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
        await rename(tmp, file);
      });
      fileQueues.set(file, run.catch(() => undefined));
      return run;
    },
  };
}

const hashOf = (config: unknown) => createHash("sha256").update(JSON.stringify(config)).digest("hex");

/** Creates a live room's agent on first use and keeps its voices in step with the assignments. Calls are serialized. */
export class BoardRoomAgent {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly client: ElevenLabsClient,
    private readonly store: AgentStore,
    private readonly log: (line: string) => void = console.warn,
    readonly room: LiveRoom = BOARD_ROOM,
  ) {}

  /** The agent id, after creating the agent or updating a stale configuration. */
  ensure(voices: readonly VoiceAssignment[]): Promise<string> {
    return this.serialized(() => this.sync(voices, true)) as Promise<string>;
  }

  /** Pushes changed voices to an agent that already exists; never creates one. */
  refresh(voices: readonly VoiceAssignment[]): Promise<void> {
    return this.serialized(() => this.sync(voices, false)).then(() => undefined);
  }

  /** The stored agent id, if the agent has been created. */
  async agentId(): Promise<string | null> {
    return (await this.store.read())?.agentId ?? null;
  }

  private serialized<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async sync(voices: readonly VoiceAssignment[], create: boolean): Promise<string | null> {
    const config = agentConfig(voices, this.room);
    const configHash = hashOf(config);
    const saved = await this.store.read();
    if (saved && saved.configHash === configHash) return saved.agentId;
    if (saved) {
      try {
        await this.client.updateAgent(saved.agentId, config);
        await this.store.write({ agentId: saved.agentId, configHash });
        this.log(`voice: updated the ${this.room.name} agent`);
        return saved.agentId;
      } catch (err) {
        if (!(err instanceof HttpError && err.status === 404)) throw err;
        this.log(`voice: the ${this.room.name} agent is gone; creating a new one`);
      }
    }
    if (!create) return null;
    const agentId = await this.client.createAgent(config);
    await this.store.write({ agentId, configHash });
    this.log(`voice: created the ${this.room.name} agent (${agentId})`);
    return agentId;
  }
}
