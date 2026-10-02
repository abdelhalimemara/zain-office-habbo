import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findBoardMember } from "../../../shared/board";
import type { BoardMeeting, MeetingTurn } from "../../../shared/meetings";
import { CHAIR_PROFILE, type LiveSpeaker } from "../../../shared/voice";
import { hermesHome } from "../clientChannels/hermesPaths";
import { FOUNDER, speakerName } from "../board/meetings/rounds";
import { speakerTag } from "./liveAgent";
import { speechText } from "./speech";

export const FOUNDER_NAME = "Abdelhalim";
/** About 300 words of persona per member. */
export const PERSONA_MAX_CHARS = 1800;
/** The most recent part of earlier sessions that a reconnect carries into the prompt. */
const PRIOR_MAX_CHARS = 12_000;
const PROFILE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Reads a member's SOUL.md; null when there is none. */
export type SoulReader = (profile: string) => Promise<string | null>;

/** `$HERMES_HOME/profiles/<profile>/SOUL.md`, read at call time. */
export function fileSouls(home = hermesHome()): SoulReader {
  return async (profile) => {
    if (!PROFILE.test(profile)) return null;
    try {
      return await readFile(join(home, "profiles", profile, "SOUL.md"), "utf8");
    } catch {
      return null;
    }
  };
}

/** The chair, then each meeting member with a multi-voice tag. */
export function liveSpeakers(meeting: Pick<BoardMeeting, "members">): LiveSpeaker[] {
  return [CHAIR_PROFILE, ...meeting.members]
    .map((profile) => ({ tag: speakerTag(profile), profile, name: speakerName(profile) }))
    .filter((s) => s.tag);
}

