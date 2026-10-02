import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DIVISIONS, type DivisionId } from "../../../shared/divisions";
import { isMandate } from "../../../shared/flow";
import type { KanbanTask } from "../../../shared/hermes";
import { WEEKLY_PRIORITIES_FILE } from "../../../shared/leadership";
import { findAgent, type RosterAgent } from "../../../shared/roster";

/** Per-division budget for the kanban state in the live prompt. */
export const DIVISION_STATE_CHARS = 600;
export const WEEKLY_PRIORITIES_CHARS = 1200;
const RECENT_DONE_SECONDS = 7 * 24 * 3600;
const TITLE_CHARS = 80;
const REASON_CHARS = 120;
const OPEN_SHOWN = 6;
const DONE_SHOWN = 5;
const FINISHED = new Set(["done", "archived"]);

/** `~/ZainGroup/weekly-priorities.md`, or ZAIN_WEEKLY_PRIORITIES_PATH. */
export function weeklyPrioritiesPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.ZAIN_WEEKLY_PRIORITIES_PATH || join(homedir(), WEEKLY_PRIORITIES_FILE.replace(/^~\//, ""));
}

/** Last week's agreed priorities; null when the file does not exist yet. */
export async function readWeeklyPriorities(path: string): Promise<string | null> {
  try {
    const text = (await readFile(path, "utf8")).trim();
    return text || null;
  } catch {
    return null;
  }
}

const oneLine = (text: string) => text.replace(/[#*_`>|]+/g, "").replace(/\s+/g, " ").trim();

function clip(text: string, max: number): string {
  const t = oneLine(text);
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Cuts text to `max` characters at a line boundary. */
export function clipLines(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf("\n");
  return `${(at > max / 2 ? cut.slice(0, at) : cut).trimEnd()}\n…`;
}

function mandateLine(t: KanbanTask): string {
  const title = `"${clip(t.title, TITLE_CHARS)}"`;
  if (t.status === "blocked") {
    const why = t.latest_summary ?? t.result;
    return `${title} (blocked${why ? `: ${clip(why, REASON_CHARS)}` : ""})`;
  }
  if (t.status === "review") return `${title} (awaiting HQ approval)`;
  return `${title} (${t.status === "running" ? "in progress" : t.status})`;
}

/**
 * One division's live kanban state, compact: open HQ mandates with their status (blocked ones with the reason),
 * mandates done in the last seven days, and the team's load. Meeting and drafting tasks are left out.
 */
export function divisionState(division: DivisionId, tasks: readonly KanbanTask[], roster: readonly RosterAgent[], now: number): string {
  const tenant = DIVISIONS.find((d) => d.id === division)!.tenant;
  const mine = tasks.filter((t) => t.tenant === tenant);
  const mandates = mine.filter((t) => isMandate(t, roster));
  const open = mandates.filter((t) => !FINISHED.has(t.status));
  const done = mandates
    .filter((t) => t.status === "done" && (t.completed_at ?? 0) >= now - RECENT_DONE_SECONDS)
    .sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0));
  const team = mine.filter((t) => {
    const agent = t.assignee ? findAgent(t.assignee, roster) : undefined;
    return !isMandate(t, roster) && agent?.division === division && agent.rank !== "board" && agent.rank !== "ceo";
  });
  const count = (status: string) => team.filter((t) => t.status === status).length;
  const queued = team.filter((t) => ["todo", "ready", "scheduled", "triage"].includes(t.status)).length;
  const lines = [
    open.length ? `Open mandates: ${open.slice(0, OPEN_SHOWN).map(mandateLine).join("; ")}${open.length > OPEN_SHOWN ? `; and ${open.length - OPEN_SHOWN} more` : ""}.` : "Open mandates: none.",
    done.length ? `Done in the last 7 days: ${done.slice(0, DONE_SHOWN).map((t) => `"${clip(t.title, TITLE_CHARS)}"`).join("; ")}.` : "Done in the last 7 days: none.",
    `Team tasks: ${count("running")} in progress, ${count("blocked")} blocked, ${queued} queued, ${count("review")} in internal review.`,
  ];
  return clipLines(lines.join("\n"), DIVISION_STATE_CHARS);
}

/** The kanban state of every division, keyed by division id; null when the board cannot be read. */
export function divisionStates(tasks: readonly KanbanTask[] | null, roster: readonly RosterAgent[], now: number): Record<DivisionId, string> | null {
  if (!tasks) return null;
  return Object.fromEntries(DIVISIONS.map((d) => [d.id, divisionState(d.id, tasks, roster, now)])) as Record<DivisionId, string>;
}
