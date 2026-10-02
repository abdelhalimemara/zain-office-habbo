import { findBoardMember } from "../../../../shared/board";
import type { BoardMeeting, Decision, MeetingTurn, MeetingVote, RoundKind, Vote } from "../../../../shared/meetings";
import { CEO_PROFILE } from "../../../../shared/roster";

export const FOUNDER = "founder";
export const MEETING_TITLE_PREFIX = "Board meeting · ";
export const WORD_LIMIT = 250;

export function roundKind(round: number, discussionRounds: number): RoundKind {
  if (round <= 1) return "opening";
  return round <= 1 + discussionRounds ? "discussion" : "vote";
}

export function voteRound(discussionRounds: number): number {
  return discussionRounds + 2;
}

export function roundLabel(round: number, discussionRounds: number): string {
  const kind = roundKind(round, discussionRounds);
  if (kind === "opening") return "Opening";
  return kind === "vote" ? "Vote" : `Discussion ${round - 1}`;
}

/** Stable tag in a task body, so a meeting's tasks can be found again on the board. */
export function marker(meetingId: string, round: number | "minutes"): string {
  return `<!-- zain-meeting:${meetingId}:${round} -->`;
}

export function speakerName(speaker: string): string {
  if (speaker === FOUNDER) return "Founder (Abdelhalim)";
  if (speaker === CEO_PROFILE) return "CEO (chair)";
  return findBoardMember(speaker)?.name ?? speaker;
}

export function transcript(turns: readonly MeetingTurn[], discussionRounds: number): string {
  if (turns.length === 0) return "(No one has spoken yet.)";
  const lines: string[] = [];
  let round = 0;
  for (const turn of turns) {
    if (turn.round !== round) {
      round = turn.round;
      lines.push(`--- Round ${round} · ${roundLabel(round, discussionRounds)} ---`);
    }
    lines.push(`${speakerName(turn.speaker)}: ${turn.text.trim()}`, "");
  }
  return lines.join("\n").trim();
}

const RULES: Record<RoundKind, string[]> = {
  opening: ["Give your opening position on the matter, in your own voice per your brief and board charter."],
  discussion: [
    "This is a discussion round. Address your colleagues by name: say where you agree or disagree and why, and refine your position.",
    "If a colleague has persuaded you, say so plainly.",
  ],
  vote: ["This is the vote. Decide, in your own voice, on the matter as discussed."],
};

function outputContract(kind: RoundKind): string[] {
  if (kind !== "vote") {
    return ["Your result (kanban_complete): plain text only, your contribution to the meeting. No headings needed."];
  }
  return [
    "Your result (kanban_complete) must be plain text in exactly this shape:",
    "VOTE: approve|approve-with-conditions|reject|abstain",
    "CONDITIONS: <your conditions>   (only if you vote approve-with-conditions)",
    "<your rationale, the rest of the text>",
  ];
}

export function roundTaskBody(meeting: BoardMeeting, round: number): string {
  const kind = roundKind(round, meeting.discussionRounds);
  const remarks = meeting.turns.filter((t) => t.speaker === FOUNDER);
  return [
    marker(meeting.id, round),
    `Board meeting: ${meeting.topic}`,
    `Round ${round} of ${voteRound(meeting.discussionRounds)} · ${roundLabel(round, meeting.discussionRounds)}`,
    "",
    "## Brief",
    meeting.brief,
    "",
    "## Meeting rules",
    ...RULES[kind].map((r) => `- ${r}`),
    `- At most ${WORD_LIMIT} words. Stay in character; speak only for yourself.`,
    "",
    "## Transcript so far",
    transcript(meeting.turns, meeting.discussionRounds),
    "",
    "## Founder remarks",
    remarks.length ? remarks.map((r) => `- ${r.text.trim()}`).join("\n") : "(none)",
    "",
    "## Output contract",
    ...outputContract(kind),
  ].join("\n");
}

const VOTES: readonly Vote[] = ["approve-with-conditions", "approve", "reject", "abstain"];

/** Reads the vote contract; anything malformed counts as an abstention carrying the raw text. */
export function parseVote(member: string, text: string): MeetingVote {
  const lines = text.replace(/\r/g, "").split("\n");
  const first = lines.findIndex((l) => l.trim());
  const head = /^\**\s*vote\s*\**\s*:\s*\**\s*([a-z _-]+)/i.exec(lines[first] ?? "");
  const normalized = head?.[1]?.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+$/, "");
  const vote = VOTES.find((v) => normalized === v);
  if (!vote) return { member, vote: "abstain", rationale: text.trim() || "(no answer)" };
  let rest = lines.slice(first + 1);
  let conditions: string | undefined;
  const condAt = rest.findIndex((l) => /^\s*\**\s*conditions\s*\**\s*:/i.test(l));
  if (condAt >= 0 && rest.slice(0, condAt).every((l) => !l.trim())) {
    conditions = rest[condAt]!.replace(/^\s*\**\s*conditions\s*\**\s*:\s*\**/i, "").trim() || undefined;
    rest = rest.slice(condAt + 1);
  }
  return { member, vote, rationale: rest.join("\n").trim(), ...(conditions ? { conditions } : {}) };
}

/** Majority of approve (with or without conditions) vs reject; abstentions do not count. */
export function decide(votes: readonly MeetingVote[]): Decision {
  const approving = votes.filter((v) => v.vote === "approve" || v.vote === "approve-with-conditions");
  const rejecting = votes.filter((v) => v.vote === "reject").length;
  if (approving.length > rejecting) {
    return approving.some((v) => v.vote === "approve-with-conditions") ? "approved-with-conditions" : "approved";
  }
  return rejecting > approving.length ? "rejected" : "no-decision";
}

export function votesSummary(votes: readonly MeetingVote[]): string {
  const count = (v: Vote) => votes.filter((x) => x.vote === v).length;
  const parts: [string, number][] = [
    ["Approve", count("approve")],
    ["Conditions", count("approve-with-conditions")],
    ["Reject", count("reject")],
    ["Abstain", count("abstain")],
  ];
  return parts.filter(([, n]) => n > 0).map(([label, n]) => `${label} ${n}`).join(" · ") || "No votes";
}

export function minutesTaskBody(meeting: BoardMeeting): string {
  return [
    marker(meeting.id, "minutes"),
    `You chair the Zain Group board. Write the minutes of the board meeting "${meeting.topic}".`,
    "",
    "## Brief",
    meeting.brief,
    "",
    "## Transcript",
    transcript(meeting.turns, meeting.discussionRounds),
    "",
    "## Votes",
    ...meeting.votes.map((v) => `- ${speakerName(v.member)}: ${v.vote}${v.conditions ? ` (conditions: ${v.conditions})` : ""} — ${v.rationale}`),
    `Decision: ${meeting.decision ?? "no-decision"} (${votesSummary(meeting.votes)})`,
    "",
    "## Your result (kanban_complete)",
    "Concise minutes in plain text: a summary; the key arguments by member; the decision; any conditions; actions with owners. Do not invent positions nobody took.",
  ].join("\n");
}
