import type { ReconcilerStatus } from "../../../shared/api";
import { allTasks, isMandate } from "../../../shared/flow";
import type { KanbanTask } from "../../../shared/hermes";
import type { RosterAgent } from "../../../shared/roster";
import { HermesError, type HermesClient } from "../hermes/client";
import { fullRoster, type HireStore } from "./hireStore";
import { UI_AUTHOR } from "./tasks";

export type Log = (line: string) => void;

const FINISHED = new Set(["done", "archived"]);
export const RECONCILE_INTERVAL_MS = 30_000;

function reason(err: unknown): string {
  if (err instanceof HermesError) return `HTTP ${err.status}`;
  return err instanceof Error ? err.name : "error";
}

/**
 * In our model a mandate waits on its subtasks (they are its parents) and never gates other
 * work, so an unfinished same-tenant child of a mandate is an edge created the wrong way round
 * (typically `kanban_create(parents=[mandate])`). Workers cannot unlink, so this flips it.
 */
function reversedChildren(mandate: KanbanTask, childIds: readonly string[], onBoard: Map<string, KanbanTask>): string[] {
  return childIds.filter((id) => {
    const child = onBoard.get(id);
    return child !== undefined && child.tenant === mandate.tenant && !FINISHED.has(child.status);
  });
}

async function repairMandate(hermes: HermesClient, mandate: KanbanTask, reversed: string[], log: Log): Promise<number> {
  const fixed: string[] = [];
  for (const sub of reversed) {
    try {
      await hermes.unlink(mandate.id, sub);
    } catch (err) {
      log(`reconcile: unlink ${mandate.id} -> ${sub} failed (${reason(err)})`);
      continue;
    }
    try {
      await hermes.link(sub, mandate.id);
      fixed.push(sub);
      log(`reconcile: repaired ${sub} -> ${mandate.id}`);
    } catch (err) {
      log(`reconcile: link ${sub} -> ${mandate.id} failed after unlink (${reason(err)})`);
    }
  }
  if (fixed.length === 0) return 0;
  if (mandate.status === "blocked") {
    try {
      await hermes.updateTask(mandate.id, { status: "ready" });
    } catch (err) {
      log(`reconcile: unblock ${mandate.id} failed (${reason(err)})`);
    }
  }
  try {
    await hermes.addComment(
      mandate.id,
      `Zain HQ repaired the dependencies: ${fixed.join(", ")} ` +
        `${fixed.length === 1 ? "is now a prerequisite" : "are now prerequisites"} of this mandate ` +
        `(linked the wrong way round before). ` +
        `The mandate resumes automatically when all are done.`,
      UI_AUTHOR,
    );
  } catch (err) {
    log(`reconcile: comment on ${mandate.id} failed (${reason(err)})`);
  }
  return fixed.length;
}

/** One pass over the zain-group board; returns how many edges were repaired. */
export async function reconcileOnce(hermes: HermesClient, roster: readonly RosterAgent[], log: Log = console.log): Promise<number> {
  const tasks = allTasks(await hermes.board());
  const onBoard = new Map(tasks.map((t) => [t.id, t]));
  const candidates = tasks.filter(
    (t) => isMandate(t, roster) && (t.link_counts?.children ?? 0) > 0 && t.status !== "running" && !FINISHED.has(t.status),
  );
  let repaired = 0;
  for (const mandate of candidates) {
    let childIds: string[];
    try {
      childIds = (await hermes.task(mandate.id)).links?.children ?? [];
    } catch (err) {
      log(`reconcile: reading ${mandate.id} failed (${reason(err)})`);
      continue;
    }
    const reversed = reversedChildren(mandate, childIds, onBoard);
    if (reversed.length) repaired += await repairMandate(hermes, mandate, reversed, log);
  }
  return repaired;
}

export interface ReconcilerOptions {
  hermes: HermesClient;
  hires: HireStore;
  log?: Log;
  now?: () => number;
  intervalMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

/** Runs reconcileOnce at startup and on an interval, one run at a time; never throws. */
export class Reconciler {
  private current: Promise<void> | null = null;
  private last: ReconcilerStatus = { lastRunAt: null, repaired: 0 };

  constructor(private readonly options: ReconcilerOptions) {}

  status(): ReconcilerStatus {
    return { ...this.last };
  }

  run(): Promise<void> {
    this.current ??= this.tick().finally(() => {
      this.current = null;
    });
    return this.current;
  }

  start(): () => void {
    const { intervalMs = RECONCILE_INTERVAL_MS } = this.options;
    const set = this.options.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    const clear = this.options.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
    void this.run();
    const handle = set(() => void this.run(), intervalMs);
    return () => clear(handle);
  }

  private async tick(): Promise<void> {
    const { hermes, hires, log = console.log, now = Date.now } = this.options;
    try {
      const repaired = await reconcileOnce(hermes, await fullRoster(hires), log);
      this.last = { lastRunAt: Math.floor(now() / 1000), repaired };
    } catch (err) {
      log(`reconcile: run failed (${reason(err)})`);
    }
  }
}
