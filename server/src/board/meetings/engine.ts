import { randomBytes } from "node:crypto";
import { dashboardSection, HERMES_DASHBOARD_CHARS, type DashboardReader } from "../memory/dashboard";
import { MAX_DISCUSSION_ROUNDS, type BoardMeeting, type FounderRemarkRequest, type MeetingTurn, type MeetingVote } from "../../../../shared/meetings";
import type { KanbanTask } from "../../../../shared/hermes";
import { CEO_PROFILE } from "../../../../shared/roster";
import type { HermesClient } from "../../hermes/client";
import { HttpError } from "../../http";
import { hiredBoardMembers } from "../../org/consult";
import type { HireStore } from "../../org/hireStore";
import type { CeoWake } from "../../telegram/ceoWake";
import { boardLedger, memorySection } from "../memory/ledger";
import { splitMemory, type MemoryStore } from "../memory/notes";
import type { RecordStore } from "../recordStore";
import { checkDrafting, startDrafting, type DraftingContext } from "../../leadership/drafting";
import {
  FOUNDER,
  MEETING_TITLE_PREFIX,
  decide,
  marker,
  minutesTaskBody,
  parseVote,
  roundKind,
  roundLabel,
  roundTaskBody,
  speakerName,
} from "./rounds";
import type { MeetingRequest } from "./validate";

export const STUCK_AFTER_SECONDS = 30 * 60;
const HQ_TENANT = "zain-hq";
const OPEN = new Set(["in-round", "voting", "minutes"]);

export interface RoundState {
  round: number;
  startedAt: number;
  /** member profile → kanban task id */
  tasks: Record<string, string>;
}

export interface StoredMeeting {
  id: string;
  meeting: BoardMeeting;
  rounds: RoundState[];
  minutes?: { taskId?: string; startedAt: number };
  /** Leadership meetings: the CEO agent's task drafting the action items. */
  drafting?: { taskId?: string; startedAt: number };
  notionPageId?: string;
  notionDirty?: boolean;
}

/** Mirrors a meeting somewhere (Notion); returns where it lives. Errors are reported, never thrown upward. */
export interface MeetingSink {
  syncMeeting(meeting: BoardMeeting, pageId: string | undefined): Promise<{ pageId: string; url: string }>;
}

export interface MeetingEngineDeps {
  hermes: HermesClient;
  hires: HireStore;
  ceoWake: CeoWake;
  store: RecordStore<StoredMeeting>;
  sink?: MeetingSink;
  /** Board memory: members' notes go into their prompts, and their votes' MEMORY blocks are kept. */
  memory?: MemoryStore;
  /** The company dashboard: its numbers go into every round's prompt. */
  dashboard?: DashboardReader;
  now?: () => number;
  log?: (line: string) => void;
  newId?: () => string;
  /** Told when board turns from index `from` on are recorded (e.g. to prefetch their audio); must not throw. */
  onTurns?: (meeting: BoardMeeting, from: number) => void;
}

const taskTitle = (meeting: BoardMeeting, label: string) => `${MEETING_TITLE_PREFIX}${meeting.topic} · ${label}`;

export class MeetingEngine {
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(private readonly deps: MeetingEngineDeps) {
    this.now = deps.now ?? (() => Math.floor(Date.now() / 1000));
    this.log = deps.log ?? console.log;
  }

  async list(): Promise<BoardMeeting[]> {
    return (await this.deps.store.list()).map((s) => s.meeting).sort((a, b) => b.createdAt - a.createdAt);
  }

  async get(id: string): Promise<BoardMeeting> {
    return (await this.load(id)).meeting;
  }

  /** The stored record, for services that manage their own kind of meeting (leadership/service.ts). */
  async stored(id: string): Promise<StoredMeeting> {
    return this.load(id);
  }

  /** Saves a record; `sync` false skips the Notion mirror (for a series of saves that ends with a synced one). */
  async persist(stored: StoredMeeting, sync = true): Promise<void> {
    if (sync) return this.save(stored);
    stored.meeting.updatedAt = this.now();
    stored.notionDirty = true;
    await this.deps.store.put(stored);
  }

  newMeetingId(): string {
    return this.deps.newId?.() ?? `mtg_${randomBytes(5).toString("hex")}`;
  }