/** Text compared for the private-brief guard: no markdown, punctuation, case or spacing differences. */
function normalized(text: string): string {
  return speechText(text, Number.MAX_SAFE_INTEGER).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Paragraphs and lines of a private brief, normalized; parts too short to identify anything are left out. */
function briefParts(brief: string): string[] {
  const parts = brief.replace(/\r/g, "").split(/\n\s*\n|\n/).map(normalized);
  return parts.filter((p) => p.length >= 20);
}

/** True when a persona line repeats the private brief, in either direction. */
function fromBrief(line: string, whole: string, parts: readonly string[]): boolean {
  const n = normalized(line);
  if (!n) return false;
  return (n.length >= 8 && whole.includes(n)) || parts.some((p) => n.includes(p));
}

/**
 * A SOUL condensed to the member's public persona: the seat line and the lens section, nothing else.
 * The private brief that boardSoul embeds (and everything else) is left out, and as a second guard any line
 * that repeats `brief` (the member's `.zain/board/<profile>.md`, when present) is dropped. No brief text is ever sent.
 */
export function condenseSoul(soul: string, brief: string | null = null, max = PERSONA_MAX_CHARS): string {
  const kept: string[] = [];
  let section: string | null = null;
  for (const line of soul.replace(/\r/g, "").split("\n")) {
    const heading = /^#{2,6}\s+(.*)$/.exec(line);
    if (heading) {
      section = heading[1]!.trim().toLowerCase();
      continue;
    }
    if (section === null && /^Seat:/.test(line)) kept.push(line.replace(/\s*Your Hermes profile is `[^`]*`\.?/, ""));
    else if (section === "your lens") kept.push(line);
  }
  return guarded(kept, brief, max);
}

function guarded(lines: readonly string[], brief: string | null, max: number): string {
  const whole = brief ? normalized(brief) : "";
  const parts = brief ? briefParts(brief) : [];
  const safe = brief ? lines.filter((l) => !fromBrief(l, whole, parts)) : lines;
  return speechText(safe.join("\n"), max).replace(/\s*\n\s*/g, " ");
}

function fallbackPersona(profile: string, brief: string | null): string {
  const m = findBoardMember(profile);
  return m ? guarded([`Seat: ${m.seat}.`, ...m.lens], brief, PERSONA_MAX_CHARS) : "";
}

/** True when the brief sets out items to take in order: numbered or bulleted lines, or an explicit agenda. */
export function hasAgenda(brief: string): boolean {
  if (/\bagenda\b|جدول الأعمال/i.test(brief)) return true;
  return brief.split("\n").filter((l) => /^\s*(?:\d{1,2}[.)]|[-*•])\s+\S/.test(l)).length >= 2;
}

/** Earlier sessions of this meeting, newest kept when long. */
function priorTranscript(turns: readonly MeetingTurn[], speakers: readonly LiveSpeaker[]): string {
  const name = (who: string) => (who === FOUNDER ? FOUNDER_NAME : (speakers.find((s) => s.profile === who)?.tag ?? speakerName(who)));
  const text = turns.map((t) => `${name(t.speaker)}: ${t.text.trim()}`).join("\n");
  return text.length > PRIOR_MAX_CHARS ? `…\n${text.slice(-PRIOR_MAX_CHARS)}` : text;
}

const RULES = [
  "Wrap every line in its speaker's tag, exactly as listed, e.g. <Hormozi>Your offer is too cheap.</Hormozi>. Close every tag and never nest tags. The chair's lines go in <Chair>…</Chair>.",
  "Each speaker turn is 1 to 3 short spoken sentences. A reply holds one to three speakers, then stops so the room can react.",
  "Make it a real conversation: members react to what was just said, address each other by name, disagree, build on each other's points and cut in on each other naturally.",
  `${FOUNDER_NAME} can interrupt at any time. When he speaks, the member he addresses (or the most relevant one) answers him directly and briefly; ask him for his view now and then.`,
  "If he is silent, keep the discussion moving among the members; do not wait for him.",
  "Spoken words only: no stage directions, no actions in asterisks or brackets, no markdown, no lists, no emojis, no speaker names before lines. Never read the brief aloud; refer to it in your own words.",
  `Speak English. If ${FOUNDER_NAME} speaks Arabic, everyone answers in Arabic until he switches back.`,
  "Each member speaks only from their own persona below. They are AI advisors modelled on public figures' published thinking: never claim to be the real person, and never invent private facts or quotes.",
  "Do not hold a vote or announce a decision. When the founder ends the meeting, the board votes separately.",
];

export interface LivePromptInput {
  meeting: BoardMeeting;
  speakers: readonly LiveSpeaker[];
  /** Raw SOUL.md per member profile; null when missing. */
  souls: Record<string, string | null>;
  /** Each member's private brief, only to keep it out of the prompt; null when missing. */
  briefs?: Record<string, string | null>;
}

export function livePrompt({ meeting, speakers, souls, briefs = {} }: LivePromptInput): string {
  const members = speakers.filter((s) => s.profile !== CHAIR_PROFILE);
  const roster = [
    `- <Chair>: the CEO of Zain Group, who chairs the meeting. Keeps it moving, brings in quiet members, and sums up briefly when asked. Says little.`,
    ...members.map((s) => {
      const soul = souls[s.profile];
      const brief = briefs[s.profile] ?? null;
      const persona = (soul ? condenseSoul(soul, brief) : "") || fallbackPersona(s.profile, brief);
      return `- <${s.tag}>: ${s.name}. ${persona}`;
    }),
  ];
  const agenda = hasAgenda(meeting.brief);
  const flow = agenda
    ? "The brief has an agenda. Take it item by item: the chair names each item in a sentence, the members discuss it, and the chair moves on when it has been covered or when the founder says so."
    : `This is an open-floor discussion. The chair opens in one or two sentences and invites ${FOUNDER_NAME} or a member to start; after that, follow the conversation wherever it goes.`;
  const prior = meeting.turns.filter((t) => t.round === meeting.currentRound);
  return [
    `You are running a live board meeting of Zain Group's board of advisors, by voice. You voice the chair and every board member, each in their own voice. ${FOUNDER_NAME}, the founder, is in the room with his microphone always on.`,
    "",
    "## Who is in the room",
    ...roster,
    "",
    "## How to speak (strict)",
    ...RULES.map((r) => `- ${r}`),
    "",
    "## How the meeting runs",
    flow,
    "",
    "## Topic",
    meeting.topic,
    "",
    "## Brief (for reference; do not read it out)",
    meeting.brief,
    ...(prior.length
      ? ["", "## Earlier in this meeting", "The call dropped and has just reconnected. Pick up where the discussion left off; do not start over.", priorTranscript(prior, speakers)]
      : []),
  ].join("\n");
}

export function liveFirstMessage(meeting: BoardMeeting): string {
  const topic = meeting.topic.replace(/\s+/g, " ").trim();
  if (meeting.turns.some((t) => t.round === meeting.currentRound)) return `We're back, ${FOUNDER_NAME}. Let's pick up where we left off.`;
  if (hasAgenda(meeting.brief)) return `Welcome, ${FOUNDER_NAME}. We're here on ${topic}, and we'll take the agenda item by item.`;
  return `Welcome, ${FOUNDER_NAME}. We're here on ${topic}. The floor is open: who wants to start?`;
}
