import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MEMORY_NOTES_PER_MEMBER, MEMORY_NOTES_PER_VOTE, MEMORY_NOTE_ID, MEMORY_NOTE_MAX, type MemoryNote } from "../../../../shared/boardMemory";

export const BOARD_PROFILE = /^zain-board-[a-z0-9-]{1,48}$/;

const MEMORY_LINE = /^\s*[*_#>\s]*memory\s*[*_]*\s*:\s*[*_]*\s*(.*)$/i;
const VOTE_LINE = /^\s*\**\s*vote\s*\**\s*:/i;
const BULLET = /^\s*(?:[-*•]|\d{1,2}[.)])\s+/;

/**
 * Splits a vote answer into the answer proper and the insights of its `MEMORY:` block.
 * After the VOTE line, the block runs to the end of the text; anywhere else it is the bullet lines right under it.
 * Without a MEMORY line the text comes back untouched, so the vote contract never depends on the block.
 */
export function splitMemory(text: string): { body: string; insights: string[] } {
  const lines = text.replace(/\r/g, "").split("\n");
  const at = lines.map((l) => MEMORY_LINE.test(l)).lastIndexOf(true);
  if (at < 0) return { body: text, insights: [] };
  const voteAt = lines.findIndex((l) => VOTE_LINE.test(l));
  const toEnd = voteAt >= 0 && voteAt < at;
  let end = at + 1;
  while (end < lines.length && (toEnd || !lines[end]!.trim() || BULLET.test(lines[end]!))) end++;
  const inline = MEMORY_LINE.exec(lines[at]!)![1]!;
  const insights = [inline, ...lines.slice(at + 1, end)].map(cleanInsight).filter((s): s is string => s !== null);
  const body = [...lines.slice(0, at), ...lines.slice(end)].join("\n").trim();
  return { body, insights: insights.slice(0, MEMORY_NOTES_PER_VOTE) };
}

function cleanInsight(line: string): string | null {
  const text = line.replace(BULLET, "").replace(/[*_`]+/g, "").replace(/\s+/g, " ").trim();
  if (text.length < 4 || /^(?:none|n\/a|nothing( new)?)\.?$/i.test(text)) return null;
  return text.length > MEMORY_NOTE_MAX ? `${text.slice(0, MEMORY_NOTE_MAX - 1).trimEnd()}…` : text;
}

const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Same insight in other words: equal or contained once normalized, or nearly the same set of words. */
export function nearDuplicate(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (!x || !y) return x === y;
  if (x === y || (Math.min(x.length, y.length) >= 24 && (x.includes(y) || y.includes(x)))) return true;
  const xs = new Set(x.split(" "));
  const ys = new Set(y.split(" "));
  const shared = [...xs].filter((w) => ys.has(w)).length;
  return shared / (xs.size + ys.size - shared) >= 0.8;
}

/** Adds insights newest first, replacing near-duplicates and keeping at most `cap` notes. */
export function mergeNotes(notes: readonly MemoryNote[], added: readonly MemoryNote[], cap = MEMORY_NOTES_PER_MEMBER): MemoryNote[] {
  let next = [...notes];
  // Last first, so a vote's insights keep their order on top.
  for (const note of [...added].reverse()) next = [note, ...next.filter((n) => !nearDuplicate(n.text, note.text))];
  return next.sort((a, b) => b.at - a.at).slice(0, cap);
}

export interface NewNotes {
  insights: readonly string[];
  at: number;
  meetingId?: string;
  meetingTopic?: string;
}

/** Each board member's notes. Profiles are validated here, since they become file names. */
export interface MemoryStore {
  notes(profile: string): Promise<MemoryNote[]>;
  add(profile: string, input: NewNotes): Promise<MemoryNote[]>;
  /** False when there was no such note. */
  remove(profile: string, id: string): Promise<boolean>;
}

function checkProfile(profile: string): void {
  if (!BOARD_PROFILE.test(profile)) throw new Error(`invalid board profile ${profile}`);
}

const newNotes = ({ insights, at, meetingId, meetingTopic }: NewNotes): MemoryNote[] =>
  insights.map((text) => ({ id: `note_${randomBytes(5).toString("hex")}`, text, at, ...(meetingId ? { meetingId } : {}), ...(meetingTopic ? { meetingTopic } : {}) }));

function isNote(v: unknown): v is MemoryNote {
  const n = v as MemoryNote;
  return !!n && typeof n.id === "string" && MEMORY_NOTE_ID.test(n.id) && typeof n.text === "string" && typeof n.at === "number";
}

/** Keeps notes per profile; writes to one profile are serialized so concurrent votes never lose each other. */
function serializedStore(read: (profile: string) => Promise<MemoryNote[]>, write: (profile: string, notes: MemoryNote[]) => Promise<void>): MemoryStore {
  const queues = new Map<string, Promise<unknown>>();
  const update = async <T>(profile: string, job: (notes: MemoryNote[]) => Promise<T>): Promise<T> => {
    checkProfile(profile);
    const run = (queues.get(profile) ?? Promise.resolve()).then(async () => job(await read(profile)));
    queues.set(profile, run.catch(() => undefined));
    return run;
  };
  return {
    notes: async (profile) => {
      checkProfile(profile);
      return read(profile);
    },
    add: (profile, input) =>
      update(profile, async (notes) => {
        if (input.insights.length === 0) return notes;
        const next = mergeNotes(notes, newNotes(input));
        await write(profile, next);
        return next;
      }),
    remove: (profile, id) =>
      update(profile, async (notes) => {
        const next = notes.filter((n) => n.id !== id);
        if (next.length === notes.length) return false;
        await write(profile, next);
        return true;
      }),
  };
}

export function memoryMemoryStore(initial: Record<string, MemoryNote[]> = {}): MemoryStore {
  const data = new Map(Object.entries(structuredClone(initial)));
  return serializedStore(
    async (p) => structuredClone(data.get(p) ?? []),
    async (p, notes) => void data.set(p, structuredClone(notes)),
  );
}

/** `<root>/.zain/board-memory/<profile>.json` (gitignored with the rest of .zain). */
export function fileMemoryStore(root: string): MemoryStore {
  const dir = join(root, ".zain", "board-memory");
  const file = (profile: string) => join(dir, `${profile}.json`);
  return serializedStore(
    async (profile) => {
      try {
        const data = JSON.parse(await readFile(file(profile), "utf8")) as { notes?: unknown };
        return Array.isArray(data.notes) ? data.notes.filter(isNote) : [];
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT" || err instanceof SyntaxError) return [];
        throw err;
      }
    },
    async (profile, notes) => {
      await mkdir(dir, { recursive: true });
      const tmp = `${file(profile)}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(tmp, `${JSON.stringify({ profile, notes }, null, 2)}\n`, "utf8");
      await rename(tmp, file(profile));
    },
  );
}