  async start(req: MeetingRequest): Promise<BoardMeeting> {
    const members = await hiredBoardMembers(req.members, this.deps);
    const at = this.now();
    const meeting: BoardMeeting = {
      id: this.newMeetingId(),
      topic: req.topic,
      brief: req.brief,
      members,
      mode: req.mode ?? "chat",
      boardOnly: req.boardOnly ?? false,
      discussionRounds: req.discussionRounds ?? 1,
      status: "in-round",
      currentRound: 0,
      turns: [],
      votes: [],
      requestedBy: req.requestedBy,
      createdAt: at,
      updatedAt: at,
      ...(req.relatedTaskId ? { relatedTaskId: req.relatedTaskId } : {}),
    };
    const stored: StoredMeeting = { id: meeting.id, meeting, rounds: [] };
    if (meeting.mode === "voice") {
      // The live room is round 1; no written opening round.
      meeting.status = "live";
      meeting.currentRound = 1;
      meeting.liveConversationIds = [];
      await this.save(stored);
      return stored.meeting;
    }
    await this.startRound(stored, 1, []);
    return stored.meeting;
  }

  /**
   * Appends a live session's transcript once per conversation id; `final` then sends the meeting to the vote.
   * A conversation already recorded adds nothing, so repeating the call is harmless.
   */
  async recordLive(id: string, conversationId: string, turns: readonly MeetingTurn[], final: boolean): Promise<BoardMeeting> {
    const stored = await this.load(id);
    const m = stored.meeting;
    const known = m.liveConversationIds?.includes(conversationId) ?? false;
    if (m.status !== "live") {
      if (known) return m;
      throw new HttpError(409, `meeting ${id} is ${m.status}, not live`);
    }
    if (!known) {
      m.liveConversationIds = [...(m.liveConversationIds ?? []), conversationId];
      // Not recordTurns: these were already spoken in the room, so there is no audio to prefetch.
      m.turns.push(...turns);
    }
    if (!final) {
      await this.save(stored);
      return m;
    }
    if (m.kind === "leadership") {
      // No vote: the CEO agent drafts the action items for the founder to review.
      await startDrafting(stored, this.drafting);
      return stored.meeting;
    }
    m.discussionRounds = m.currentRound - 1;
    await this.startRound(stored, m.currentRound + 1, []);
    return stored.meeting;
  }

  /** A leadership meeting in review gets its transcript replaced and the action items drafted again (nothing assigned yet). */
  async redraft(id: string, turns: readonly MeetingTurn[]): Promise<BoardMeeting> {
    const stored = await this.load(id);
    const m = stored.meeting;
    if (m.kind !== "leadership" || m.status !== "review") throw new HttpError(409, `meeting ${id} is ${m.status}; only a leadership meeting in review can be redrafted`);
    if (m.outcome?.actions.some((a) => a.status === "assigned")) throw new HttpError(409, `meeting ${id} already has assigned actions`);
    m.turns = [...turns];
    delete m.outcome;
    await startDrafting(stored, this.drafting);
    return stored.meeting;
  }

  async remark(id: string, { text, next }: Required<FounderRemarkRequest>): Promise<BoardMeeting> {
    const stored = await this.load(id);
    const m = stored.meeting;
    if (m.status !== "awaiting-founder") throw new HttpError(409, `meeting ${id} is ${m.status}, not waiting for founder remarks`);
    if (next === "extra-round" && m.discussionRounds >= MAX_DISCUSSION_ROUNDS) {
      throw new HttpError(409, `meetings have at most ${MAX_DISCUSSION_ROUNDS} discussion rounds`);
    }
    m.turns.push({ round: m.currentRound, kind: roundKind(m.currentRound, m.discussionRounds), speaker: FOUNDER, text, at: this.now() });
    if (next === "extra-round") m.discussionRounds += 1;
    if (next === "to-vote") m.discussionRounds = m.currentRound - 1;
    await this.startRound(stored, m.currentRound + 1, (await this.deps.hermes.board().catch(() => null))?.columns.flatMap((c) => c.tasks) ?? []);
    return stored.meeting;
  }

  async cancel(id: string): Promise<BoardMeeting> {
    const stored = await this.load(id);
    const m = stored.meeting;
    if (m.status === "concluded" || m.status === "cancelled" || m.status === "assigned") throw new HttpError(409, `meeting ${id} is already ${m.status}`);
    const open = [
      ...Object.values(stored.rounds.at(-1)?.tasks ?? {}),
      ...(stored.minutes?.taskId ? [stored.minutes.taskId] : []),
      ...(m.status === "drafting" && stored.drafting?.taskId ? [stored.drafting.taskId] : []),
    ];
    for (const taskId of open) await this.deps.hermes.updateTask(taskId, { status: "archived" }).catch(() => undefined);
    m.status = "cancelled";
    await this.save(stored);
    return m;
  }

