import type { TaskHistoryEntry, TaskHistoryKind } from "../../../shared/api";
import type { KanbanComment } from "../../../shared/hermes";
import type { HermesEvent, HermesTaskDetail } from "../hermes/client";

const TEXT_MAX = 280;
/** Comment rows and their `commented` events are written in one transaction; allow clock skew. */
const COMMENT_MATCH_SECONDS = 5;

type Draft = Omit<TaskHistoryEntry, "id" | "at">;
type Mapper = (event: HermesEvent, ctx: Context) => Draft | null;

interface Context {
  taskId: string;
  assignee: string | null;
  titles: ReadonlyMap<string, string>;
  comments: CommentMatcher;
  startedRuns: Set<number>;
}

export function oneLine(text: unknown, firstLineOnly = false): string | null {
  if (typeof text !== "string") return null;
  const source = firstLineOnly ? (text.split("\n").find((l) => l.trim()) ?? "") : text;
  const flat = source.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > TEXT_MAX ? `${flat.slice(0, TEXT_MAX - 1).trimEnd()}…` : flat;
}

function str(payload: HermesEvent["payload"], key: string): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function entry(kind: TaskHistoryKind, text: string | null, actor: string | null, relatedTaskId?: string): Draft {
  return { kind, text, actor, ...(relatedTaskId ? { relatedTaskId } : {}) };
}

class CommentMatcher {
  private readonly unused: KanbanComment[];

  constructor(comments: readonly KanbanComment[]) {
    this.unused = [...comments].sort((a, b) => a.created_at - b.created_at || a.id - b.id);
  }

  take(author: string | null, at: number): KanbanComment | null {
    const candidates = this.unused.filter(
      (c) => (author === null || c.author === author) && Math.abs(c.created_at - at) <= COMMENT_MATCH_SECONDS,
    );
    const best = candidates.sort((a, b) => Math.abs(a.created_at - at) - Math.abs(b.created_at - at))[0];
    if (!best) return null;
    this.unused.splice(this.unused.indexOf(best), 1);
    return best;
  }
}

/**
 * Hermes event kinds (kanban_db `_append_event`) worth showing to HQ. Anything not listed —
 * heartbeat, spawned, promoted, tip_scratch_workspace, unlinked, edited, diagnostics — is dropped.
 */
const MAPPERS: Record<string, Mapper> = {
  created: (e) => entry("created", null, str(e.payload, "assignee")),
  claimed: (e, ctx) => {
    if (e.run_id !== null && ctx.startedRuns.has(e.run_id)) return null;
    if (e.run_id !== null) ctx.startedRuns.add(e.run_id);
    return entry("started", null, ctx.assignee);
  },
  linked: (e, ctx) => {
    const parent = str(e.payload, "parent");
    if (!parent || str(e.payload, "child") !== ctx.taskId) return null;
    return entry("subtask-linked", oneLine(ctx.titles.get(parent) ?? parent), null, parent);
  },
  blocked: (e) => entry("blocked", oneLine(e.payload?.reason), null),
  dependency_wait: () => entry("blocked", "Waiting on subtasks", null),
  gave_up: () => entry("blocked", "Gave up after repeated failures", null),
  unblocked: () => entry("unblocked", null, null),
  review_requested: (e) => entry("review-requested", oneLine(e.payload?.summary, true), str(e.payload, "implementer")),
  review_reopened: (e) => entry("sent-back", null, str(e.payload, "implementer")),
  changes_requested: (e) => entry("sent-back", oneLine(e.payload?.reason), str(e.payload, "reviewer")),
  completed: (e) => entry("completed", oneLine(e.payload?.summary), null),
  status: (e) => entry("status", str(e.payload, "status") ? `→ ${str(e.payload, "status")}` : null, null),
  archived: () => entry("status", "→ archived", null),
  assigned: (e) => entry("status", str(e.payload, "assignee") ? `Assigned to ${str(e.payload, "assignee")}` : "Unassigned", null),
  timed_out: () => entry("status", "Run timed out", null),
  commented: (e, ctx) => {
    const author = str(e.payload, "author");
    const comment = ctx.comments.take(author, e.created_at);
    return entry("commented", comment ? oneLine(comment.body) : null, author ?? comment?.author ?? null);
  },
};

function sameAs(a: TaskHistoryEntry | undefined, b: Draft): boolean {
  return !!a && a.kind === b.kind && a.text === b.text && a.actor === b.actor && a.relatedTaskId === b.relatedTaskId;
}

/**
 * The task's story for HQ, oldest first: Hermes events mapped to a small vocabulary, comments
 * merged into their `commented` events, one "started" per run and consecutive repeats collapsed.
 * `titles` names linked subtasks (task id → title) when they are known.
 */
export function toHistory(
  detail: Pick<HermesTaskDetail, "task" | "events" | "comments" | "link_tasks">,
  taskId: string,
  titles: ReadonlyMap<string, string> = new Map(),
): TaskHistoryEntry[] {
  const known = new Map([...(detail.link_tasks ?? []).map((t) => [t.id, t.title] as const), ...titles]);
  const ctx: Context = {
    taskId,
    assignee: detail.task.assignee,
    titles: known,
    comments: new CommentMatcher(detail.comments ?? []),
    startedRuns: new Set(),
  };
  const events = [...(detail.events ?? [])].sort((a, b) => a.created_at - b.created_at || a.id - b.id);
  const history: TaskHistoryEntry[] = [];
  for (const event of events) {
    const draft = MAPPERS[event.kind]?.(event, ctx);
    if (!draft || sameAs(history[history.length - 1], draft)) continue;
    history.push({ id: event.id, at: event.created_at, ...draft });
  }
  return history;
}
