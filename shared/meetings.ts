import type { LeadershipOutcome } from "./leadership";
/**
 * Board meetings: a multi-round discussion among board advisors (optionally with the founder),
 * ending in a vote and minutes taken by the CEO's office (the CEO Hermes, a neutral note-taker). Mirrored to Notion.
 */

/** "live": a voice meeting in the live room; it skips the written rounds and goes to the vote when the founder ends it. */
export type MeetingStatus = "live" | "drafting" | "review" | "assigned" | "in-round" | "awaiting-founder" | "voting" | "minutes" | "concluded" | "cancelled";

export type RoundKind = "opening" | "discussion" | "vote";

export type Vote = "approve" | "approve-with-conditions" | "reject" | "abstain";

/**
 * "chat": written rounds. "voice": a live room on one ElevenLabs agent that plays every member in their own voice,
 * with the founder's mic always on; ending it hands the transcript to the real board for the vote and minutes.
 */
export type MeetingMode = "chat" | "voice";

export type Decision = "approved" | "approved-with-conditions" | "rejected" | "no-decision";

export interface MeetingTurn {
  round: number;
  kind: RoundKind;
  /** Board member profile, "founder" for HQ remarks, or the CEO profile for the minutes. */
  speaker: string;
  text: string;
  /** Unix seconds. */
  at: number;
  taskId?: string;
}

export interface MeetingVote {
  member: string;
  vote: Vote;
  rationale: string;
  conditions?: string;
}

/** "board": advisors, ends in a vote. "leadership": the CEO agent, COO and VPs, ends in assigned action items (shared/leadership.ts). */
export type MeetingKind = "board" | "leadership";

export interface BoardMeeting {
  id: string;
  /** Absent on meetings created before leadership meetings existed: treat as "board". */
  kind?: MeetingKind;
  topic: string;
  brief: string;
  members: string[];
  /** Absent on meetings created before voice meetings existed: treat as "chat". */
  mode?: MeetingMode;
  /** True: the board discusses on its own and never pauses for founder remarks. */
  boardOnly: boolean;
  /** Discussion rounds between the opening and the vote (1..3). */
  discussionRounds: number;
  status: MeetingStatus;
  currentRound: number;
  turns: MeetingTurn[];
  votes: MeetingVote[];
  decision?: Decision;
  conclusion?: string;
  requestedBy: "hq" | "ceo" | "board";
  createdAt: number;
  updatedAt: number;
  notionPageUrl?: string;
  /** The last Notion sync failure, cleared by the next successful sync. */
  notionSyncError?: string;
  relatedTaskId?: string;
  /** ElevenLabs conversation ids of the live sessions held for this meeting (a reconnect starts a new one). */
  liveConversationIds?: string[];
  /** Leadership meetings: the agreed priorities and action items. */
  outcome?: LeadershipOutcome;
}

export interface StartMeetingRequest {
  topic: string;
  brief: string;
  members?: string[];
  boardOnly?: boolean;
  /** Defaults to "chat". */
  mode?: MeetingMode;
  discussionRounds?: number;
  relatedTaskId?: string;
}

export interface FounderRemarkRequest {
  text: string;
  /** "continue": next round; "extra-round": add one more discussion round; "to-vote": skip to the vote. */
  next?: "continue" | "extra-round" | "to-vote";
}

export interface MeetingsResponse {
  meetings: BoardMeeting[];
}

export interface MeetingResponse {
  meeting: BoardMeeting;
}

export const MEETINGS_API = {
  list: "/api/board/meetings",
  one: (id: string) => `/api/board/meetings/${encodeURIComponent(id)}`,
  remark: (id: string) => `/api/board/meetings/${encodeURIComponent(id)}/remarks`,
  cancel: (id: string) => `/api/board/meetings/${encodeURIComponent(id)}/cancel`,
} as const;

export const MEETING_TOPIC_MAX = 160;
export const MEETING_BRIEF_MAX = 8000;
export const FOUNDER_REMARK_MAX = 4000;
export const MAX_DISCUSSION_ROUNDS = 3;
