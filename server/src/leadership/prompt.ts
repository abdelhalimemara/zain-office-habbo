import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DIVISIONS, type DivisionId } from "../../../shared/divisions";
import type { BoardMeeting, MeetingTurn } from "../../../shared/meetings";
import type { LiveSpeaker } from "../../../shared/voice";
import { dashboardSection } from "../board/memory/dashboard";
import { FOUNDER } from "../board/meetings/rounds";
import { hermesHome } from "../clientChannels/hermesPaths";
import { FOUNDER_NAME, fileSouls, hasAgenda, type SoulReader } from "../voice/livePrompt";
import { speechText } from "../voice/speech";
import { clipLines, WEEKLY_PRIORITIES_CHARS } from "./context";
import { SEATS, isLeadershipSeat, leadershipName } from "./seats";

/** The whole prompt stays under this; a reconnect's earlier transcript takes what is left. */
export const LEADERSHIP_PROMPT_MAX = 13_800;
export const EXEC_PERSONA_CHARS = 340;
export const LEADERSHIP_DASHBOARD_CHARS = 1000;
const BRIEF_CHARS = 800;
const PRIOR_MAX_CHARS = 4000;
const PRIOR_MIN_CHARS = 300;

/** Sections of an executive's SOUL that are kanban procedure or tooling, not persona. */
const PROCEDURE = /work ?flows|handling|mandate|kanban|approval|telegram|reviewer|review|git|platform|client|repo|procedure|protocol|tool|cron|channel/i;
/** Lines that are procedure wherever they appear. */
const PROCEDURE_LINE = /kanban|curl\s|https?:\/\/|`[a-z_]+\(|tenant|127\.0\.0\.1|^You report to/i;

/**
 * An executive's SOUL condensed to their persona: the opening paragraphs and any non-procedural section, with the
 * expertise list as one line. Marked blocks (e.g. the CEO's approvals section), kanban procedure and tool calls are left out.
 */
export function condenseExecSoul(soul: string, max = EXEC_PERSONA_CHARS): string {
  const text = soul.replace(/\r/g, "").replace(/<!--\s*([\w:-]+):start\s*-->[\s\S]*?<!--\s*\1:end\s*-->/g, "");
  const kept: string[] = [];
  const expertise: string[] = [];
  let section: string | null = null;
  for (const raw of text.split("\n")) {
    if (/^#\s/.test(raw)) continue;
    const heading = /^#{2,6}\s+(.*)$/.exec(raw);
    if (heading) {
      section = heading[1]!.trim().toLowerCase();
      continue;
    }
    const line = raw.replace(/\s*Your Hermes profile is `[^`]*`\.?/, "");
    if (section === "expertise") {
      const skill = /^\s*[-*]\s+(?:[\w-]+:)?([\w-]+)/.exec(line)?.[1];
      if (skill) expertise.push(skill.replace(/-/g, " "));
      continue;
    }
    if (section !== null && PROCEDURE.test(section)) continue;
    if (PROCEDURE_LINE.test(line)) continue;
    kept.push(line);
  }
  if (expertise.length) kept.push(`Expertise: ${expertise.join(", ")}.`);
  return speechText(kept.join("\n"), max).replace(/\s*\n\s*/g, " ");
}

/** SOULs for the leadership room: `$HERMES_HOME/SOUL.md` for the CEO agent, the profile's SOUL.md for the others. */
export function execSouls(home = hermesHome()): SoulReader {
  const profiles = fileSouls(home);
  return async (profile) => {
    if (!isLeadershipSeat(profile)) return null;
    if (profile !== "default") return profiles(profile);
    try {
      return await readFile(join(home, "SOUL.md"), "utf8");
    } catch {
      return null;
    }
  };
}

const CEO = SEATS.default.tag;
const COO = SEATS["zain-hq-coo"].tag;
const GROWTH = SEATS["zain-growth-vp"].tag;

const RULES = [
  `Wrap every line in its speaker's tag, exactly as listed, e.g. <${COO}>Delivery is on track.</${COO}>. Close every tag and never nest tags.`,
  "Every word you say is inside an executive's tag. There is no host or narrator: never say anything outside a tag.",
  "Each speaker turn is 1 to 3 short spoken sentences. A reply holds one to three speakers, then stops so the room can react.",
  `Whoever is addressed by name answers next, in their own tag, whether ${FOUNDER_NAME} or a colleague asked: if ${CEO} says "${GROWTH}, what's Growth's capacity?", ${GROWTH} answers straight away. Never answer for them or ignore a colleague's question. If ${FOUNDER_NAME} names no one, the most relevant exec answers him briefly.`,
  "Make it a real conversation: execs use first names, hand over to each other, build on and challenge each other.",
  `${FOUNDER_NAME} opens the meeting: wait for him to speak first. If he is silent at the very start, ${CEO} may briefly ask him to open, nothing more.`,
  "Spoken words only: no stage directions, no actions in asterisks or brackets, no markdown, no lists, no emojis, no speaker names before lines.",
  `Speak English. If ${FOUNDER_NAME} speaks Arabic, everyone answers in Arabic until he switches back.`,
  "Each exec speaks only from their own role and persona below, and only for their own division. They are AI agents: never invent facts, numbers, tasks or status that are not in this prompt or said in the room.",
];

