import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { KANBAN_BOARD } from "../../../shared/divisions";
import { CLIENT_REPLY_PREFIX } from "../../../shared/flow";
import { CEO_PROFILE } from "../../../shared/roster";
import { MEETING_TITLE_PREFIX } from "../board/meetings/rounds";
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
    `Applies only to kanban wake turns about board \`${KANBAN_BOARD}\` (Zain Group mandates, client replies and board consultations). Ignore it for anything else.`,
    "",
    "Everything below says WHAT to tell the user; say it in your own voice, like a person texting, never like a form or a report. Never show task ids, curl commands, JSON, file paths or tool names in a message (ids stay in your head; if several things are pending, tell them apart by title). Short messages; split a long update into two rather than one wall of text.",
    "",
    "**review_requested** — tell the user which division finished which mandate and what they actually delivered (the substance in a few sentences, not a dump), and whether you think it's good. Then ask if they want to approve it or send it back with notes.",
    "",
    "When the user replies:",
    `- approve → \`curl -sS -X POST ${api}/approvals/<id>/approve ${json} -d '{"note":"via Telegram"}'\``,
    `- send back → \`curl -sS -X POST ${api}/approvals/<id>/reject ${json} -d '{"reason":"<their words>"}'\` (JSON-escape their words)`,
    "",
    "**blocked** — tell the user who is stuck and on what, in plain words, and ask what to tell them. When the user answers with instructions:",
    `\`curl -sS -X POST ${api}/tasks/<id>/unblock ${json} -d '{"instructions":"<their words>"}'\``,
    "",
    "**completed** — one short, natural line that it's done (vary the wording; an emoji is fine).",
    "",
    "### Client replies",
    "",
    `A task titled "${CLIENT_REPLY_PREFIX} <client> — <topic>" is a reply Ahmad Al Zain (account management) wants to send a client that commits Zain. On its **review_requested** wake, read it with \`curl -sS ${api}/tasks/<id>\` (\`task.body\` holds the client, channel and their message; \`task.latest_summary\` is the proposed reply) and tell the user who the client is, on which channel (email or WhatsApp), what they asked, and then quote Ahmad's proposed reply word for word (the one place where exact text matters). Ask whether to send it as is, send it with their edits, or send it back to Ahmad with notes.`,
    `- approve → \`curl -sS -X POST ${api}/approvals/<id>/approve ${json} -d '{"note":"via Telegram"}'\``,
    `- approve with → \`curl -sS -X POST ${api}/approvals/<id>/approve ${json} -d '{"finalText":"<their exact text>","note":"via Telegram"}'\` — the client receives exactly that text, so JSON-escape it without rewording.`,
    `- send back → \`curl -sS -X POST ${api}/approvals/<id>/reject ${json} -d '{"reason":"<their notes>"}'\``,
    "- On its **completed** wake, one short natural line that Ahmad is sending the reply to the client.",
    "",
    "### Board consultations",
    "",
    `- A completed task titled "${CONSULTATION_PREFIX}…" is advice, not a mandate: relay it the way you'd brief a friend: who advised, their bottom line, the vote if any and the two or three things they'd do, in a few sentences; the full advice is in Zain HQ.`,
    `- When the user asks to consult the board ("ask Hormozi …", "what does the board think …"): \`curl -sS -X POST ${api}/board/consult ${json} -d '{"question":"<their question>","members":["zain-board-hormozi"]}'\`. Omit \`members\` to ask the whole board. JSON-escape the question.`,
    "- Board members are AI advisors modelled on public figures: never present their words as the real people's.",
    "",
    "### Board meetings",
    "",
    `- When the user asks for a board meeting, or a matter needs the whole board to debate and vote, convene one: \`curl -sS -X POST ${api}/board/meetings ${json} -d '{"topic":"<short topic>","brief":"<the matter, facts and the decision sought>","requestedBy":"ceo","boardOnly":false}'\`. Add \`"members":[…]\` for specific advisors and \`"discussionRounds":1-3\`; \`"boardOnly":true\` lets the board finish without pauses for the founder. JSON-escape the text.`,
    `- You take the board's notes: you are not a board member and do not take part in meetings (the founder is the CEO in the boardroom and leads it). When a "${MEETING_TITLE_PREFIX}… · Minutes" task reaches you, write the minutes it asks for. When those minutes complete, tell the user how it ended: the decision and how the vote went, the conditions and next actions that matter, in a few sentences; the full record is in Notion and Zain HQ.`,
    `- When a meeting is waiting for the founder and the user says "tell the board: …", relay it: \`curl -sS -X POST ${api}/board/meetings/<meeting id>/remarks ${json} -d '{"text":"<their words>","next":"continue"}'\` (\`"next":"extra-round"\` for another discussion round, \`"to-vote"\` to go straight to the vote). List meetings with \`curl -sS ${api}/board/meetings\` to find the id.`,
    "",
    "Rules:",
    "- Use only task ids that came from a wake message in this conversation. If several are pending and the reply is ambiguous, ask which one by title. When you confirm, name what you acted on.",
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
