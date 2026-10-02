import { getDivision } from "../../../shared/divisions";
import type { ActionItem } from "../../../shared/leadership";
import type { BoardMeeting, MeetingStatus } from "../../../shared/meetings";
import { FOUNDER } from "../board/meetings/rounds";
import { leadershipName } from "../leadership/seats";
import { RICH_TEXT_MAX, bullet, callout, heading, paragraphs, richText } from "./client";

type Json = Record<string, unknown>;

const STATUS: Partial<Record<MeetingStatus, string>> = {
  live: "Live",
  drafting: "Drafting tasks",
  review: "Review tasks",
  assigned: "Assigned",
  cancelled: "Cancelled",
};
const ACTION_STATUS: Record<ActionItem["status"], string> = { proposed: "Proposed", assigned: "Assigned", dropped: "Dropped" };

const text = (value: string) => ({ rich_text: richText(value.slice(0, RICH_TEXT_MAX)) });

/** A leadership (VP) meeting's row in the Board Meetings data source: Type "Leadership", no vote or decision. */
export function leadershipProperties(m: BoardMeeting): Json {
  const assigned = m.outcome?.actions.filter((a) => a.status === "assigned").length ?? 0;
  return {
    Name: { title: richText(m.topic) },
    Type: { select: { name: "Leadership" } },
    Status: { select: STATUS[m.status] ? { name: STATUS[m.status]! } : null },
    Date: { date: { start: new Date(m.createdAt * 1000).toISOString() } },
    "Requested by": { select: { name: "HQ" } },
    Members: { multi_select: m.members.map((p) => ({ name: leadershipName(p) })) },
    Decision: { select: null },
    Votes: text(""),
    Conclusion: text(m.outcome ? `${m.outcome.priorities}${assigned ? `\n${assigned} action(s) assigned.` : ""}` : ""),
    "Zain HQ ID": text(m.id),
  };
}

function actionLine(a: ActionItem): string {
  const owner = getDivision(a.division).name;
  const meta = [a.priority, a.due ? `due ${a.due}` : null, a.taskId ? `task ${a.taskId}` : null].filter(Boolean).join(" · ");
  return `[${ACTION_STATUS[a.status]}] ${owner} · ${meta} — ${a.title}${a.detail ? `: ${a.detail}` : ""}`;
}

export function leadershipBlocks(m: BoardMeeting): Json[] {
  const blocks: Json[] = [];
  if (m.brief.trim()) blocks.push(heading("Brief"), ...paragraphs(m.brief));
  if (m.outcome) {
    blocks.push(heading("Priorities"), ...paragraphs(m.outcome.priorities || "(none)"));
    blocks.push(heading("Actions"));
    if (m.outcome.actions.length) blocks.push(...m.outcome.actions.map((a) => bullet(actionLine(a))));
    else blocks.push(...paragraphs("(none)"));
  }
  if (m.turns.length) {
    blocks.push(heading("Transcript"));
    for (const t of m.turns) blocks.push(callout(leadershipName(t.speaker), t.text, t.speaker === FOUNDER ? "🧑‍💼" : "💬"));
  }
  return blocks;
}