const CONDUCT = [
  "This meeting sets the week's priorities and ends with clear tasks from the founder. There is no vote and no one else decides.",
  "Talk like department heads who own their numbers: concrete figures from the kanban and dashboard below, dates, owners, trade-offs, capacity. Short and decisive. No filler, no consultant talk, no \"great question\".",
  "Asked for a report, an exec covers what moved since last week, what is blocked and why, and one to three proposed priorities with their capacity.",
  `Execs may disagree with each other and with ${CEO}. They commit, or push back with a reason and offer the trade-off. Flag blockers and capacity early.`,
  "When an exec does not know something, they say so and take it as an action with a date; they never make up a number.",
  `${CEO} runs the agenda for ${FOUNDER_NAME}: she keeps time, pulls the right exec in by name, spots overload and conflicts across divisions, and when a topic closes sums up the decision in one line. She never overrules ${FOUNDER_NAME}.`,
  `Nobody decides for ${FOUNDER_NAME}: propose, advise and warn; he decides.`,
  `When ${FOUNDER_NAME} gives a task, its owner confirms it out loud in one sentence: what, who owns it and by when. If the owner or the deadline is unclear, the owner asks him.`,
  "Use the kanban state below in your own words; never read it out as a list.",
];

export interface LeadershipPromptInput {
  meeting: BoardMeeting;
  speakers: readonly LiveSpeaker[];
  /** Raw SOUL.md per seat; null when missing. */
  souls: Record<string, string | null>;
  /** Live kanban state per division (context.ts), or null when the board could not be read. */
  divisions: Record<DivisionId, string> | null;
  /** The weekly priorities file's text, if there is one. */
  lastWeek?: string | null;
  /** The company dashboard markdown, if there is one. */
  dashboard?: string | null;
  now?: Date;
}

function priorTranscript(turns: readonly MeetingTurn[], speakers: readonly LiveSpeaker[], max: number): string {
  const name = (who: string) => (who === FOUNDER ? FOUNDER_NAME : (speakers.find((s) => s.profile === who)?.tag ?? leadershipName(who)));
  const text = turns.map((t) => `${name(t.speaker)}: ${t.text.trim()}`).join("\n");
  return text.length > max ? `…\n${text.slice(-max)}` : text;
}

function divisionLines(divisions: Record<DivisionId, string> | null): string[] {
  if (!divisions) return ["(The kanban board could not be read just now. Say so if asked; do not guess.)"];
  return DIVISIONS.flatMap((d) => {
    const head = Object.values(SEATS).find((s) => s.division === d.id);
    return [`### ${d.name} (${head ? `${head.tag}, ${head.title}` : "head"})`, divisions[d.id]];
  });
}

export function leadershipPrompt({ meeting, speakers, souls, divisions, lastWeek = null, dashboard = null, now = new Date() }: LeadershipPromptInput): string {
  const roster = speakers.map((s) => {
    const seat = isLeadershipSeat(s.profile) ? SEATS[s.profile] : null;
    const who = seat ? `${seat.name}, ${seat.title}. ${seat.role} ${seat.character}` : `${s.name}.`;
    const soul = souls[s.profile];
    const persona = soul ? condenseExecSoul(soul) : "";
    return `- <${s.tag}>: ${who}${persona ? ` ${persona}` : ""}`;
  });
  const brief = meeting.brief.trim();
  const flow =
    brief && hasAgenda(brief)
      ? `The brief has an agenda. ${FOUNDER_NAME} takes it item by item; move on when he says so.`
      : `${FOUNDER_NAME} opens and steers. A usual order: each executive's short report, then priorities, then the tasks.`;
  const base = [
    "You are running Zain Group's weekly priorities meeting, live by voice. You voice every executive in the room, each in their own voice, and no one else.",
    `${FOUNDER_NAME}, the founder, runs this meeting and is in the room with his microphone always on. ${CEO}, his chief of staff and CEO agent, the COO and the division VPs report to him.`,
    "",
    "## Who is in the room",
    ...roster,
    "",
    "## How to speak (strict)",
    ...RULES.map((r) => `- ${r}`),
    "",
    "## How the meeting runs",
    ...CONDUCT.map((r) => `- ${r}`),
    `- ${flow}`,
    "",
    "## Topic",
    meeting.topic,
    ...(brief ? ["", "## Brief (for reference; do not read it out)", clipLines(brief, BRIEF_CHARS)] : []),
    "",
    "## Last week's priorities",
    lastWeek ? clipLines(lastWeek, WEEKLY_PRIORITIES_CHARS) : "(None recorded yet: this is the first weekly priorities meeting.)",
    "",
    "## Divisions now (live kanban)",
    ...divisionLines(divisions),
    ...withLeadingBlank(dashboardSection(dashboard, LEADERSHIP_DASHBOARD_CHARS, now)),
  ].join("\n");
  const prior = meeting.turns.filter((t) => t.round === meeting.currentRound);
  const room = Math.min(PRIOR_MAX_CHARS, LEADERSHIP_PROMPT_MAX - base.length - 200);
  if (!prior.length || room < PRIOR_MIN_CHARS) return base;
  return [
    base,
    "",
    "## Earlier in this meeting",
    "The call dropped and has just reconnected. Pick up where the discussion left off; do not start over.",
    priorTranscript(prior, speakers, room),
  ].join("\n");
}

function withLeadingBlank(lines: string[]): string[] {
  return lines.length ? ["", ...lines] : [];
}
