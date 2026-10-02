import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The company dashboard (~/ZainGroup/company-dashboard.md), kept current by the COO and CEO cron jobs:
 * high-level metrics the board sees in every meeting so nobody has to quote them.
 */
export type DashboardReader = () => Promise<string | null>;

export const HERMES_DASHBOARD_CHARS = 3000;
export const LIVE_DASHBOARD_CHARS = 2000;
/** Older than this, the board is told the numbers may be out of date. */
const STALE_HOURS = 6;

export function dashboardPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.ZAIN_DASHBOARD_PATH || join(homedir(), "ZainGroup", "company-dashboard.md");
}

/** Reads the dashboard; null when it does not exist yet or cannot be read. */
export function fileDashboard(path = dashboardPath()): DashboardReader {
  return async () => {
    try {
      const text = await readFile(path, "utf8");
      return text.trim() ? text : null;
    } catch {
      return null;
    }
  };
}

/** The "Updated: …" time from the header line, if it parses. */
export function dashboardUpdated(text: string): Date | null {
  const m = /^Updated:\s*([^·\n]+)/m.exec(text);
  if (!m?.[1]) return null;
  const at = new Date(m[1].trim());
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * The dashboard cut to `budget` characters at line boundaries. The headline table and the notes come first in
 * the file, so a cut drops the detail sections and the footer, never the headline numbers.
 */
export function trimDashboard(text: string, budget: number): string {
  const lines = text.replace(/<!--\s*notes:(start|end)\s*-->/g, "").split("\n");
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > budget) {
      out.push("… (more in the full dashboard)");
      break;
    }
    out.push(line);
    used += line.length + 1;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Prompt lines for the dashboard, or none when there is no dashboard yet. `keep` filters lines (the live privacy guard). */
export function dashboardSection(
  text: string | null,
  budget: number,
  now: Date = new Date(),
  keep: (line: string) => boolean = () => true,
): string[] {
  if (!text) return [];
  const body = trimDashboard(text, budget)
    .split("\n")
    .filter((l) => !l.trim() || keep(l))
    .join("\n");
  if (!body) return [];
  const updated = dashboardUpdated(text);
  const stale = !updated || now.getTime() - updated.getTime() > STALE_HOURS * 3600_000;
  return [
    "## Company dashboard",
    "Zain Group's current high-level numbers, kept by the COO and CEO. Use them; do not ask the founder for figures that are here.",
    ...(stale ? ["(These numbers may be out of date: check the Updated time before relying on them.)"] : []),
    "",
    body,
    "",
  ];
}
