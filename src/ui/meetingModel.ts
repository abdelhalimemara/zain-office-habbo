import { findBoardMember } from "@shared/board";
import type { BoardMeeting, Decision, MeetingStatus, MeetingTurn, MeetingVote, RoundKind, Vote } from "@shared/meetings";
import { CEO_PROFILE, type RosterAgent } from "@shared/roster";

export const FOUNDER = "founder";
export const CHAIR = CEO_PROFILE;

export const STATUS_LABEL: Record<MeetingStatus, string> = {
  live: "Live",
  "in-round": "In session",
  "awaiting-founder": "Your turn",
  voting: "Voting",
  minutes: "Minutes",
  concluded: "Concluded",
  cancelled: "Cancelled",
};

export const DECISION_LABEL: Record<Decision, string> = {
  approved: "Approved",
  "approved-with-conditions": "Approved with conditions",
  rejected: "Rejected",
  "no-decision": "No decision",
};

export const VOTES: readonly { vote: Vote; label: string }[] = [
  { vote: "approve", label: "Approve" },
  { vote: "approve-with-conditions", label: "Conditions" },
  { vote: "reject", label: "Reject" },
  { vote: "abstain", label: "Abstain" },
];

/** Rounds are numbered from 1: the opening, then the discussion rounds, then the vote. */
export function roundKind(meeting: Pick<BoardMeeting, "discussionRounds" | "turns">, round: number): RoundKind {
  const seen = meeting.turns.find((t) => t.round === round && t.speaker !== FOUNDER);
  if (seen) return seen.kind;
  if (round <= 1) return "opening";
  return round <= 1 + meeting.discussionRounds ? "discussion" : "vote";
}

function discussionIndex(meeting: Pick<BoardMeeting, "turns">, round: number): number {
  const rounds = new Set(meeting.turns.filter((t) => t.kind === "discussion").map((t) => t.round));
  rounds.add(round);
  return [...rounds].sort((a, b) => a - b).indexOf(round) + 1;
}

export function roundLabel(meeting: Pick<BoardMeeting, "discussionRounds" | "turns">, round: number, kind = roundKind(meeting, round)): string {
  if (kind === "opening") return "Opening";
  if (kind === "vote") return "Vote";
  return `Discussion ${discussionIndex(meeting, round)}`;
}

/** Where the meeting is, for the list: "Opening", "Discussion 1/2", "Vote", "Minutes"… */
export function phaseLabel(meeting: BoardMeeting): string {
  if (meeting.status === "voting") return "Vote";
  if (meeting.status === "minutes") return "Minutes";
  if (meeting.status === "concluded" || meeting.status === "cancelled") return STATUS_LABEL[meeting.status];
  const kind = roundKind(meeting, meeting.currentRound);
  if (kind !== "discussion") return roundLabel(meeting, meeting.currentRound, kind);
  return `Discussion ${Math.min(meeting.currentRound - 1, meeting.discussionRounds)}/${meeting.discussionRounds}`;
}

export function isMinutes(turn: Pick<MeetingTurn, "speaker" | "kind">): boolean {
  return turn.speaker === CHAIR && turn.kind === "vote";
}

export interface RoundGroup {
  key: string;
  label: string;
  turns: MeetingTurn[];
}

/**
 * Transcript in order: one group per round, founder remarks inside the round they follow, minutes last.
 * A member's vote-round turn is left out once their parsed vote is in `votes` (shown in the tally).
 */
export function groupTurns(meeting: BoardMeeting): RoundGroup[] {
  const ordered = [...meeting.turns].sort((a, b) => a.round - b.round || a.at - b.at);
  const voted = new Set(meeting.votes.map((v) => v.member));
  const groups = new Map<string, RoundGroup>();
  for (const turn of ordered) {
    if (isMinutes(turn) || (turn.kind === "vote" && voted.has(turn.speaker))) continue;
    const key = `round-${turn.round}`;
    if (!groups.has(key)) groups.set(key, { key, label: roundLabel(meeting, turn.round), turns: [] });
    groups.get(key)!.turns.push(turn);
  }
  const minutes = ordered.filter(isMinutes);
  return [...groups.values(), ...(minutes.length ? [{ key: "minutes", label: "Minutes", turns: minutes }] : [])];
}

/** Members whose words the current step still needs. */
export function waitingFor(meeting: BoardMeeting): string[] {
  if (meeting.status === "voting") {
    const voted = new Set(meeting.votes.map((v) => v.member));
    return meeting.members.filter((m) => !voted.has(m));
  }
  if (meeting.status === "minutes") return [CHAIR];
  if (meeting.status !== "in-round") return [];
  const spoke = new Set(meeting.turns.filter((t) => t.round === meeting.currentRound).map((t) => t.speaker));
  return meeting.members.filter((m) => !spoke.has(m));
}

export interface Tally {
  vote: Vote;
  label: string;
  count: number;
  /** Share of cast votes, 0..100, rounded so the shares add up to 100. */
  percent: number;
}

export function tallyVotes(votes: readonly Pick<MeetingVote, "vote">[]): Tally[] {
  const total = votes.length;
  const rows = VOTES.map(({ vote, label }) => {
    const count = votes.filter((v) => v.vote === vote).length;
    return { vote, label, count, exact: total ? (count / total) * 100 : 0, percent: 0 };
  });
  let remaining = total ? 100 : 0;
  for (const r of rows) {
    r.percent = Math.floor(r.exact);
    remaining -= r.percent;
  }
  [...rows].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact))).slice(0, remaining).forEach((r) => r.percent++);
  return rows.map(({ vote, label, count, percent }) => ({ vote, label, count, percent }));
}

/** The name a member is shown by: the public figure for board seats, the roster name otherwise. */
export function speakerName(profile: string, roster: readonly RosterAgent[]): string {
  if (profile === FOUNDER) return "You";
  const member = findBoardMember(profile);
  if (member) return member.name;
  const agent = roster.find((a) => a.profile === profile);
  return agent ? (agent.name ?? agent.title) : profile;
}

/** "Waiting for Hormozi, Buffett…" uses surnames for board seats. */
export function shortName(profile: string, roster: readonly RosterAgent[]): string {
  if (profile === CHAIR) return "the CEO's office";
  const member = findBoardMember(profile);
  if (member) {
    const words = member.name.split(/\s+/);
    const bin = words.indexOf("bin");
    return bin > 0 ? words[bin - 1]! : words.at(-1)!;
  }
  return speakerName(profile, roster);
}
