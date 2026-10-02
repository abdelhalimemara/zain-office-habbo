import type { MemoryNote } from "../../../../shared/boardMemory";
import type { BoardMeeting, Decision, MeetingMode, Vote } from "../../../../shared/meetings";
import { speakerName, votesSummary } from "../meetings/rounds";

/** Concluded meetings carried into prompts. */
export const LEDGER_MEETINGS = 10;
/** Hermes-side prompt budgets (the live prompt sets its own, smaller ones). */
export const HERMES_LEDGER_CHARS = 3500;
export const HERMES_NOTES_CHARS = 2500;
const CONCLUSION_CHARS = 280;
const RATIONALE_CHARS = 110;

/** One concluded meeting, as the board remembers it. Derived from .zain/meetings.json; never stored. */
export interface LedgerEntry {
  id: string;
  topic: string;
  /** Unix seconds the meeting was called. */
  date: number;
  mode: MeetingMode;
  decision: Decision;
  tally: string;
  conclusion: string;
  votes: { member: string; vote: Vote; rationale: string }[];
}

const oneLine = (text: string) => text.replace(/[#*_`>]+/g, "").replace(/\s+/g, " ").trim();

function clip(text: string, max: number): string {
  const t = oneLine(text);
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** The first sentence or line, clipped: the gist of a rationale. */
function gist(text: string, max: number): string {
  const first = text.replace(/\r/g, "").split("\n").find((l) => oneLine(l)) ?? "";
  const sentence = /^(.+?[.!?])(\s|$)/.exec(oneLine(first))?.[1] ?? first;
  return clip(sentence, max);
}

export function boardLedger(meetings: readonly BoardMeeting[], max = LEDGER_MEETINGS): LedgerEntry[] {
  return meetings
    .filter((m) => m.status === "concluded")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, max)
    .map((m) => ({
      id: m.id,
      topic: oneLine(m.topic),
      date: m.createdAt,
      mode: m.mode ?? "chat",
      decision: m.decision ?? "no-decision",
      tally: votesSummary(m.votes),
      conclusion: clip(m.conclusion ?? "", CONCLUSION_CHARS),
      votes: m.votes.map((v) => ({ member: v.member, vote: v.vote, rationale: gist(v.rationale, RATIONALE_CHARS) })),
    }));
}

export const isoDate = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

/** A ledger entry's lines: the heading first, then the conclusion and one line per vote. */
export function entryLines(e: LedgerEntry): string[] {
  return [
    `- ${isoDate(e.date)} · ${e.mode === "voice" ? "voice" : "written"} meeting "${e.topic}" → ${e.decision} (${e.tally})`,
    ...(e.conclusion ? [`  Conclusion: ${e.conclusion}`] : []),
    ...e.votes.map((v) => `  ${speakerName(v.member)}: ${v.vote}${v.rationale ? ` — ${v.rationale}` : ""}`),
  ];
}

/** Lines that pass `keep`, whole items newest first, until `budget` characters are used. */
function budgeted(items: readonly string[][], budget: number, keep: (line: string) => boolean): string {
  const out: string[] = [];
  let used = 0;
  for (const item of items) {
    const lines = item.filter(keep);
    if (!lines[0]?.startsWith("- ")) continue;
    const size = lines.join("\n").length + 1;
    if (used + size > budget) break;
    out.push(...lines);
    used += size;
  }
  return out.join("\n");
}

/** The ledger as text, newest first, within `budget` characters. `keep` filters every line (the live privacy guard). */
export function ledgerText(entries: readonly LedgerEntry[], budget: number, keep: (line: string) => boolean = () => true): string {
  return budgeted(entries.map(entryLines), budget, keep);
}

/** A member's notes as dated bullets, newest first, within `budget` characters. */
export function notesText(notes: readonly MemoryNote[], budget: number, keep: (line: string) => boolean = () => true): string {
  const sorted = [...notes].sort((a, b) => b.at - a.at);
  return budgeted(sorted.map((n) => [`- ${isoDate(n.at)}: ${oneLine(n.text)}`]), budget, keep);
}

/** "What the board already knows" for a Hermes task: the ledger and the member's own notes. Empty when there is nothing yet. */
export function memorySection(entries: readonly LedgerEntry[], notes: readonly MemoryNote[]): string[] {
  const ledger = ledgerText(entries, HERMES_LEDGER_CHARS);
  const mine = notesText(notes, HERMES_NOTES_CHARS);
  if (!ledger && !mine) return [];
  return [
    "## What the board already knows",
    "Build on this; do not ask the founder to repeat it. Newest first.",
    "",
    ...(ledger ? ["### Earlier board meetings", ledger, ""] : []),
    ...(mine ? ["### Your notes from earlier meetings", mine, ""] : []),
  ];
}
