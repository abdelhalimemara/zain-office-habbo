import { readFile } from "node:fs/promises";
import { dashboardSection, LIVE_DASHBOARD_CHARS } from "../board/memory/dashboard";
import { join } from "node:path";
import { findBoardMember } from "../../../shared/board";
import type { MemoryNote } from "../../../shared/boardMemory";
import type { BoardMeeting, MeetingTurn } from "../../../shared/meetings";
import type { LiveSpeaker } from "../../../shared/voice";
import { hermesHome } from "../clientChannels/hermesPaths";
import { ledgerText, notesText, type LedgerEntry } from "../board/memory/ledger";
import { FOUNDER, speakerName } from "../board/meetings/rounds";
import { speakerTag } from "./liveAgent";
import { speechText } from "./speech";

export const FOUNDER_NAME = "Abdelhalim";
/** About 300 words of persona per member. */
export const PERSONA_MAX_CHARS = 1800;
/** "What the board already knows": the ledger, then every member's notes shared out. */
export const LIVE_LEDGER_CHARS = 1800;
export const LIVE_NOTES_CHARS = 1500;
/** The founder opens the meeting: an empty first message makes the agent wait for him. */
export const LIVE_FIRST_MESSAGE = "";
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

/** Each meeting member with a multi-voice tag. There is no chair: the founder leads the meeting himself. */
export function liveSpeakers(meeting: Pick<BoardMeeting, "members">): LiveSpeaker[] {
  return meeting.members
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

/** Runs of this many words shared with a brief mark a memory line as repeating it. */
const SHINGLE_WORDS = 5;

function shingles(n: string): string[] {
  const w = n.split(" ").filter(Boolean);
  return w.length < SHINGLE_WORDS ? [] : w.slice(0, w.length - SHINGLE_WORDS + 1).map((_, i) => w.slice(i, i + SHINGLE_WORDS).join(" "));
}

/**
 * The privacy guard for memory lines bound for the live prompt: false for any line that repeats any member's
 * private brief, by the persona rule (contained either way) or by sharing a run of five words with it.
 */
export function briefSafe(briefs: readonly (string | null | undefined)[]): (line: string) => boolean {
  const known = briefs.filter((b): b is string => !!b?.trim()).map((b) => ({ whole: normalized(b), parts: briefParts(b) }));
  const runs = new Set(known.flatMap((k) => shingles(k.whole)));
  return (line) => !known.some((k) => fromBrief(line, k.whole, k.parts)) && !shingles(normalized(line)).some((s) => runs.has(s));
}

/** The ledger and each member's notes, every line passed through the brief guard. Empty when the board knows nothing yet. */
function boardKnows(speakers: readonly LiveSpeaker[], ledger: readonly LedgerEntry[], notes: Record<string, readonly MemoryNote[]>, safe: (line: string) => boolean): string[] {
  const past = ledgerText(ledger, LIVE_LEDGER_CHARS, safe);
  const share = Math.floor(LIVE_NOTES_CHARS / Math.max(1, speakers.length));
  const mine = speakers.map((s) => [s, notesText(notes[s.profile] ?? [], share, safe)] as const).filter(([, t]) => t);
  if (!past && mine.length === 0) return [];
  return [
    "",
    "## What the board already knows",
    `From earlier meetings, newest first. Build on it and never ask ${FOUNDER_NAME} to repeat it; mention it only when it is relevant.`,
    ...(past ? ["", "### Earlier meetings", past] : []),
    ...mine.flatMap(([s, t]) => ["", `### ${s.name} remembers`, t]),
  ];
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
  "Wrap every line in its speaker's tag, exactly as listed, e.g. <Hormozi>Your offer is too cheap.</Hormozi>. Close every tag and never nest tags.",
  "Every word you say is inside a board member's tag. There is no chair, host or narrator: never say anything outside a tag.",
  "Each speaker turn is 1 to 3 short spoken sentences. A reply holds one to three speakers, then stops so the room can react.",
  "Make it a real conversation: members react to what was just said, address each other by name, disagree, build on each other's points and cut in on each other naturally.",
  `${FOUNDER_NAME} can interrupt at any time. When he speaks, the member he addresses (or the most relevant one) answers him directly and briefly; ask him for his view now and then.`,
  `${FOUNDER_NAME} opens the meeting: wait for him to speak first. If he is silent at the very start, one member may briefly ask him to open, nothing more. Once it is under way and he goes quiet, keep the discussion moving among the members.`,
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
  /** Concluded meetings, newest first (board/memory/ledger.ts). */
  ledger?: readonly LedgerEntry[];
  /** Each member's memory notes. */
  notes?: Record<string, readonly MemoryNote[]>;
  /** The company dashboard markdown (board/memory/dashboard.ts), if there is one. */
  dashboard?: string | null;
}

export function livePrompt({ meeting, speakers, souls, briefs = {}, ledger = [], notes = {}, dashboard = null }: LivePromptInput): string {
  const safe = briefSafe(Object.values(briefs));
  const roster = [
    ...speakers.map((s) => {
      const soul = souls[s.profile];
      const brief = briefs[s.profile] ?? null;
      const persona = (soul ? condenseSoul(soul, brief) : "") || fallbackPersona(s.profile, brief);
      return `- <${s.tag}>: ${s.name}. ${persona}`;
    }),
  ];
  const agenda = hasAgenda(meeting.brief);
  const flow = agenda
    ? `The brief has an agenda. ${FOUNDER_NAME} takes it item by item: the members discuss each item he raises and move on when he says so.`
    : `This is an open-floor discussion. ${FOUNDER_NAME} opens it; after that, follow the conversation wherever it goes.`;
  const prior = meeting.turns.filter((t) => t.round === meeting.currentRound);
  return [
    `You are running a live board meeting of Zain Group's board of advisors, by voice. You voice every board member, each in their own voice, and no one else.`,
    `${FOUNDER_NAME}, the founder, is the CEO of Zain Group. He leads this meeting and is in the room with his microphone always on. There is no chair; the board advises him.`,
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
    ...boardKnows(speakers, ledger, notes, safe),
    ...withLeadingBlank(dashboardSection(dashboard, LIVE_DASHBOARD_CHARS, new Date(), safe)),
    ...(prior.length
      ? ["", "## Earlier in this meeting", "The call dropped and has just reconnected. Pick up where the discussion left off; do not start over.", priorTranscript(prior, speakers)]
      : []),
  ].join("\n");
}

function withLeadingBlank(lines: string[]): string[] {
  return lines.length ? ["", ...lines] : [];
}
