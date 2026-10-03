import type { BoardMeeting, MeetingTurn } from "../../../shared/meetings";
import { splitBySpeaker, type EndLiveRequest, type LiveSessionResponse, type LiveSpeaker } from "../../../shared/voice";
import { boardLedger } from "../board/memory/ledger";
import type { MemoryStore } from "../board/memory/notes";
import type { DashboardReader } from "../board/memory/dashboard";
import type { MeetingEngine } from "../board/meetings/engine";
import { FOUNDER } from "../board/meetings/rounds";
import { HttpError, badRequest } from "../http";
import { isLeadership, leadershipSpeakers } from "../leadership/seats";
import type { BriefReader } from "../org/privateBriefs";
import type { ElevenLabsClient, LabsConversation } from "./elevenlabs";
import type { BoardRoomAgent } from "./liveAgent";
import { LIVE_FIRST_MESSAGE, livePrompt, liveSpeakers, type SoulReader } from "./livePrompt";
import type { VoiceService } from "./service";

export const CONVERSATION_ID = /^conv_[A-Za-z0-9]{8,64}$/;
/** Conversation states in which the call is still connected and the transcript may grow. */
const STILL_CONNECTED = new Set(["initiated", "in-progress"]);
const ATTEMPTS = 8;
/** ElevenLabs can report "processing" with an empty transcript for a while after a long call: wait up to a minute. */
const PROCESSING_ATTEMPTS = 40;
const RETRY_MS = 1500;

export type EndLive = Required<EndLiveRequest>;

export function parseEndLive(body: Record<string, unknown>): EndLive {
  const { conversationId, final } = body;
  if (typeof conversationId !== "string" || !CONVERSATION_ID.test(conversationId)) throw badRequest("conversationId must be an ElevenLabs conversation id");
  if (final !== undefined && typeof final !== "boolean") throw badRequest("final must be a boolean");
  return { conversationId, final: final ?? true };
}

