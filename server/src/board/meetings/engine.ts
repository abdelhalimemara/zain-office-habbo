import { randomBytes } from "node:crypto";
import { MAX_DISCUSSION_ROUNDS, type BoardMeeting, type FounderRemarkRequest, type MeetingTurn, type MeetingVote } from "../../../../shared/meetings";
import type { KanbanTask } from "../../../../shared/hermes";
import { CEO_PROFILE } from "../../../../shared/roster";
import type { HermesClient } from "../../hermes/client";
import { HttpError } from "../../http";
import { hiredBoardMembers } from "../../org/consult";
import type { HireStore } from "../../org/hireStore";
import type { CeoWake } from "../../telegram/ceoWake";
import type { RecordStore } from "../recordStore";
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

  async start(req: MeetingRequest): Promise<BoardMeeting> {
    const members = await hiredBoardMembers(req.members, this.deps);
    const at = this.now();
    const meeting: BoardMeeting = {
      id: this.deps.newId?.() ?? `mtg_${randomBytes(5).toString("hex")}`,
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
    await this.startRound(stored, 1, []);
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
    if (m.status === "concluded" || m.status === "cancelled") throw new HttpError(409, `meeting ${id} is already ${m.status}`);
    const open = [...Object.values(stored.rounds.at(-1)?.tasks ?? {}), ...(stored.minutes?.taskId ? [stored.minutes.taskId] : [])];
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
      if (!stored.some((s) => OPEN.has(s.meeting.status) || s.notionDirty)) return;
      board = (await this.deps.hermes.board()).columns.flatMap((c) => c.tasks);
    } catch (err) {
      this.log(`meetings: tick failed (${err instanceof Error ? err.message : "error"})`);
      return;
    }
    for (const s of stored) {
      try {
        if (s.meeting.status === "minutes") await this.checkMinutes(s, board);
        else if (OPEN.has(s.meeting.status)) await this.checkRound(s, board);
        if (s.notionDirty) await this.sync(s);
      } catch (err) {
        this.log(`meetings: ${s.id} failed (${err instanceof Error ? err.message : "error"})`);
      }
    }
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
    for (const member of m.members) {
      if (state.tasks[member]) continue;
      const existing = board.find((t) => t.assignee === member && (t.body ?? "").includes(tag));
      const task =
        existing ??
        (await this.deps.hermes.createTask({
          title: taskTitle(m, roundLabel(state.round, m.discussionRounds)),
          body: roundTaskBody(m, state.round),
          assignee: member,
          tenant: HQ_TENANT,
          triage: false,
        }));
      state.tasks[member] = task.id;
      await this.deps.store.put(stored);
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
    const kind = roundKind(state.round, m.discussionRounds);
    for (const member of m.members) {
      const taskId = state.tasks[member]!;
      const a = await this.answer(taskId, board);
      if (!a.done && !stuck) return;
      const text = a.done ? a.text : `${speakerName(member)} did not respond.`;
      turns.push({ round: state.round, kind, speaker: member, text, at: this.now(), taskId });
      votes.push(a.done ? parseVote(member, a.text) : { member, vote: "abstain", rationale: text });
    }
    this.recordTurns(m, turns);
    if (kind === "vote") {
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
