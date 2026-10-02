import { allTasks } from "../../../shared/flow";
import type { KanbanTask } from "../../../shared/hermes";
import { LEADERSHIP_SEATS, type ActionItem, type ActionPriority, type LeadershipOutcome, type UpdateActionsRequest } from "../../../shared/leadership";
import type { BoardMeeting } from "../../../shared/meetings";
import type { DashboardReader } from "../board/memory/dashboard";
import type { MeetingEngine, StoredMeeting } from "../board/meetings/engine";
import type { HermesClient } from "../hermes/client";
import { HttpError, badRequest } from "../http";
import { fullRoster, type HireStore } from "../org/hireStore";
import { createMandate } from "../org/tasks";
import type { CeoWake } from "../telegram/ceoWake";
import type { TechTeam } from "../../../shared/techTeams";
import type { SoulReader } from "../voice/livePrompt";
import { newActionId } from "./actions";
import { divisionStates, readWeeklyPriorities } from "./context";
import { leadershipPrompt } from "./prompt";
import { leadershipSpeakers } from "./seats";
import { riyadhDate, weekLabel, writeWeeklyPriorities } from "./weekly";

/** Kanban priority per action priority: the kanban dispatches higher numbers first (range -100..100). */
export const KANBAN_PRIORITY: Readonly<Record<ActionPriority, number>> = { P1: 30, P2: 20, P3: 10 };

export interface StartLeadership {
  topic?: string;
  brief?: string;
  members?: string[];
}

export interface LeadershipServiceOptions {
  meetings: MeetingEngine;
  hermes: HermesClient;
  hires: HireStore;
  /** Mandates subscribe the CEO's Telegram wake as usual (createMandate); drafting never does. */
  ceoWake: CeoWake;
  teams?: () => Promise<readonly TechTeam[]>;
  souls: SoulReader;
  dashboard?: DashboardReader;
  /** Where the agreed weekly priorities are written and read back (context.ts weeklyPrioritiesPath). */
  prioritiesPath: string;
  now?: () => number;
  log?: (line: string) => void;
}

/** One action's outcome in an assign call. */
export interface AssignResult {
  id: string;
  ok: boolean;
  taskId?: string;
  error?: string;
}

/** Stable tag in an assigned action's mandate body, so a retry adopts the mandate instead of creating it twice. */
export function actionMarker(meetingId: string, actionId: string): string {
  return `<!-- zain-leadership-action:${meetingId}:${actionId} -->`;
}

