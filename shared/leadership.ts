/**
 * Leadership (VP) meetings: the founder meets the CEO agent, the COO and the four division VPs in a live voice
 * room to set the week's priorities. There is no vote: the meeting ends with action items the founder reviews,
 * edits and assigns, which become HQ mandates on the kanban so the divisions start executing.
 *
 * A leadership meeting is a BoardMeeting with kind "leadership" and mode "voice" (shared/meetings.ts); it shares
 * the live room (LIVE_API in shared/voice.ts), and only its ending differs.
 */
import type { DivisionId } from "./divisions";

/** Who sits in the VP room, in seat order. "default" is the CEO agent (the founder's main Hermes agent). */
export const LEADERSHIP_SEATS = [
  "default",
  "zain-hq-coo",
  "zain-studio-vp",
  "zain-growth-vp",
  "zain-labs-vp",
  "zain-tech-vp",
] as const;
export type LeadershipSeat = (typeof LEADERSHIP_SEATS)[number];

/** Leadership meeting lifecycle after the live room: live → drafting → review → assigned (or cancelled). */
export type LeadershipStatus = "live" | "drafting" | "review" | "assigned" | "cancelled";

export type ActionPriority = "P1" | "P2" | "P3";

export interface ActionItem {
  id: string;
  /** The division that owns it; its head (VP, or the COO for hq) receives the mandate. */
  division: DivisionId;
  title: string;
  /** What done looks like, context from the meeting, constraints the founder gave. */
  detail: string;
  priority: ActionPriority;
  /** ISO date (YYYY-MM-DD), optional. */
  due?: string;
  /** proposed: drafted from the transcript; assigned: a mandate exists; dropped: the founder removed it. */
  status: "proposed" | "assigned" | "dropped";
  /** The kanban task created when assigned. */
  taskId?: string;
}

export interface LeadershipOutcome {
  /** The week's priorities in a few lines, as agreed in the room (shown at the top and fed to the next meeting). */
  priorities: string;
  actions: ActionItem[];
  /** Unix seconds when the founder assigned the actions. */
  assignedAt?: number;
}

export interface StartLeadershipRequest {
  /** Defaults to "Weekly priorities · week of <date>". */
  topic?: string;
  /** Optional agenda or context; numbered points make the room go item by item. */
  brief?: string;
  /** Defaults to every hired seat in LEADERSHIP_SEATS. */
  members?: string[];
}

/** The founder's edits before assigning: the full list replaces the drafted one. */
export interface UpdateActionsRequest {
  priorities?: string;
  actions: Omit<ActionItem, "status" | "taskId">[];
}

/** Assign these action ids (default: every proposed action); each becomes an HQ mandate to its division. */
export interface AssignActionsRequest {
  ids?: string[];
}

export const LEADERSHIP_API = {
  start: "/api/leadership/meetings",
  actions: (id: string) => `/api/leadership/meetings/${encodeURIComponent(id)}/actions`,
  assign: (id: string) => `/api/leadership/meetings/${encodeURIComponent(id)}/actions/assign`,
} as const;

export const ACTION_TITLE_MAX = 200;
export const ACTION_DETAIL_MAX = 4000;
export const PRIORITIES_MAX = 2000;
export const ACTIONS_MAX = 25;
/** Where the agreed weekly priorities are kept for agents and the next meeting. */
export const WEEKLY_PRIORITIES_FILE = "~/ZainGroup/weekly-priorities.md";
