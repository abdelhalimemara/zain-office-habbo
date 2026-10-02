import type { DivisionId } from "../../../shared/divisions";
import { LEADERSHIP_SEATS, type LeadershipSeat } from "../../../shared/leadership";
import type { BoardMeeting } from "../../../shared/meetings";
import type { LiveSpeaker } from "../../../shared/voice";

export interface SeatInfo {
  /** Multi-voice label in the leadership room. */
  tag: string;
  name: string;
  /** The division the seat speaks for; the CEO agent speaks for the whole group. */
  division: DivisionId | null;
  /** What the seat is in the room for, ahead of the condensed SOUL. */
  role: string;
}

export const SEATS: Readonly<Record<LeadershipSeat, SeatInfo>> = {
  default: {
    tag: "CEO",
    name: "CEO",
    division: null,
    role: "The CEO agent: the founder's chief of staff and main agent. Coordinates the executives, keeps the big picture and the cross-division trade-offs, and keeps the meeting on the priorities.",
  },
  "zain-hq-coo": {
    tag: "COO",
    name: "COO",
    division: "hq",
    role: "Runs operations and the HQ support teams (PMO, care, accounts, finance, people, legal); owns delivery health and finance health across the group.",
  },
  "zain-studio-vp": { tag: "Studio", name: "VP Studio", division: "studio", role: "Heads Zain Studio: branding and creative." },
  "zain-growth-vp": { tag: "Growth", name: "VP Growth", division: "growth", role: "Heads Zain Growth: performance marketing." },
  "zain-labs-vp": { tag: "Labs", name: "VP Labs", division: "labs", role: "Heads Zain Labs: revenue-share growth partnerships." },
  "zain-tech-vp": { tag: "Tech", name: "VP Tech", division: "tech", role: "Heads Zain Tech: engineering and AI systems." },
};

export function isLeadershipSeat(profile: string): profile is LeadershipSeat {
  return (LEADERSHIP_SEATS as readonly string[]).includes(profile);
}

export function isLeadership(meeting: Pick<BoardMeeting, "kind">): boolean {
  return meeting.kind === "leadership";
}

/** The leadership room's voice label for a profile; "" for anyone who has no seat there. */
export function leadershipTag(profile: string): string {
  return isLeadershipSeat(profile) ? SEATS[profile].tag : "";
}

export function leadershipName(profile: string): string {
  if (profile === "founder") return "Founder (Abdelhalim)";
  return isLeadershipSeat(profile) ? SEATS[profile].name : profile;
}

/** Each executive in the meeting with their voice label, in seat order. */
export function leadershipSpeakers(meeting: Pick<BoardMeeting, "members">): LiveSpeaker[] {
  return LEADERSHIP_SEATS.filter((p) => meeting.members.includes(p)).map((profile) => ({ tag: SEATS[profile].tag, profile, name: SEATS[profile].name }));
}
