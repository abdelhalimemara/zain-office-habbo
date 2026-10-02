import { DIVISIONS } from "../../../shared/divisions";
import type { KanbanTask } from "../../../shared/hermes";
import { ACTIONS_MAX, ACTION_TITLE_MAX, type ActionItem } from "../../../shared/leadership";
import type { BoardMeeting } from "../../../shared/meetings";
import { CEO_PROFILE } from "../../../shared/roster";
import type { StoredMeeting } from "../board/meetings/engine";
import type { HermesClient } from "../hermes/client";
import { newActionId, parseDraft } from "./actions";
import { SEATS, leadershipName } from "./seats";

export const LEADERSHIP_TITLE_PREFIX = "Leadership meeting · ";
/** A drafting task that has not finished by then goes to review empty, so the founder can still add the tasks. */
export const DRAFTING_STUCK_SECONDS = 60 * 60;
const TRANSCRIPT_MAX_CHARS = 60_000;
const HQ_TENANT = "zain-hq";

export const DRAFT_FAILED = "Drafting failed: the CEO agent's action list could not be read. Add this week's priorities and tasks by hand.";
export const DRAFT_TIMED_OUT = "Drafting failed: the CEO agent did not draft the actions in time. Add this week's priorities and tasks by hand.";

/** Stable tag in the drafting task's body, so it can be found again on the board. */
export function draftMarker(meetingId: string): string {
  return `<!-- zain-leadership:${meetingId}:draft -->`;
}

export function leadershipTranscript(m: BoardMeeting): string {
  if (m.turns.length === 0) return "(Nothing was said.)";
  const text = m.turns.map((t) => `${leadershipName(t.speaker)}: ${t.text.trim()}`).join("\n");
  return text.length > TRANSCRIPT_MAX_CHARS ? `…\n${text.slice(-TRANSCRIPT_MAX_CHARS)}` : text;
}

export function draftTaskBody(m: BoardMeeting): string {
  const owners = DIVISIONS.map((d) => {
    const head = Object.values(SEATS).find((s) => s.division === d.id)?.name ?? "its head";
    return `- "${d.id}": ${d.name} (${d.tagline}), owned by the ${head}`;
  });
  return [
    draftMarker(m.id),
    `You are the CEO agent. The founder, Abdelhalim, has just held the weekly leadership meeting "${m.topic}" with you, the COO and the division VPs, by voice. Turn it into the week's priorities and the action items he gave.`,
    "",
    "## Rules",
    "- Include ONLY tasks the founder actually gave, or explicitly agreed to, in the transcript. Never invent tasks, owners or dates; a suggestion nobody agreed to is not a task.",
    "- Give each task to the division that owns it:",
    ...owners.map((o) => `  ${o}`),
    "- Work that is about the whole group, operations, finance or HQ support goes to \"hq\" (the COO).",
    `- title: a short imperative, at most ${ACTION_TITLE_MAX} characters. detail: what done looks like, the context from the meeting and any constraint the founder gave.`,
    "- priority: P1 (this week's top priority), P2 (this week), P3 (if there is room). due: YYYY-MM-DD only when a date or day was said; otherwise leave it out.",
    `- priorities: the week's priorities as agreed in the room, 3 to 6 short lines. At most ${ACTIONS_MAX} actions.`,
    "- Do not create kanban tasks or mandates yourself: the founder reviews this list and assigns it from Zain HQ.",
    "",
    ...(m.brief.trim() ? ["## Brief", m.brief.trim(), ""] : []),
    "## Transcript",
    leadershipTranscript(m),
    "",
    "## Your result (kanban_complete)",
    "Return STRICT JSON in one fenced block and nothing else of substance:",
    "```json",
    '{"priorities": "<3-6 lines>", "actions": [{"division": "hq|studio|growth|labs|tech", "title": "...", "detail": "...", "priority": "P1|P2|P3", "due": "YYYY-MM-DD"}]}',
    "```",
    'If the founder gave no tasks, return "actions": [].',
  ].join("\n");
}

export interface DraftingContext {
  hermes: HermesClient;
  now: () => number;
  log: (line: string) => void;
  /** Persists the record without a Notion sync. */
  put: (stored: StoredMeeting) => Promise<void>;
  /** Persists and syncs the record. */
  save: (stored: StoredMeeting) => Promise<void>;
}

/**
 * The live room has ended: one task for the CEO agent to draft the actions from the transcript. No CEO wake and no
 * Telegram: the founder is in the UI, and this task is not a mandate, so the wake backfill leaves it alone too.
 */
export async function startDrafting(stored: StoredMeeting, ctx: DraftingContext): Promise<void> {
  const m = stored.meeting;
  m.status = "drafting";
  stored.drafting = { startedAt: ctx.now() };
  await ctx.put(stored);
  const task = await ctx.hermes.createTask({
    title: `${LEADERSHIP_TITLE_PREFIX}${m.topic} · Action items`,
    body: draftTaskBody(m),
    assignee: CEO_PROFILE,
    tenant: HQ_TENANT,
    triage: false,
  });
  stored.drafting.taskId = task.id;
  await ctx.save(stored);
}

function toReview(stored: StoredMeeting, priorities: string, actions: ActionItem[]): void {
  stored.meeting.outcome = { priorities, actions };
  stored.meeting.status = "review";
}

/** One reconciler pass over a drafting meeting: adopts or creates its task, and reads the answer once it is done. */
export async function checkDrafting(stored: StoredMeeting, board: readonly KanbanTask[], ctx: DraftingContext): Promise<void> {
  const m = stored.meeting;
  if (!stored.drafting?.taskId) {
    const existing = board.find((t) => t.assignee === CEO_PROFILE && (t.body ?? "").includes(draftMarker(m.id)));
    if (!existing) return startDrafting(stored, ctx);
    stored.drafting = { startedAt: stored.drafting?.startedAt ?? ctx.now(), taskId: existing.id };
  }
  const taskId = stored.drafting.taskId!;
  const finished = (t: KanbanTask) => t.status === "done" || t.status === "archived";
  const onBoard = board.find((t) => t.id === taskId);
  const task = onBoard && !finished(onBoard) ? onBoard : (await ctx.hermes.task(taskId)).task;
  if (!finished(task)) {
    if (ctx.now() - stored.drafting.startedAt <= DRAFTING_STUCK_SECONDS) return;
    ctx.log(`leadership: drafting for ${m.id} timed out`);
    toReview(stored, DRAFT_TIMED_OUT, []);
    return ctx.save(stored);
  }
  const answer = task.status === "done" ? (task.result ?? task.latest_summary ?? "") : "";
  const draft = parseDraft(answer, ctx.log);
  if (!draft) {
    ctx.log(`leadership: could not read the drafted actions for ${m.id}`);
    toReview(stored, DRAFT_FAILED, []);
  } else {
    toReview(stored, draft.priorities, draft.actions.map((a) => ({ id: newActionId(), ...a, status: "proposed" as const })));
  }
  await ctx.save(stored);
}
