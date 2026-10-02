import type { BoardMemoryResponse } from "../../shared/boardMemory";
import type { BoardMeeting } from "../../shared/meetings";
import { memoryMemoryStore } from "../../server/src/board/memory/notes";
import { minutesTaskBody } from "../../server/src/board/meetings/rounds";
import { fakeKanban } from "./fakeKanban";
import { KANBAN, setup } from "./helpers";

const HORMOZI = "zain-board-hormozi";
const BUFFETT = "zain-board-buffett";
const START = { topic: "Price Zain Studio", brief: "Should we raise Studio retainers by 20%?", boardOnly: true };

const VOTE = (who: string) =>
  [
    "VOTE: approve",
    `${who} says raise them.`,
    "",
    "MEMORY:",
    `- ${who === HORMOZI ? "Founder wants Studio priced as a premium brand" : "Founder will not take on debt for expansion"}.`,
    "- Studio retainers start at SAR 40k a month.",
  ].join("\n");

function room() {
  const kanban = fakeKanban([HORMOZI, BUFFETT]);
  const clock = { t: 1_790_000_000 };
  const memory = memoryMemoryStore();
  const s = setup(kanban.routes, { now: () => clock.t, memory });
  const start = async (body: Record<string, unknown> = {}) =>
    (await (await s.send("POST", "/api/board/meetings", { ...START, ...body })).json()).meeting as BoardMeeting;
  /** Runs a board-only meeting with one discussion round to its end. */
  const runToEnd = async (id: string, vote = VOTE) => {
    kanban.completeAll("· Opening", (t) => `${t.assignee} opens.`);
    await s.meetings.tick();
    kanban.completeAll("· Discussion 1", (t) => `${t.assignee} discusses.`);
    await s.meetings.tick();
    kanban.completeAll("· Vote", (t) => vote(t.assignee!));
    await s.meetings.tick();
    kanban.completeAll("· Minutes", () => "The board approved a 20% rise.");
    clock.t += 60;
    await s.meetings.tick();
    return s.meetings.get(id);
  };
  return { ...s, kanban, clock, memory, start, runToEnd };
}

