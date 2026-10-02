import { allTasks, isBoardTask, isClientReply, isMandate, teamReviewMarker, teamReviewTarget } from "../../../shared/flow";
import type { KanbanTask } from "../../../shared/hermes";
import { displayName, findAgent, type RosterAgent } from "../../../shared/roster";
import { HermesError, type HermesClient, type HermesEvent, type HermesTaskDetail } from "../hermes/client";
import { fullRoster, type HireStore } from "./hireStore";
import type { Log } from "./reconcile";
import { UI_AUTHOR } from "./tasks";

/**
 * Hermes runs `kanban.review_dispatch: false` so it never spawns a reviewer for an HQ mandate (the VP
 * would approve their own mandate), which also leaves a division's own reviews unrun. This step wakes
 * the manager instead: one helper task per task in review, assigned to the reviewer.
 *
 * A dispatcher worker may only mutate its own task (tools/kanban_tools.py `_enforce_worker_task_ownership`),
 * and `kanban_request_changes` only acts on a run claimed from review, so the helper cannot rule on the
 * reviewed task itself. It completes with an `APPROVED:` / `CHANGES REQUESTED:` verdict, and this step
 * applies it the way HQ's own approve / reject do.
 */

export const MAX_HELPERS_PER_TICK = 5;
export const VERDICT_GRACE_MS = 10 * 60_000;

const FINISHED = new Set(["done", "archived"]);
const VERDICT = /^\s*(?:\*\*)?(APPROVED|CHANGES REQUESTED)(?:\*\*)?\s*[:\-–—]?\s*([\s\S]*)$/i;

type Verdict = { approved: boolean; text: string };

function reason(err: unknown): string {
  if (err instanceof HermesError) return `HTTP ${err.status}`;
  return err instanceof Error ? err.name : "error";
}

function stalledMarker(helperId: string): string {
  return `<!-- zain-team-review-stalled:${helperId} -->`;
}

function str(payload: HermesEvent["payload"], key: string): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

/** A division's own task waiting in `review`: never an HQ decision (mandate, client reply) or a helper. */
export function isTeamReview(task: KanbanTask, roster: readonly RosterAgent[]): boolean {
  return (
    task.status === "review" &&
    !isMandate(task, roster) &&
    !isClientReply(task, roster) &&
    !isBoardTask(task, roster) &&
    !teamReviewTarget(task)
  );
}

function latestReviewRequest(detail: HermesTaskDetail): HermesEvent | undefined {
  return (detail.events ?? []).filter((e) => e.kind === "review_requested").at(-1);
}

/**
 * The reviewer Hermes reassigned the task to when the request named one, else the implementer's
 * manager. Only a VP (the COO included) or a team's Head Engineer reviews; never the CEO.
 */
export function reviewerOf(
  task: KanbanTask,
  request: HermesEvent | undefined,
  roster: readonly RosterAgent[],
): { reviewer: RosterAgent; implementer: string | null } | null {
  const implementer = str(request?.payload ?? null, "implementer") ?? task.assignee;
  const named = str(request?.payload ?? null, "reviewer");
  const profile = named && named !== implementer ? task.assignee : implementer ? findAgent(implementer, roster)?.reportsTo : null;
  const reviewer = profile ? findAgent(profile, roster) : undefined;
  if (!reviewer || reviewer.profile === implementer) return null;
  if (reviewer.rank !== "vp" && reviewer.teamRole !== "head-engineer") return null;
  return { reviewer, implementer };
}

export function parseVerdict(text: string | null | undefined): Verdict | null {
  const match = VERDICT.exec(text ?? "");
  if (!match) return null;
  const approved = match[1]!.toUpperCase() === "APPROVED";
  const rest = match[2]!.trim();
  if (!approved && !rest) return null;
  return { approved, text: rest };
}

