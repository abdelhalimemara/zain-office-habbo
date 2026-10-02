import type { BoardMeeting, MeetingTurn } from "../../../shared/meetings";
import { splitBySpeaker, type EndLiveRequest, type LiveSessionResponse, type LiveSpeaker } from "../../../shared/voice";
import type { MeetingEngine } from "../board/meetings/engine";
import { FOUNDER } from "../board/meetings/rounds";
import { HttpError, badRequest } from "../http";
import type { BriefReader } from "../org/privateBriefs";
import type { ElevenLabsClient, LabsConversation } from "./elevenlabs";
import type { BoardRoomAgent } from "./liveAgent";
import { liveFirstMessage, livePrompt, liveSpeakers, type SoulReader } from "./livePrompt";
import type { VoiceService } from "./service";

export const CONVERSATION_ID = /^conv_[A-Za-z0-9]{8,64}$/;
/** Conversation states in which the call is still connected and the transcript may grow. */
const STILL_CONNECTED = new Set(["initiated", "in-progress"]);
const ATTEMPTS = 8;
const RETRY_MS = 1500;

export type EndLive = Required<EndLiveRequest>;

export function parseEndLive(body: Record<string, unknown>): EndLive {
  const { conversationId, final } = body;
  if (typeof conversationId !== "string" || !CONVERSATION_ID.test(conversationId)) throw badRequest("conversationId must be an ElevenLabs conversation id");
  if (final !== undefined && typeof final !== "boolean") throw badRequest("final must be a boolean");
  return { conversationId, final: final ?? true };
}

/** The founder's and the agent's messages as meeting turns; agent messages are split by voice tag. */
export function transcriptTurns(conversation: LabsConversation, speakers: readonly LiveSpeaker[], round: number, now: number): MeetingTurn[] {
  const start = conversation.metadata?.start_time_unix_secs;
  const turns: MeetingTurn[] = [];
  const push = (speaker: string, text: string, at: number) => {
    const last = turns.at(-1);
    if (last && last.speaker === speaker && last.at === at) last.text = `${last.text} ${text}`;
    else turns.push({ round, kind: "discussion", speaker, text, at });
  };
  for (const entry of conversation.transcript) {
    const message = typeof entry.message === "string" ? entry.message.trim() : "";
    if (!message) continue;
    const offset = typeof entry.time_in_call_secs === "number" ? entry.time_in_call_secs : 0;
    const at = typeof start === "number" ? Math.floor(start + offset) : now;
    if (entry.role === "user") push(FOUNDER, message, at);
    else if (entry.role === "agent") {
      for (const part of splitBySpeaker(message, speakers)) {
        push(speakers.find((s) => s.tag === part.tag)?.profile ?? speakers[0]!.profile, part.text, at);
      }
    }
  }
  return turns;
}

export interface LiveServiceOptions {
  client: ElevenLabsClient;
  agent: BoardRoomAgent;
  voice: VoiceService;
  meetings: MeetingEngine;
  souls: SoulReader;
  /** Members' private briefs, read only so that none of their text reaches the prompt. */
  briefs: BriefReader;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Live voice meetings: one ElevenLabs agent voices the whole board while the founder's mic stays open.
 * Ending a session pulls its transcript from ElevenLabs into the meeting; the final end goes to the vote.
 */
export class LiveService {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: LiveServiceOptions) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async session(meetingId: string): Promise<LiveSessionResponse> {
    const meeting = live(await this.options.meetings.get(meetingId));
    const { voices } = await this.options.voice.voices();
    const agentId = await this.options.agent.ensure(voices);
    const signedUrl = await this.options.client.signedUrl(agentId);
    const speakers = liveSpeakers(meeting);
    const read = (reader: (p: string) => Promise<string | null>) =>
      Promise.all(meeting.members.map(async (p) => [p, await reader(p).catch(() => null)] as const)).then(Object.fromEntries);
    const [souls, briefs] = await Promise.all([read(this.options.souls), read(this.options.briefs)]);
    return {
      signedUrl,
      overrides: { agent: { prompt: { prompt: livePrompt({ meeting, speakers, souls, briefs }) }, firstMessage: liveFirstMessage(meeting), language: "en" } },
      speakers,
    };
  }

  /** Records a session's transcript once per conversation id; `final` moves the meeting to the vote. */
  end(meetingId: string, { conversationId, final }: EndLive): Promise<BoardMeeting> {
    return this.locked(meetingId, async () => {
      const meeting = await this.options.meetings.get(meetingId);
      if (meeting.mode !== "voice") throw new HttpError(409, `meeting ${meetingId} is not a voice meeting`);
      const known = meeting.liveConversationIds?.includes(conversationId) ?? false;
      if (known || meeting.status !== "live") return this.options.meetings.recordLive(meetingId, conversationId, [], final);
      const conversation = await this.finished(conversationId);
      const turns = transcriptTurns(conversation, liveSpeakers(meeting), meeting.currentRound, this.now());
      return this.options.meetings.recordLive(meetingId, conversationId, turns, final);
    });
  }

  /** Pushes changed voice assignments to the agent, if it exists. */
  async refreshVoices(): Promise<void> {
    await this.options.agent.refresh((await this.options.voice.voices()).voices);
  }

  /** The conversation once the call has ended; it may still be "processing", which already has the full transcript. */
  private async finished(conversationId: string): Promise<LabsConversation> {
    const agentId = await this.options.agent.agentId();
    for (let attempt = 1; ; attempt++) {
      const conversation = await this.options.client.conversation(conversationId);
      if (!agentId || conversation.agent_id !== agentId) throw badRequest("this conversation is not from the board room");
      if (!STILL_CONNECTED.has(conversation.status)) return conversation;
      if (attempt >= ATTEMPTS) throw new HttpError(409, "the live session is still connected; end it first");
      await this.sleep(RETRY_MS);
    }
  }

  private locked<T>(key: string, job: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(key) ?? Promise.resolve()).then(job);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    void tail.then(() => this.locks.get(key) === tail && this.locks.delete(key));
    return run;
  }
}

function live(meeting: BoardMeeting): BoardMeeting {
  if (meeting.mode !== "voice") throw new HttpError(409, `meeting ${meeting.id} is not a voice meeting`);
  if (meeting.status !== "live") throw new HttpError(409, `meeting ${meeting.id} is ${meeting.status}, not live`);
  return meeting;
}