describe("board memory across meetings", () => {
  it("asks for a MEMORY block in the vote, keeps it per member, and leaves the vote and transcript clean", async () => {
    const r = room();
    const meeting = await r.start();
    const ended = await r.runToEnd(meeting.id);
    expect(ended.status).toBe("concluded");
    expect(ended.votes.map((v) => [v.member, v.vote, v.rationale])).toEqual([
      [HORMOZI, "approve", `${HORMOZI} says raise them.`],
      [BUFFETT, "approve", `${BUFFETT} says raise them.`],
    ]);
    expect(ended.turns.filter((t) => t.kind === "vote" && t.speaker !== "default").every((t) => !t.text.includes("MEMORY"))).toBe(true);

    const voteBody = r.kanban.byTitle("· Vote")[0]!.body!;
    expect(voteBody).toContain("MEMORY:");
    expect(voteBody).toContain("`memory` tool");

    const notes = await r.memory.notes(HORMOZI);
    expect(notes.map((n) => n.text)).toEqual(["Founder wants Studio priced as a premium brand.", "Studio retainers start at SAR 40k a month."]);
    expect(notes[0]).toMatchObject({ meetingId: meeting.id, meetingTopic: "Price Zain Studio", at: 1_790_000_000 });
  });

  it("briefs the next meeting and consultations with the ledger and each member's own notes", async () => {
    const r = room();
    const first = await r.start();
    await r.runToEnd(first.id);

    r.clock.t += 3600;
    await r.start({ topic: "Cairo office" });
    const opening = r.kanban.byTitle("Cairo office · Opening");
    const hormozi = opening.find((t) => t.assignee === HORMOZI)!.body!;
    const buffett = opening.find((t) => t.assignee === BUFFETT)!.body!;
    expect(hormozi).toContain("## What the board already knows");
    expect(hormozi).toContain(`written meeting "Price Zain Studio" → approved (Approve 2)`);
    expect(hormozi).toContain("Conclusion: The board approved a 20% rise.");
    expect(hormozi).toContain("Founder wants Studio priced as a premium brand.");
    expect(hormozi).not.toContain("Founder will not take on debt");
    expect(buffett).toContain("Founder will not take on debt");

    const res = await r.send("POST", "/api/board/consult", { question: "Should we hire?", members: [BUFFETT] });
    expect(res.status).toBe(201);
    const consult = r.hermesFetch.called(`POST ${KANBAN}/tasks`).at(-1)!.body as { body: string };
    expect(consult.body).toContain("Should we hire?");
    expect(consult.body).toContain("Founder will not take on debt");
    expect(consult.body).toContain("Price Zain Studio");
  });

  it("keeps the vote when the member skips or mangles the MEMORY block, and dedupes repeats", async () => {
    const r = room();
    const a = await r.start();
    await r.runToEnd(a.id);
    const b = await r.start({ topic: "Again" });
    const ended = await r.runToEnd(b.id, (who) => (who === HORMOZI ? VOTE(who) : "VOTE: reject\nNo.\nMEMORY:"));
    expect(ended.votes.map((v) => v.vote)).toEqual(["approve", "reject"]);
    expect(await r.memory.notes(HORMOZI)).toHaveLength(2);
    expect(await r.memory.notes(BUFFETT)).toHaveLength(2);
  });

  it("tells the CEO it only takes neutral notes", () => {
    const body = minutesTaskBody({ id: "mtg_0000000001", topic: "T", brief: "B", members: [], boardOnly: true, discussionRounds: 1, status: "minutes", currentRound: 3, turns: [], votes: [], requestedBy: "hq", createdAt: 0, updatedAt: 0 });
    expect(body).toContain("You are not a board member");
    expect(body).toContain("Abdelhalim, is the CEO in the boardroom");
    expect(body).toContain("no opinions");
    expect(body).not.toMatch(/You chair/);
  });
});

describe("the board memory API", () => {
  it("lists every board seat's notes and deletes one", async () => {
    const r = room();
    await r.memory.add(HORMOZI, { insights: ["Founder wants premium pricing."], at: 5 });
    const list = (await (await r.send("GET", "/api/board/memory")).json()) as BoardMemoryResponse;
    expect(list.members.map((m) => m.profile)).toEqual(expect.arrayContaining([HORMOZI, BUFFETT]));
    const [noteOf] = list.members.find((m) => m.profile === HORMOZI)!.notes;
    expect(noteOf!.text).toBe("Founder wants premium pricing.");

    const path = `/api/board/memory/${HORMOZI}/notes/${noteOf!.id}`;
    expect((await r.send("DELETE", path, {})).status).toBe(204);
    expect(await r.memory.notes(HORMOZI)).toEqual([]);
    expect((await r.send("DELETE", path, {})).status).toBe(404);
  });

  it("validates the member and note id, and sits behind the origin guard", async () => {
    const r = room();
    const [note] = await r.memory.add(BUFFETT, { insights: ["Keep it."], at: 5 });
    expect((await r.send("DELETE", `/api/board/memory/default/notes/${note!.id}`, {})).status).toBe(400);
    expect((await r.send("DELETE", `/api/board/memory/zain-board-nobody/notes/${note!.id}`, {})).status).toBe(400);
    expect((await r.send("DELETE", `/api/board/memory/${BUFFETT}/notes/note_x`, {})).status).toBe(400);
    expect((await r.send("DELETE", `/api/board/memory/${BUFFETT}/notes/${note!.id}`)).status).toBe(415);
    expect((await r.send("DELETE", `/api/board/memory/${BUFFETT}/notes/${note!.id}`, {}, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await r.send("GET", "/api/board/memory", undefined, { Host: "evil.example" })).status).toBe(403);
    expect(await r.memory.notes(BUFFETT)).toHaveLength(1);
  });
});
