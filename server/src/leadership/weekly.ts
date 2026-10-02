import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getDivision } from "../../../shared/divisions";
import type { BoardMeeting } from "../../../shared/meetings";

/** Riyadh is UTC+3 all year (no daylight saving). */
const RIYADH_OFFSET_SECONDS = 3 * 3600;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const riyadh = (unix: number) => new Date((unix + RIYADH_OFFSET_SECONDS) * 1000);

/** YYYY-MM-DD in Riyadh. */
export function riyadhDate(unix: number): string {
  return riyadh(unix).toISOString().slice(0, 10);
}

/** "week of 28 Sep 2026": the Monday of the Riyadh week that contains `unix`. */
export function weekLabel(unix: number): string {
  const d = riyadh(unix);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
  return `week of ${monday.getUTCDate()} ${MONTHS[monday.getUTCMonth()]} ${monday.getUTCFullYear()}`;
}

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** The weekly priorities file: the week, the agreed priorities and the assigned actions. */
export function weeklyPrioritiesMarkdown(m: BoardMeeting, now: number): string {
  const outcome = m.outcome ?? { priorities: "", actions: [] };
  const assigned = outcome.actions.filter((a) => a.status === "assigned");
  return [
    `# Weekly priorities · ${weekLabel(m.createdAt)}`,
    "",
    `From the leadership meeting "${cell(m.topic)}" on ${riyadhDate(m.createdAt)} (${m.id}).`,
    "",
    "## Priorities",
    "",
    outcome.priorities.trim() || "(none recorded)",
    "",
    "## Assigned actions",
    "",
    ...(assigned.length
      ? [
          "| Division | Title | Priority | Due | Task |",
          "|---|---|---|---|---|",
          ...assigned.map((a) => `| ${getDivision(a.division).name} | ${cell(a.title)} | ${a.priority} | ${a.due ?? "—"} | ${a.taskId ?? "—"} |`),
        ]
      : ["(none)"]),
    "",
    `Updated: ${new Date(now * 1000).toISOString()}`,
    "",
  ].join("\n");
}

/** Writes the file atomically (temp file, then rename). */
export async function writeWeeklyPriorities(path: string, m: BoardMeeting, now: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, weeklyPrioritiesMarkdown(m, now), "utf8");
  await rename(tmp, path);
}