  /** One reconciliation pass over open meetings, plus Notion retries. Never throws. */
  async tick(): Promise<void> {
    let stored: StoredMeeting[];
    let board: KanbanTask[];
    try {
      stored = await this.deps.store.list();
      if (!stored.some((s) => OPEN.has(s.meeting.status) || s.meeting.status === "drafting" || s.notionDirty)) return;
      board = (await this.deps.hermes.board()).columns.flatMap((c) => c.tasks);
    } catch (err) {
      this.log(`meetings: tick failed (${err instanceof Error ? err.message : "error"})`);
      return;
    }
    for (const s of stored) {
      try {
        if (s.meeting.status === "minutes") await this.checkMinutes(s, board);
        else if (s.meeting.status === "drafting") await checkDrafting(s, board, this.drafting);
        else if (OPEN.has(s.meeting.status)) await this.checkRound(s, board);
        // Reloaded: a request may have changed the meeting since the list was read.
        if (s.notionDirty) await this.sync((await this.deps.store.get(s.id)) ?? s);
      } catch (err) {
        this.log(`meetings: ${s.id} failed (${err instanceof Error ? err.message : "error"})`);
      }
    }
  }

  private get drafting(): DraftingContext {
    return { hermes: this.deps.hermes, now: this.now, log: this.log, put: (s) => this.deps.store.put(s), save: (s) => this.save(s) };
  }

  private async load(id: string): Promise<StoredMeeting> {
    const stored = await this.deps.store.get(id);
    if (!stored) throw new HttpError(404, `meeting ${id} not found`);
    return stored;
  }

  private async save(stored: StoredMeeting): Promise<void> {
    stored.meeting.updatedAt = this.now();
    stored.notionDirty = true;
    await this.deps.store.put(stored);
    await this.sync(stored);
  }

  private async sync(stored: StoredMeeting): Promise<void> {
    if (!this.deps.sink) return;
    try {
      const { pageId, url } = await this.deps.sink.syncMeeting(stored.meeting, stored.notionPageId);
      stored.notionPageId = pageId;
      stored.meeting.notionPageUrl = url;
      delete stored.meeting.notionSyncError;
      stored.notionDirty = false;
    } catch (err) {
      stored.meeting.notionSyncError = (err instanceof Error ? err.message : "Notion sync failed").slice(0, 200);
      this.log(`meetings: Notion sync for ${stored.id} failed; retrying next tick`);
    }
    // A request that saved the meeting during the Notion call wins; it keeps only the sync's outcome.
    const fresh = await this.deps.store.get(stored.id);
    if (fresh && fresh.meeting.updatedAt > stored.meeting.updatedAt) {
      fresh.notionPageId = stored.notionPageId;
      if (stored.meeting.notionPageUrl) fresh.meeting.notionPageUrl = stored.meeting.notionPageUrl;
      fresh.notionDirty = true;
      return this.deps.store.put(fresh);
    }
    await this.deps.store.put(stored);
  }

  private async startRound(stored: StoredMeeting, round: number, board: readonly KanbanTask[]): Promise<void> {
    const m = stored.meeting;
    m.currentRound = round;
    m.status = roundKind(round, m.discussionRounds) === "vote" ? "voting" : "in-round";
    stored.rounds.push({ round, startedAt: this.now(), tasks: {} });
    await this.deps.store.put(stored);
    await this.ensureRoundTasks(stored, board);
    await this.save(stored);
  }

  /** Creates any missing task for the current round; tasks already on the board (by marker) are adopted. */
  private async ensureRoundTasks(stored: StoredMeeting, board: readonly KanbanTask[]): Promise<void> {
    const m = stored.meeting;
    const state = stored.rounds.at(-1)!;
    const tag = marker(m.id, state.round);
    if (m.members.every((member) => state.tasks[member])) return;
    const ledger = boardLedger((await this.deps.store.list()).map((s) => s.meeting).filter((x) => x.id !== m.id));
    const dashboard = (await this.deps.dashboard?.().catch(() => null)) ?? null;
    for (const member of m.members) {
      if (state.tasks[member]) continue;
      const existing = board.find((t) => t.assignee === member && (t.body ?? "").includes(tag));
      const task =
        existing ??
        (await this.deps.hermes.createTask({
          title: taskTitle(m, roundLabel(state.round, m.discussionRounds)),
          body: roundTaskBody(m, state.round, [...memorySection(ledger, await this.notes(member)), ...dashboardSection(dashboard, HERMES_DASHBOARD_CHARS)]),
          assignee: member,
          tenant: HQ_TENANT,
          triage: false,
        }));
      state.tasks[member] = task.id;
      await this.deps.store.put(stored);
    }
  }

  private async notes(member: string) {
    try {
      return (await this.deps.memory?.notes(member)) ?? [];
    } catch (err) {
      this.log(`meetings: memory for ${member} unavailable (${err instanceof Error ? err.message : "error"})`);
      return [];
    }
  }

