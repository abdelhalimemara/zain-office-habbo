import type { DivisionId } from "../../../shared/divisions";
import { LEADERSHIP_SEATS, type LeadershipSeat } from "../../../shared/leadership";
import type { BoardMeeting } from "../../../shared/meetings";
import { findAgent } from "../../../shared/roster";
import type { LiveSpeaker } from "../../../shared/voice";

export interface SeatInfo {
  /** Multi-voice label in the leadership room: the exec's first name, letters only. It names the ElevenLabs voice, so it must not change. */
  tag: string;
  /** The exec's full name, from the roster. */
  name: string;
  /** The seat: "CEO", "COO", "VP Studio"… */
  title: string;
  /** The division the seat speaks for; the CEO agent speaks for the whole group. */
  division: DivisionId | null;
  /** What the seat is in the room for, ahead of the condensed SOUL. */
  role: string;
  /** How the exec comes across in the room, in one line. */
  character: string;
}

function seat(profile: LeadershipSeat, title: string, division: DivisionId | null, role: string, character: string): SeatInfo {
  const name = findAgent(profile)?.name ?? title;
  return { tag: name.split(/\s+/)[0]!.replace(/[^A-Za-z]/g, ""), name, title, division, role, character };
}

export const SEATS: Readonly<Record<LeadershipSeat, SeatInfo>> = {
  default: seat(
    "default",
    "CEO",
    null,
    "The CEO agent: the founder's chief of staff and main agent. Runs the agenda for him, keeps the big picture and the cross-division trade-offs.",
    "Sharp, warm and organised; keeps time, pulls people in by name and closes each topic in one line.",
  ),
  "zain-hq-coo": seat(
    "zain-hq-coo",
    "COO",
    "hq",
    "Runs operations and the HQ support teams (PMO, care, accounts, finance, people, legal); owns delivery health and finance health across the group.",
    "Calm operator; thinks in process, cash and delivery dates.",
  ),
  "zain-studio-vp": seat("zain-studio-vp", "VP Studio", "studio", "Heads Zain Studio: branding and creative.", "Design-led; guards the quality bar and the client's taste."),
  "zain-growth-vp": seat("zain-growth-vp", "VP Growth", "growth", "Heads Zain Growth: performance marketing.", "Numbers first; talks in CAC, ROAS, spend and pipeline."),
  "zain-labs-vp": seat("zain-labs-vp", "VP Labs", "labs", "Heads Zain Labs: revenue-share growth partnerships.", "Partnerships and deal structure; weighs every deal's terms and upside."),
  "zain-tech-vp": seat("zain-tech-vp", "VP Tech", "tech", "Heads Zain Tech: engineering and AI systems.", "Pragmatic engineer; cuts scope, names the risk, commits to what ships."),
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

/** An exec's full name, e.g. "Omar Khalid"; anyone else by profile. */
export function execName(profile: string): string {
  return isLeadershipSeat(profile) ? SEATS[profile].name : profile;
}

/** "Omar Khalid · VP Growth": how an exec is named in transcripts, drafting and Notion. */
export function leadershipName(profile: string): string {
  if (profile === "founder") return "Founder (Abdelhalim)";
  return isLeadershipSeat(profile) ? `${SEATS[profile].name} · ${SEATS[profile].title}` : profile;
}

/** Each executive in the meeting with their voice label, in seat order. */
export function leadershipSpeakers(meeting: Pick<BoardMeeting, "members">): LiveSpeaker[] {
  return LEADERSHIP_SEATS.filter((p) => meeting.members.includes(p)).map((profile) => ({ tag: SEATS[profile].tag, profile, name: SEATS[profile].name }));
}
