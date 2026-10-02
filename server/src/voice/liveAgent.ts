import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CHAIR_PROFILE, type VoiceAssignment } from "../../../shared/voice";
import { speakerName } from "../board/meetings/rounds";
import { HttpError } from "../http";
import { AGENT_ID, type ElevenLabsClient } from "./elevenlabs";

export const AGENT_NAME = "Zain Board Room";
/** English agents speak with a v2 model; the Arabic preset switches the call to v2.5 multilingual. */
export const LIVE_TTS_MODEL = "eleven_flash_v2";
/** Fast, follows the tagging rules well and plays several characters convincingly. */
export const LIVE_LLM = "claude-haiku-4-5";
/** ElevenLabs allows at most 10 voices per agent, the default included. */
const MAX_VOICES = 10;
/** Seconds of founder silence before the board carries on talking among themselves. */
export const TURN_TIMEOUT_SECONDS = 6;
const MAX_DURATION_SECONDS = 3600;

/** The base prompt; every session replaces it with the meeting's own prompt (platform_settings.overrides). */
const BASE_PROMPT =
  "You run Zain Group's live board meetings. Each session supplies the meeting's prompt; without one, the chair greets the founder and says the meeting has not been set up.";

/** Multi-voice label for a speaker: letters only, e.g. zain-board-hormozi → Hormozi, the chair → Chair. */
export function speakerTag(profile: string): string {
  if (profile === CHAIR_PROFILE) return "Chair";
  const last = profile.split("-").filter(Boolean).at(-1) ?? "";
  const letters = last.replace(/[^A-Za-z]/g, "");
  return letters ? letters[0]!.toUpperCase() + letters.slice(1).toLowerCase() : "";
}

/** The Board Room agent's full configuration, built from the current voice assignments. */
export function agentConfig(voices: readonly VoiceAssignment[]): Record<string, unknown> {
  const chair = voices.find((v) => v.profile === CHAIR_PROFILE);
  const seen = new Set<string>();
  const supported = voices
    .map((v) => ({ tag: speakerTag(v.profile), v }))
    .filter(({ tag }) => tag && !seen.has(tag) && seen.add(tag))
    .slice(0, MAX_VOICES)
    .map(({ tag, v }) => ({ label: tag, voice_id: v.voiceId, description: `${speakerName(v.profile)}: every line ${speakerName(v.profile)} says.` }));
  return {
    name: AGENT_NAME,
    tags: ["zain-hq"],
    conversation_config: {
      agent: {
        first_message: "Welcome to the board room.",
        language: "en",
        prompt: {
          prompt: BASE_PROMPT,
          llm: LIVE_LLM,
          temperature: 0.8,
          built_in_tools: {
            language_detection: { type: "system", name: "language_detection", description: "", params: { system_tool_type: "language_detection" } },
          },
        },
      },
      language_presets: { ar: { overrides: { agent: { first_message: "أهلاً بكم في مجلس الإدارة. الكلمة مفتوحة." } } } },
      tts: { model_id: LIVE_TTS_MODEL, ...(chair ? { voice_id: chair.voiceId } : {}), supported_voices: supported },
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

/** The Board Room agent id, kept in `<root>/.zain/elevenlabs.json`. */
export function fileAgentStore(root: string): AgentStore {
  const file = join(root, ".zain", "elevenlabs.json");
  return {
    async read() {
      try {
        const data = JSON.parse(await readFile(file, "utf8")) as { boardRoom?: Partial<AgentRecord> };
        const r = data.boardRoom;
        return r && typeof r.agentId === "string" && AGENT_ID.test(r.agentId) && typeof r.configHash === "string" ? (r as AgentRecord) : null;
      } catch {
        return null;
      }
    },
    async write(record) {
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(tmp, `${JSON.stringify({ boardRoom: record }, null, 2)}\n`, "utf8");
      await rename(tmp, file);
    },
  };
}

const hashOf = (config: unknown) => createHash("sha256").update(JSON.stringify(config)).digest("hex");

/** Creates the Board Room agent on first use and keeps its voices in step with the assignments. Calls are serialized. */
export class BoardRoomAgent {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly client: ElevenLabsClient,
    private readonly store: AgentStore,
    private readonly log: (line: string) => void = console.warn,
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
    const config = agentConfig(voices);
    const configHash = hashOf(config);
    const saved = await this.store.read();
    if (saved && saved.configHash === configHash) return saved.agentId;
    if (saved) {
      try {
        await this.client.updateAgent(saved.agentId, config);
        await this.store.write({ agentId: saved.agentId, configHash });
        this.log(`voice: updated the ${AGENT_NAME} agent`);
        return saved.agentId;
      } catch (err) {
        if (!(err instanceof HttpError && err.status === 404)) throw err;
        this.log(`voice: the ${AGENT_NAME} agent is gone; creating a new one`);
      }
    }
    if (!create) return null;
    const agentId = await this.client.createAgent(config);
    await this.store.write({ agentId, configHash });
    this.log(`voice: created the ${AGENT_NAME} agent (${agentId})`);
    return agentId;
  }
}