export function helperBody(task: KanbanTask, implementer: string | null, feeds: readonly string[], roster: readonly RosterAgent[]): string {
  const who = implementer ? findAgent(implementer, roster) : undefined;
  const by = who ? `**${displayName(who)}** (${implementer})` : implementer ? `**${implementer}**` : "Your team";
  const id = task.id;
  const context = feeds.length
    ? `the mandate or task it feeds (${feeds.map((f) => `kanban_show("${f}")`).join(", ")})`
    : "the mandate it feeds (see its links in kanban_show)";
  return [
    teamReviewMarker(id),
    `Zain HQ: ${by} asked for a review of **${id} — ${task.title}**. You are the reviewer: this is your team's work, not an HQ approval.`,
    "",
    `1. Read the task with kanban_show("${id}"): its brief, latest summary and result, comments, attachments (kanban_attachments(task_id="${id}")) and every file it references.`,
    `2. Judge it against the task's brief and ${context}.`,
    `3. Leave your verdict on the task: kanban_comment(task_id="${id}", body="APPROVED: <why>") or kanban_comment(task_id="${id}", body="CHANGES REQUESTED: <the concrete changes>").`,
    `4. Then complete THIS task with the verdict as the first words of the summary:`,
    `   - kanban_complete(summary="APPROVED: <one line>") — Zain HQ then completes ${id}.`,
    `   - kanban_complete(summary="CHANGES REQUESTED: <the concrete changes, specific enough to act on>") — Zain HQ then sends ${id} back to its implementer with your changes.`,
    `5. Do not call kanban_complete, kanban_request_changes or kanban_block with task_id="${id}": Hermes scopes you to this task and refuses to act on another one.`,
    `6. If you cannot reach a verdict (missing files, no access), comment on ${id} with what you found and kanban_block this task with the reason, so HQ sees it.`,
    "",
    "Do not message the CEO or Telegram about this review.",
  ].join("\n");
}

export interface TeamReviewsOptions {
  hermes: HermesClient;
  hires: HireStore;
  log?: Log;
  now?: () => number;
  maxPerTick?: number;
  graceMs?: number;
}

/** Reconciler step: wakes reviewers for their team's tasks in `review` and applies their verdicts. */
export class TeamReviews {
  /** Reviewed task id → the done helper already reported as stalled. */
  private readonly stalled = new Map<string, string>();
  /** Tasks already logged as having no reviewer, so the log says it once. */
  private readonly unrouted = new Set<string>();

  constructor(private readonly options: TeamReviewsOptions) {}

  private get log(): Log {
    return this.options.log ?? console.log;
  }

  async tick(): Promise<void> {
    const { hermes, hires, maxPerTick = MAX_HELPERS_PER_TICK } = this.options;
    const [board, roster] = await Promise.all([hermes.board(), fullRoster(hires)]);
    const tasks = allTasks(board);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const helpers = new Map<string, KanbanTask[]>();
    for (const t of tasks) {
      const target = teamReviewTarget(t);
      if (target) helpers.set(target, [...(helpers.get(target) ?? []), t]);
    }
    await this.cleanup(helpers, byId);

    const inReview = tasks.filter((t) => isTeamReview(t, roster));
    const reviewing = new Set(inReview.map((t) => t.id));
    for (const id of [...this.stalled.keys()]) if (!reviewing.has(id)) this.stalled.delete(id);
    for (const id of [...this.unrouted]) if (!reviewing.has(id)) this.unrouted.delete(id);

    let created = 0;
    for (const task of inReview) {
      const mine = helpers.get(task.id) ?? [];
      if (mine.some((h) => !FINISHED.has(h.status))) continue;
      if (mine.some((h) => h.id === this.stalled.get(task.id))) continue;
      if (mine.length === 0 && created >= maxPerTick) continue;
      try {
        created += await this.review(task, mine, roster, created < maxPerTick);
      } catch (err) {
        this.log(`team-review: ${task.id} failed (${reason(err)})`);
      }
    }
  }

