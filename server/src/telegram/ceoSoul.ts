import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { KANBAN_BOARD } from "../../../shared/divisions";
import { CEO_PROFILE } from "../../../shared/roster";
import { CONSULTATION_PREFIX } from "../org/boardPersona";
import type { HermesClient } from "../hermes/client";

export const START_MARKER = "<!-- zain-hq:approvals:start -->";
export const END_MARKER = "<!-- zain-hq:approvals:end -->";

/** The CEO's Telegram approval duties; it acts by calling Zain HQ, which owns the kanban rules. */
export function approvalsSection(port: number): string {
  const api = `http://127.0.0.1:${port}/api`;
  const json = "-H 'Content-Type: application/json'";
  return [
    START_MARKER,
    "## Zain Group approvals (Telegram)",
    "",
    `Applies only to kanban wake turns about board \`${KANBAN_BOARD}\` (Zain Group mandates). Ignore it for anything else.`,
    "",
    "**review_requested** — in 3–6 lines tell the user which division, the mandate title and its task id, and the VP's roll-up. Then ask: \"Reply *approve*, or *send back:* <instructions>.\"",
    "",
    "When the user replies:",
    `- approve → \`curl -sS -X POST ${api}/approvals/<id>/approve ${json} -d '{"note":"via Telegram"}'\``,
    `- send back → \`curl -sS -X POST ${api}/approvals/<id>/reject ${json} -d '{"reason":"<their words>"}'\` (JSON-escape their words)`,
    "",
    "**blocked** — tell the user the VP is blocked and why, and ask whether to send instructions. On \"tell them: …\":",
    `\`curl -sS -X POST ${api}/tasks/<id>/unblock ${json} -d '{"instructions":"<their words>"}'\``,
    "",
    "**completed** — one short line: \"✅ <title> is done.\"",
    "",
    "### Board consultations",
    "",
    `- A completed task titled "${CONSULTATION_PREFIX}…" is advice, not a mandate: relay it in ≤8 lines — the advisor's name, the bottom line, the vote if any and the top 3 actions — then say the full advice is in Zain HQ.`,
    `- When the user asks to consult the board ("ask Hormozi …", "what does the board think …"): \`curl -sS -X POST ${api}/board/consult ${json} -d '{"question":"<their question>","members":["zain-board-hormozi"]}'\`. Omit \`members\` to ask the whole board. JSON-escape the question.`,
    "- Board members are AI advisors modelled on public figures: never present their words as the real people's.",
    "",
    "Rules:",
    "- Use only task ids that came from a wake message in this conversation. If several are pending and the reply is ambiguous, ask which one by title. Echo the title when you confirm.",
    "- Never approve or send back without an explicit reply from the user. Never paste secrets or tokens.",
    "- HTTP 409 means it was already decided in Zain HQ: say so. Connection refused means Zain HQ is not running: say so and do not retry in a loop.",
    END_MARKER,
  ].join("\n");
}

/** Appends the section, or replaces only the text between the markers; other text is untouched. */
export function withApprovals(soul: string, section: string): string {
  const start = soul.indexOf(START_MARKER);
  const end = soul.indexOf(END_MARKER, start);
  if (start >= 0 && end > start) return soul.slice(0, start) + section + soul.slice(end + END_MARKER.length);
  const base = soul.replace(/\s+$/, "");
  return base ? `${base}\n\n${section}\n` : `${section}\n`;
}

export function currentSection(soul: string): string | null {
  const start = soul.indexOf(START_MARKER);
  const end = soul.indexOf(END_MARKER, start);
  return start >= 0 && end > start ? soul.slice(start, end + END_MARKER.length) : null;
}

export interface CeoApprovalsOptions {
  hermes: HermesClient;
  apply: boolean;
  port: number;
  /** Directory that receives `.zain/ceo-soul.backup-<timestamp>.md`. */
  root: string;
  now?: () => Date;
  log?: (line: string) => void;
}

export type CeoApprovalsOutcome = "unchanged" | "dry-run" | "written";

export async function installCeoApprovals({ hermes, apply, port, root, now = () => new Date(), log = console.log }: CeoApprovalsOptions): Promise<CeoApprovalsOutcome> {
  const soul = await hermes.readSoul(CEO_PROFILE);
  const section = approvalsSection(port);
  const next = withApprovals(soul, section);
  if (next === soul) {
    log("CEO SOUL already has the current Zain HQ approvals section.");
    return "unchanged";
  }
  const before = currentSection(soul);
  log(before ? "Replacing the Zain HQ approvals section:" : "Appending the Zain HQ approvals section:");
  for (const line of (before ?? "").split("\n").filter(Boolean)) log(`- ${line}`);
  for (const line of section.split("\n")) log(`+ ${line}`);
  if (!apply) {
    log("Dry run. Re-run with --apply to back up and write the CEO SOUL.");
    return "dry-run";
  }
  const dir = join(root, ".zain");
  await mkdir(dir, { recursive: true });
  const backup = join(dir, `ceo-soul.backup-${now().toISOString().replace(/[:.]/g, "-")}.md`);
  await writeFile(backup, soul, { encoding: "utf8", flag: "wx" });
  log(`Backed up the current SOUL to ${backup}`);
  await hermes.writeSoul(CEO_PROFILE, next);
  log("Wrote the CEO SOUL.");
  return "written";
}
