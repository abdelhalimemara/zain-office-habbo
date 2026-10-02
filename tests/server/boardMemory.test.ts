import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEMORY_NOTES_PER_MEMBER, type MemoryNote } from "../../shared/boardMemory";
import type { BoardMeeting, MeetingVote } from "../../shared/meetings";
import { boardLedger, ledgerText, memorySection, notesText } from "../../server/src/board/memory/ledger";
import { fileMemoryStore, memoryMemoryStore, mergeNotes, nearDuplicate, splitMemory } from "../../server/src/board/memory/notes";
import { parseVote, roundTaskBody } from "../../server/src/board/meetings/rounds";

const HORMOZI = "zain-board-hormozi";
const BUFFETT = "zain-board-buffett";

const note = (text: string, at: number, id = `note_${String(at).padStart(10, "0").slice(-10)}`): MemoryNote => ({ id, text, at });

function concluded(id: string, at: number, extra: Partial<BoardMeeting> = {}): BoardMeeting {
  const votes: MeetingVote[] = [
    { member: HORMOZI, vote: "approve", rationale: "Raise prices first. Then hire.\nMore detail here." },
    { member: BUFFETT, vote: "reject", rationale: "Cash comes back too slowly." },
  ];
  return {
    id,
    topic: `Topic ${id}`,
    brief: "b",
    members: [HORMOZI, BUFFETT],
    boardOnly: false,
    discussionRounds: 1,
    status: "concluded",
    currentRound: 3,
    turns: [],
    votes,
    decision: "no-decision",
    conclusion: "## Summary\nThe board split on **pricing**.",
    requestedBy: "hq",
    createdAt: at,
    updatedAt: at + 10,
    ...extra,
  };
}

describe("the MEMORY block in a vote", () => {
  it("takes up to three insights from the end and leaves the vote intact", () => {
    const answer = [
      "VOTE: approve-with-conditions",
      "CONDITIONS: cap the spend at SAR 2m",
      "Cairo works if we price high.",
      "",
      "**MEMORY:**",
      "- The founder wants Zain Studio priced as premium, never discounted.",
      "- Cairo budget ceiling is SAR 2m.",
      "* Zain Growth owns paid acquisition.",
      "- A fourth insight is dropped.",
    ].join("\n");
    const { body, insights } = splitMemory(answer);
    expect(insights).toEqual([
      "The founder wants Zain Studio priced as premium, never discounted.",
      "Cairo budget ceiling is SAR 2m.",
      "Zain Growth owns paid acquisition.",
    ]);
    expect(body).not.toContain("MEMORY");
    expect(parseVote(HORMOZI, answer)).toEqual({ member: HORMOZI, vote: "approve-with-conditions", conditions: "cap the spend at SAR 2m", rationale: "Cairo works if we price high." });
  });

  it("does not break the vote when the block comes first, is inline, or says none", () => {
    const first = "MEMORY:\n- Founder prefers revenue share deals.\n\nVOTE: reject\nToo risky.";
    expect(splitMemory(first)).toEqual({ body: "VOTE: reject\nToo risky.", insights: ["Founder prefers revenue share deals."] });
    expect(parseVote(BUFFETT, first)).toMatchObject({ vote: "reject", rationale: "Too risky." });
    expect(splitMemory("VOTE: approve\nGo.\nMEMORY: Labs targets 30% margins").insights).toEqual(["Labs targets 30% margins"]);
    expect(splitMemory("VOTE: approve\nGo.\nMEMORY: none").insights).toEqual([]);
    expect(splitMemory("VOTE: approve\nNo memory here.")).toEqual({ body: "VOTE: approve\nNo memory here.", insights: [] });
    expect(parseVote(BUFFETT, "MEMORY: x\nnot a vote").vote).toBe("abstain");
  });

  it("clips a long insight", () => {
    expect(splitMemory(`VOTE: approve\nMEMORY:\n- ${"word ".repeat(100)}`).insights[0]!.length).toBeLessThanOrEqual(280);
  });
});

describe("merging notes", () => {
  it("spots near-duplicates but keeps different insights", () => {
    expect(nearDuplicate("The founder wants premium pricing.", "the founder wants PREMIUM pricing")).toBe(true);
    expect(nearDuplicate("Founder wants premium pricing for Zain Studio", "Founder wants premium pricing for Zain Studio work")).toBe(true);
    expect(nearDuplicate("Cairo budget ceiling is SAR 2m.", "Riyadh hiring freeze until Q3.")).toBe(false);
  });

  it("puts the newest first, replaces a near-duplicate and drops the oldest past the cap", () => {
    const old = Array.from({ length: MEMORY_NOTES_PER_MEMBER }, (_, i) => note(`distinct insight number ${i} about topic ${i * 7}`, 100 + i));
    const merged = mergeNotes(old, [note("distinct insight number 39 about topic 273", 1000, "note_aaaaaaaaaa"), note("Brand new fact", 1001, "note_bbbbbbbbbb")]);
    expect(merged).toHaveLength(MEMORY_NOTES_PER_MEMBER);
    expect(merged[0]!.text).toBe("Brand new fact");
    expect(merged.filter((n) => n.text.includes("number 39 "))).toHaveLength(1);
    expect(merged.at(-1)!.text).toContain("number 1 ");
  });
});