/** Leadership (VP) meetings: start, the live prompt, and the founder's review and assignment of the action items. */
export class LeadershipService {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(private readonly options: LeadershipServiceOptions) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.log = options.log ?? console.log;
  }

  async start(req: StartLeadership): Promise<BoardMeeting> {
    const members = await this.members(req.members);
    const at = this.now();
    const meeting: BoardMeeting = {
      id: this.options.meetings.newMeetingId(),
      kind: "leadership",
      topic: req.topic ?? `Weekly priorities · ${weekLabel(at)}`,
      brief: req.brief ?? "",
      members,
      mode: "voice",
      boardOnly: false,
      discussionRounds: 0,
      status: "live",
      currentRound: 1,
      turns: [],
      votes: [],
      requestedBy: "hq",
      createdAt: at,
      updatedAt: at,
      liveConversationIds: [],
    };
    const stored: StoredMeeting = { id: meeting.id, meeting, rounds: [] };
    await this.options.meetings.persist(stored);
    return stored.meeting;
  }

  /** The live room's prompt for a leadership meeting, with every division's kanban state and last week's priorities. */
  async prompt(meeting: BoardMeeting): Promise<string> {
    const speakers = leadershipSpeakers(meeting);
    const [souls, tasks, roster, lastWeek, dashboard] = await Promise.all([
      Promise.all(speakers.map(async (s) => [s.profile, await this.options.souls(s.profile).catch(() => null)] as const)).then(Object.fromEntries),
      this.options.hermes.board().then(allTasks).catch(() => null),
      fullRoster(this.options.hires),
      readWeeklyPriorities(this.options.prioritiesPath),
      this.options.dashboard?.().catch(() => null) ?? Promise.resolve(null),
    ]);
    return leadershipPrompt({ meeting, speakers, souls, divisions: divisionStates(tasks, roster, this.now()), lastWeek, dashboard });
  }

  /** Replaces the drafted priorities and actions with the founder's edits. Only while the meeting is in review. */
  updateActions(id: string, req: UpdateActionsRequest): Promise<BoardMeeting> {
    return this.locked(id, async () => {
      const stored = await this.reviewing(id);
      const outcome = stored.meeting.outcome ?? { priorities: "", actions: [] };
      const known = new Map(outcome.actions.map((a) => [a.id, a]));
      // Assigned actions are mandates already: they stay as they are, whatever the edit says.
      const next: ActionItem[] = outcome.actions.filter((a) => a.status === "assigned");
      const kept = new Set(next.map((a) => a.id));
      for (const a of req.actions) {
        const prev = a.id ? known.get(a.id) : undefined;
        if (prev?.status === "assigned") continue;
        const id = prev && !kept.has(prev.id) ? prev.id : newActionId();
        kept.add(id);
        next.push({ id, division: a.division, title: a.title, detail: a.detail, priority: a.priority, ...(a.due ? { due: a.due } : {}), status: "proposed" });
      }
      for (const a of outcome.actions) if (!kept.has(a.id)) next.push({ ...a, status: "dropped" });
      stored.meeting.outcome = { ...outcome, priorities: req.priorities ?? outcome.priorities, actions: next };
      await this.options.meetings.persist(stored);
      return stored.meeting;
    });
  }

  /**
   * Each selected proposed action becomes an HQ mandate to its division head. Idempotent: an assigned action is
   * skipped, and a mandate already on the board for an action is adopted. A failed action stays proposed; when none
   * is left, the meeting is assigned and the weekly priorities file is written.
   */
  assign(id: string, ids?: readonly string[]): Promise<{ meeting: BoardMeeting; results: AssignResult[] }> {
    return this.locked(id, async () => {
      const stored = await this.reviewing(id);
      const m = stored.meeting;
      const outcome: LeadershipOutcome = m.outcome ?? { priorities: "", actions: [] };
      m.outcome = outcome;
      const unknown = (ids ?? []).filter((x) => !outcome.actions.some((a) => a.id === x));
      if (unknown.length) throw badRequest(`unknown actions: ${unknown.join(", ")}`);
      const targets = outcome.actions.filter((a) => a.status === "proposed" && (!ids || ids.includes(a.id)));
      const board = targets.length ? await this.options.hermes.board().then(allTasks).catch(() => [] as KanbanTask[]) : [];
      const teams = targets.length ? ((await this.options.teams?.()) ?? undefined) : undefined;
      const failures: string[] = [];
      const results: AssignResult[] = [];
      for (const action of targets) {
        try {
          action.taskId = (board.find((t) => (t.body ?? "").includes(actionMarker(m.id, action.id))) ?? (await this.mandate(m, action, teams))).id;
          action.status = "assigned";
          await this.options.meetings.persist(stored, false);
          results.push({ id: action.id, ok: true, taskId: action.taskId });
        } catch (err) {
          const why = (err instanceof Error ? err.message : "error").slice(0, 200);
          failures.push(why);
          results.push({ id: action.id, ok: false, error: why });
          this.log(`leadership: assigning ${action.id} of ${m.id} failed (${why})`);
        }
      }
      if (!outcome.actions.some((a) => a.status === "proposed")) {
        m.status = "assigned";
        outcome.assignedAt = this.now();
      }
      await this.options.meetings.persist(stored);
      if (targets.length > failures.length || m.status === "assigned") await this.writeWeekly(m);
      if (targets.length > 0 && failures.length === targets.length) {
        throw new HttpError(502, `no action could be assigned (${failures[0]})`);
      }
      return { meeting: m, results };
    });
  }

  private async mandate(m: BoardMeeting, a: ActionItem, teams: readonly TechTeam[] | undefined): Promise<KanbanTask> {
    const body = [
      a.detail || "(No further detail given.)",
      "",
      `From the leadership meeting "${m.topic}" on ${riyadhDate(m.createdAt)}.`,
      `Priority: ${a.priority}.${a.due ? ` Due: ${a.due}.` : ""}`,
      actionMarker(m.id, a.id),
    ].join("\n");
    const { hermes, hires, ceoWake } = this.options;
    const res = await createMandate({ division: a.division, title: a.title, body, priority: KANBAN_PRIORITY[a.priority] }, hermes, hires, ceoWake, teams);
    return res.task;
  }

  private async writeWeekly(m: BoardMeeting): Promise<void> {
    try {
      await writeWeeklyPriorities(this.options.prioritiesPath, m, this.now());
    } catch (err) {
      this.log(`leadership: could not write the weekly priorities (${err instanceof Error ? err.message : "error"})`);
    }
  }

  private async reviewing(id: string): Promise<StoredMeeting> {
    const stored = await this.options.meetings.stored(id);
    if (stored.meeting.kind !== "leadership") throw new HttpError(409, `meeting ${id} is not a leadership meeting`);
    if (stored.meeting.status !== "review") throw new HttpError(409, `meeting ${id} is ${stored.meeting.status}, not in review`);
    return stored;
  }

  /** Requested seats in seat order, all hired; by default every hired seat. The CEO agent is always there. */
  private async members(requested: readonly string[] | undefined): Promise<string[]> {
    const seats: readonly string[] = LEADERSHIP_SEATS;
    const unknown = (requested ?? []).filter((p) => !seats.includes(p));
    if (unknown.length) throw badRequest(`not leadership seats: ${unknown.join(", ")}`);
    const profiles = await this.options.hermes.listProfiles();
    const hired = new Set(["default", ...profiles.map((p) => p.name)]);
    const wanted = requested ? seats.filter((p) => requested.includes(p)) : seats.filter((p) => hired.has(p));
    const vacant = wanted.filter((p) => !hired.has(p));
    if (vacant.length) throw new HttpError(409, `not hired yet: ${vacant.join(", ")}`);
    return wanted;
  }

  private locked<T>(key: string, job: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(key) ?? Promise.resolve()).then(job);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    void tail.then(() => this.locks.get(key) === tail && this.locks.delete(key));
    return run;
  }
}