  /** Keeps a vote's MEMORY insights; the vote itself never fails over memory. */
  private async remember(m: BoardMeeting, member: string, insights: readonly string[]): Promise<void> {
    if (!this.deps.memory || insights.length === 0) return;
    try {
      await this.deps.memory.add(member, { insights, at: this.now(), meetingId: m.id, meetingTopic: m.topic });
    } catch (err) {
      this.log(`meetings: could not keep ${member}'s memory (${err instanceof Error ? err.message : "error"})`);
    }
  }

  private async answer(taskId: string, board: readonly KanbanTask[]): Promise<{ done: boolean; text: string }> {
    const onBoard = board.find((t) => t.id === taskId);
    if (onBoard && onBoard.status !== "done") return { done: false, text: "" };
    const { task } = await this.deps.hermes.task(taskId);
    if (task.status !== "done") return { done: false, text: "" };
    return { done: true, text: (task.result ?? task.latest_summary ?? "").trim() || "(no answer)" };
  }

  private async checkRound(stored: StoredMeeting, board: readonly KanbanTask[]): Promise<void> {
    const m = stored.meeting;
    const state = stored.rounds.at(-1);
    if (!state) return;
    await this.ensureRoundTasks(stored, board);
    const stuck = this.now() - state.startedAt > STUCK_AFTER_SECONDS;
    const turns: MeetingTurn[] = [];
    const votes: MeetingVote[] = [];
    const insights: [string, string[]][] = [];
    const kind = roundKind(state.round, m.discussionRounds);
    for (const member of m.members) {
      const taskId = state.tasks[member]!;
      const a = await this.answer(taskId, board);
      if (!a.done && !stuck) return;
      const answer = a.done && kind === "vote" ? splitMemory(a.text) : { body: a.text, insights: [] };
      const text = a.done ? answer.body || a.text : `${speakerName(member)} did not respond.`;
      turns.push({ round: state.round, kind, speaker: member, text, at: this.now(), taskId });
      votes.push(a.done ? parseVote(member, a.text) : { member, vote: "abstain", rationale: text });
      insights.push([member, answer.insights]);
    }
    this.recordTurns(m, turns);
    if (kind === "vote") {
      for (const [member, notes] of insights) await this.remember(m, member, notes);
      m.votes = votes;
      m.decision = decide(votes);
      return this.startMinutes(stored);
    }
    if (m.boardOnly) return this.startRound(stored, state.round + 1, board);
    m.status = "awaiting-founder";
    await this.save(stored);
  }

  private recordTurns(m: BoardMeeting, turns: readonly MeetingTurn[]): void {
    const from = m.turns.length;
    m.turns.push(...turns);
    try {
      this.deps.onTurns?.(m, from);
    } catch (err) {
      this.log(`meetings: turn listener failed (${err instanceof Error ? err.message : "error"})`);
    }
  }

  private async startMinutes(stored: StoredMeeting): Promise<void> {
    const m = stored.meeting;
    m.status = "minutes";
    stored.minutes = { startedAt: this.now() };
    await this.deps.store.put(stored);
    const task = await this.deps.hermes.createTask({
      title: taskTitle(m, "Minutes"),
      body: minutesTaskBody(m),
      assignee: CEO_PROFILE,
      tenant: HQ_TENANT,
      triage: false,
    });
    stored.minutes.taskId = task.id;
    const wake = await this.deps.ceoWake.subscribe(task.id);
    if (!wake.subscribed) this.log(`meetings: minutes ${task.id} will not wake the CEO (${wake.reason ?? "unknown"})`);
    await this.save(stored);
  }

  private async checkMinutes(stored: StoredMeeting, board: readonly KanbanTask[]): Promise<void> {
    const m = stored.meeting;
    if (!stored.minutes?.taskId) {
      const tag = marker(m.id, "minutes");
      const existing = board.find((t) => t.assignee === CEO_PROFILE && (t.body ?? "").includes(tag));
      if (!existing) return this.startMinutes(stored);
      stored.minutes = { startedAt: stored.minutes?.startedAt ?? this.now(), taskId: existing.id };
    }
    const a = await this.answer(stored.minutes.taskId!, board);
    if (!a?.done) return;
    m.conclusion = a.text;
    this.recordTurns(m, [{ round: m.currentRound, kind: "vote", speaker: CEO_PROFILE, text: a.text, at: this.now(), taskId: stored.minutes.taskId }]);
    m.status = "concluded";
    await this.save(stored);
  }
}

export function isStoredMeeting(v: unknown): v is StoredMeeting {
  const s = v as StoredMeeting;
  return !!s && typeof s.id === "string" && !!s.meeting && Array.isArray(s.rounds);
}