  /** Settles this round's finished helper, or creates one. Returns the number of helpers created. */
  private async review(task: KanbanTask, mine: readonly KanbanTask[], roster: readonly RosterAgent[], mayCreate: boolean): Promise<number> {
    const { hermes } = this.options;
    const detail = await hermes.task(task.id);
    const request = latestReviewRequest(detail);
    const since = request?.created_at ?? 0;
    const answered = mine
      .filter((h) => h.status === "done" && h.created_at >= since)
      .sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0))[0];
    if (answered) {
      await this.settle(detail, answered);
      return 0;
    }
    if (!mayCreate) return 0;
    const route = reviewerOf(detail.task, request, roster);
    if (!route) {
      if (!this.unrouted.has(task.id)) this.log(`team-review: ${task.id} has no VP or Head Engineer to review it; skipped`);
      this.unrouted.add(task.id);
      return 0;
    }
    const helper = await hermes.createTask({
      title: `Review: ${task.title}`.slice(0, 200),
      body: helperBody(detail.task, route.implementer, detail.links?.children ?? [], roster),
      assignee: route.reviewer.profile,
      tenant: task.tenant ?? undefined,
      priority: task.priority,
      triage: false,
    });
    this.log(`team-review: woke ${route.reviewer.profile} to review ${task.id} (${helper.id})`);
    return 1;
  }

  /** Applies a done helper's verdict to the reviewed task; without one, reports it once after the grace period. */
  private async settle(detail: HermesTaskDetail, helper: KanbanTask): Promise<void> {
    const { hermes, now = Date.now, graceMs = VERDICT_GRACE_MS } = this.options;
    const task = detail.task;
    const { task: full } = await hermes.task(helper.id);
    const verdict = parseVerdict(full.latest_summary) ?? parseVerdict(full.result);
    const by = full.assignee ?? "the reviewer";
    if (verdict) {
      try {
        if (verdict.approved) {
          const summary = verdict.text ? `Approved by ${by}: ${verdict.text}` : `Approved by ${by}`;
          const result = task.result ?? task.latest_summary ?? undefined;
          await hermes.addComment(task.id, summary, UI_AUTHOR);
          await hermes.updateTask(task.id, { status: "done", summary, ...(result ? { result } : {}) });
        } else {
          await hermes.addComment(task.id, `Changes requested by ${by}: ${verdict.text}`, UI_AUTHOR);
          await hermes.updateTask(task.id, { status: "todo" });
        }
        this.log(`team-review: ${by} ${verdict.approved ? "approved" : "requested changes on"} ${task.id} (${helper.id})`);
        return;
      } catch (err) {
        this.log(`team-review: applying ${helper.id}'s verdict to ${task.id} failed (${reason(err)})`);
      }
    }
    const finishedAt = (full.completed_at ?? full.created_at) * 1000;
    if (now() - finishedAt < graceMs) return;
    this.stalled.set(task.id, helper.id);
    this.log(`team-review: ${helper.id} is done but ${task.id} is still in review; no further helpers`);
    const marker = stalledMarker(helper.id);
    if ((detail.comments ?? []).some((c) => c.body.includes(marker))) return;
    await hermes.addComment(
      task.id,
      `${marker}\nZain HQ: ${by} finished the review task ${helper.id} without a verdict HQ could apply, and this task is still waiting in review. A human needs to approve it or send it back.`,
      UI_AUTHOR,
    );
  }

  /** Archives open helpers whose task has left review; a running helper is left to finish. */
  private async cleanup(helpers: Map<string, KanbanTask[]>, byId: Map<string, KanbanTask>): Promise<void> {
    for (const [target, list] of helpers) {
      if (byId.get(target)?.status === "review") continue;
      for (const helper of list) {
        if (FINISHED.has(helper.status) || helper.status === "running") continue;
        try {
          await this.options.hermes.updateTask(helper.id, { status: "archived" });
          this.log(`team-review: archived ${helper.id}; ${target} left review`);
        } catch (err) {
          this.log(`team-review: archiving ${helper.id} failed (${reason(err)})`);
        }
      }
    }
  }
}