describe("memory stores", () => {
  let root: string;
  beforeEach(async () => void (root = await mkdtemp(join(tmpdir(), "zain-memory-"))));
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("keeps notes per member in .zain/board-memory and deletes one", async () => {
    const store = fileMemoryStore(root);
    expect(await store.notes(HORMOZI)).toEqual([]);
    const [a, b] = await Promise.all([
      store.add(HORMOZI, { insights: ["Premium pricing only."], at: 10, meetingId: "mtg_0000000001", meetingTopic: "Pricing" }),
      store.add(HORMOZI, { insights: ["Cairo budget is SAR 2m."], at: 11 }),
    ]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
    const saved = JSON.parse(await readFile(join(root, ".zain", "board-memory", `${HORMOZI}.json`), "utf8"));
    expect(saved.notes.map((n: MemoryNote) => n.text)).toEqual(["Cairo budget is SAR 2m.", "Premium pricing only."]);
    expect(saved.notes[1]).toMatchObject({ meetingId: "mtg_0000000001", meetingTopic: "Pricing", at: 10 });
    expect(await store.remove(HORMOZI, saved.notes[0].id)).toBe(true);
    expect(await store.remove(HORMOZI, saved.notes[0].id)).toBe(false);
    expect((await store.notes(HORMOZI)).map((n) => n.text)).toEqual(["Premium pricing only."]);
  });

  it("refuses profiles that are not board seats and ignores junk on disk", async () => {
    const store = fileMemoryStore(root);
    await expect(store.notes("../../etc/passwd")).rejects.toThrow("invalid board profile");
    await expect(store.add("default", { insights: ["x y z w"], at: 1 })).rejects.toThrow("invalid board profile");
    await mkdir(join(root, ".zain", "board-memory"), { recursive: true });
    await writeFile(join(root, ".zain", "board-memory", `${BUFFETT}.json`), JSON.stringify({ notes: [{ id: "bad", text: 1 }, note("ok note", 5, "note_cccccccccc")] }));
    expect((await store.notes(BUFFETT)).map((n) => n.id)).toEqual(["note_cccccccccc"]);
    const mem = memoryMemoryStore();
    expect(await mem.add(HORMOZI, { insights: [], at: 1 })).toEqual([]);
  });
});

describe("the board ledger", () => {
  const meetings = [
    concluded("mtg_0000000001", 1_790_000_000),
    concluded("mtg_0000000002", 1_790_100_000, { mode: "voice", decision: "approved", topic: "Open   Cairo\noffice" }),
    { ...concluded("mtg_0000000003", 1_790_200_000), status: "voting" as const },
  ];

  it("lists concluded meetings newest first with the decision, conclusion and each vote's gist", () => {
    const ledger = boardLedger(meetings);
    expect(ledger.map((e) => e.id)).toEqual(["mtg_0000000002", "mtg_0000000001"]);
    expect(ledger[0]).toMatchObject({ topic: "Open Cairo office", mode: "voice", decision: "approved", tally: "Approve 1 · Reject 1", conclusion: "Summary The board split on pricing." });
    expect(ledger[0]!.votes[0]).toEqual({ member: HORMOZI, vote: "approve", rationale: "Raise prices first." });
    const text = ledgerText(ledger, 10_000);
    expect(text.split("\n")[0]).toBe(`- 2026-09-22 · voice meeting "Open Cairo office" → approved (Approve 1 · Reject 1)`);
    expect(text).toContain("  Alex Hormozi: approve — Raise prices first.");
    expect(boardLedger(Array.from({ length: 15 }, (_, i) => concluded(`mtg_${String(i).padStart(10, "0")}`, i)))).toHaveLength(10);
  });

  it("stays within its budget, keeping whole meetings, and filters lines", () => {
    const ledger = boardLedger(meetings);
    const one = ledgerText(ledger, 300);
    expect(one.length).toBeLessThanOrEqual(300);
    expect(one).toContain("Open Cairo office");
    expect(one).not.toContain("Topic mtg_0000000001");
    expect(ledgerText(ledger, 10_000, (l) => !l.includes("Cairo"))).not.toContain("Open Cairo");
    expect(notesText([note("older", 1_790_000_000), note("newer", 1_790_100_000)], 1000)).toBe("- 2026-09-22: newer\n- 2026-09-21: older");
  });

  it("puts the ledger and the member's own notes into Hermes round prompts", () => {
    const section = memorySection(boardLedger(meetings), [note("Founder hates discounts.", 1_790_000_000)]);
    expect(section[0]).toBe("## What the board already knows");
    const body = roundTaskBody(concluded("mtg_0000000009", 1, { status: "in-round", currentRound: 1, votes: [] }), 1, section);
    expect(body).toContain("### Earlier board meetings");
    expect(body).toContain("### Your notes from earlier meetings\n- 2026-09-21: Founder hates discounts.");
    expect(memorySection([], [])).toEqual([]);
  });
});
