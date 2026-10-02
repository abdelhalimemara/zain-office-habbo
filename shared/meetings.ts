/**
 * Board meetings: a multi-round discussion among board advisors (optionally with the founder),
 * ending in a vote and minutes written by the chair (the CEO). Mirrored to Notion.
 */

export type MeetingStatus = "in-round" | "awaiting-founder" | "voting" | "minutes" | "concluded" | "cancelled";

export type RoundKind = "opening" | "discussion" | "vote";

export type Vote = "approve" | "approve-with-conditions" | "reject" | "abstain";

export type Decision = "approved" | "approved-with-conditions" | "rejected" | "no-decision";

export interface MeetingTurn {
  round: number;
  kind: RoundKind;
  /** Board member profile, "founder" for HQ remarks, or the chair profile for minutes. */
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

export interface BoardMeeting {
  id: string;
  topic: string;
  brief: string;
  members: string[];
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
}

export interface StartMeetingRequest {
  topic: string;
  brief: string;
  members?: string[];
  boardOnly?: boolean;
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