/**
 * The founder's and the agent's messages as meeting turns; agent messages are split by voice tag.
 * Untagged text that opens a message goes to the member who spoke last, or is dropped when no one has yet.
 */
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
        const profile = speakers.find((s) => s.tag === part.tag)?.profile ?? [...turns].reverse().find((t) => t.speaker !== FOUNDER)?.speaker;
        if (profile) push(profile, part.text, at);
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
  /** Members' notes from earlier meetings, shown to the room after the privacy guard. */
  memory?: MemoryStore;
  /** The company dashboard, shown to the room after the privacy guard. */
  dashboard?: DashboardReader;
  /** The leadership (VP) room: its own agent, and the prompt for a meeting; leadership sessions answer 503 without it. */
  leadership?: { agent: BoardRoomAgent; prompt: (meeting: BoardMeeting) => Promise<string> };
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

  private async dashboard(): Promise<string | null> {
    return (await this.options.dashboard?.().catch(() => null)) ?? null;
  }

  constructor(private readonly options: LiveServiceOptions) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async session(meetingId: string): Promise<LiveSessionResponse> {
    const meeting = live(await this.options.meetings.get(meetingId));
    if (isLeadership(meeting)) return this.leadershipSession(meeting);
    const { voices } = await this.options.voice.voices();
    const agentId = await this.options.agent.ensure(voices);
    const signedUrl = await this.options.client.signedUrl(agentId);
    const speakers = liveSpeakers(meeting);
    const ledger = boardLedger((await this.options.meetings.list()).filter((m) => m.id !== meeting.id));
    // Every brief whose owner appears in the room or the ledger, so the guard can keep all of them out.
    const guarded = [...new Set([...meeting.members, ...ledger.flatMap((e) => e.votes.map((v) => v.member))])];
    const read = <T>(profiles: readonly string[], reader: (p: string) => Promise<T>) =>
      Promise.all(profiles.map(async (p) => [p, await reader(p).catch(() => null)] as const)).then((e) => Object.fromEntries(e) as Record<string, T | null>);
    const [souls, briefs, notes] = await Promise.all([
      read(meeting.members, this.options.souls),
      read(guarded, this.options.briefs),
      read(meeting.members, (p) => this.options.memory?.notes(p) ?? Promise.resolve([])),
    ]);
    const memory = Object.fromEntries(Object.entries(notes).map(([p, n]) => [p, n ?? []]));
    return {
      signedUrl,
      overrides: { agent: { prompt: { prompt: livePrompt({ meeting, speakers, souls, briefs, ledger, notes: memory, dashboard: await this.dashboard() }) }, firstMessage: LIVE_FIRST_MESSAGE, language: "en" } },
      speakers,
    };
  }

  private async leadershipSession(meeting: BoardMeeting): Promise<LiveSessionResponse> {
    const room = this.leadershipRoom();
    const { voices } = await this.options.voice.voices();
    const agentId = await room.agent.ensure(voices);
    const signedUrl = await this.options.client.signedUrl(agentId);
    const prompt = await room.prompt(meeting);
    return { signedUrl, overrides: { agent: { prompt: { prompt }, firstMessage: LIVE_FIRST_MESSAGE, language: "en" } }, speakers: leadershipSpeakers(meeting) };
  }

  private leadershipRoom(): NonNullable<LiveServiceOptions["leadership"]> {
    if (!this.options.leadership) throw new HttpError(503, "the leadership room is not set up on this server");
    return this.options.leadership;
  }

  /** Records a session's transcript once per conversation id; `final` moves the meeting on (board: the vote; leadership: drafting the actions). */
  end(meetingId: string, { conversationId, final }: EndLive): Promise<BoardMeeting> {
    return this.locked(meetingId, async () => {
      const meeting = await this.options.meetings.get(meetingId);
      if (meeting.mode !== "voice") throw new HttpError(409, `meeting ${meetingId} is not a voice meeting`);
      const known = meeting.liveConversationIds?.includes(conversationId) ?? false;
      if (known || meeting.status !== "live") return this.options.meetings.recordLive(meetingId, conversationId, [], final);
      const leadership = isLeadership(meeting);
      const conversation = await this.finished(conversationId, leadership ? this.leadershipRoom().agent : this.options.agent);
      const speakers = leadership ? leadershipSpeakers(meeting) : liveSpeakers(meeting);
      const turns = transcriptTurns(conversation, speakers, meeting.currentRound, this.now());
      return this.options.meetings.recordLive(meetingId, conversationId, turns, final);
    });
  }

  /**
   * Leadership meetings that reached review without a usable transcript (e.g. it was still being processed when the
   * call ended): re-reads every session's transcript from ElevenLabs and drafts the action items again.
   */
  rebuild(meetingId: string): Promise<BoardMeeting> {
    return this.locked(meetingId, async () => {
      const meeting = await this.options.meetings.get(meetingId);
      if (!isLeadership(meeting)) throw new HttpError(409, `meeting ${meetingId} is not a leadership meeting`);
      const ids = meeting.liveConversationIds ?? [];
      if (ids.length === 0) throw new HttpError(409, `meeting ${meetingId} has no recorded live session`);
      const speakers = leadershipSpeakers(meeting);
      const turns: MeetingTurn[] = [];
      for (const id of ids) turns.push(...transcriptTurns(await this.finished(id, this.leadershipRoom().agent), speakers, meeting.currentRound, this.now()));
      if (turns.length === 0) throw new HttpError(409, "the recorded sessions have no transcript yet");
      return this.options.meetings.redraft(meetingId, turns);
    });
  }

  /** Pushes changed voice assignments to the room agents that exist. */
  async refreshVoices(): Promise<void> {
    const { voices } = await this.options.voice.voices();
    await this.options.agent.refresh(voices);
    await this.options.leadership?.agent.refresh(voices);
  }

  /** The conversation once the call has ended; it may still be "processing", which already has the full transcript. */
  private async finished(conversationId: string, agent: BoardRoomAgent): Promise<LabsConversation> {
    const agentId = await agent.agentId();
    for (let attempt = 1; ; attempt++) {
      const conversation = await this.options.client.conversation(conversationId);
      if (!agentId || conversation.agent_id !== agentId) throw badRequest(`this conversation is not from the ${agent.room.name}`);
      const transcribing = conversation.status === "processing" && !hasWords(conversation);
      if (!STILL_CONNECTED.has(conversation.status) && !transcribing) return conversation;
      if (transcribing && attempt >= PROCESSING_ATTEMPTS) throw new HttpError(409, "ElevenLabs is still processing the transcript; try again in a minute");
      if (!transcribing && attempt >= ATTEMPTS) throw new HttpError(409, "the live session is still connected; end it first");
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

function hasWords(conversation: LabsConversation): boolean {
  return conversation.transcript.some((e) => typeof e.message === "string" && e.message.trim() !== "");
}
