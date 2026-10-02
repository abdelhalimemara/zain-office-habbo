import type { BoardMeeting } from "../../shared/meetings";
import type { MeetingSink } from "../../server/src/board/meetings/engine";
import { fakeKanban } from "./fakeKanban";
import { KANBAN, setup } from "./helpers";

const HORMOZI = "zain-board-hormozi";
const BUFFETT = "zain-board-buffett";
const START = { topic: "Enter the Egyptian market", brief: "Should Zain Studio open a Cairo office in 2027? Budget SAR 2m." };

function room(opts: { hired?: string[]; sink?: MeetingSink & { syncConsultation: never }; clock?: { t: number } } = {}) {
  const kanban = fakeKanban(opts.hired ?? [HORMOZI, BUFFETT]);
  const clock = opts.clock ?? { t: 1_790_000_000 };
  const s = setup(kanban.routes, { now: () => clock.t, sink: opts.sink as never });
  const start = async (body: Record<string, unknown> = {}) => {
    const res = await s.send("POST", "/api/board/meetings", { ...START, ...body });
    return { res, meeting: (await res.json()).meeting as BoardMeeting };
  };
  const remark = async (id: string, body: Record<string, unknown>) => s.send("POST", `/api/board/meetings/${id}/remarks`, body);
  const get = async (id: string) => ((await (await s.send("GET", `/api/board/meetings/${id}`)).json()).meeting as BoardMeeting);
  const answerRound = (label: string, text = (who: string) => `${who} thinks Cairo is promising.`) =>
    kanban.completeAll(`· ${label}`, (t) => text(t.assignee!));
  return { ...s, kanban, clock, start, remark, get, answerRound };
}

describe("starting a meeting", () => {
  it.each([
    [{ topic: "" }, "topic"],
    [{ brief: "x".repeat(8001) }, "brief"],
    [{ discussionRounds: 0 }, "discussionRounds"],
    [{ discussionRounds: 4 }, "discussionRounds"],
    [{ boardOnly: "yes" }, "boardOnly"],
    [{ requestedBy: "intern" }, "requestedBy"],
    [{ members: [] }, "members"],
    [{ members: ["zain-hq-coo"] }, "not board members"],
  ])("rejects bad input %#", async (body, message) => {
    const r = room();
    const res = await r.send("POST", "/api/board/meetings", { ...START, ...body });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(message);
    expect(r.kanban.tasks.size).toBe(0);
  });

  it("needs a hired advisor", async () => {
    const r = room({ hired: [] });
    expect((await r.send("POST", "/api/board/meetings", START)).status).toBe(409);
    expect((await r.send("POST", "/api/board/meetings", { ...START, members: [HORMOZI] })).status).toBe(409);
  });

  it("opens round 1 with one tagged task per hired advisor, and wakes no one on Telegram", async () => {
    const r = room();
    const { res, meeting } = await r.start();
    expect(res.status).toBe(201);
    expect(meeting).toMatchObject({ status: "in-round", currentRound: 1, members: [HORMOZI, BUFFETT], requestedBy: "hq", boardOnly: false, discussionRounds: 1 });
    const tasks = [...r.kanban.tasks.values()];
    expect(tasks.map((t) => [t.assignee, t.title, t.tenant])).toEqual([
      [HORMOZI, "Board meeting · Enter the Egyptian market · Opening", "zain-hq"],
      [BUFFETT, "Board meeting · Enter the Egyptian market · Opening", "zain-hq"],
    ]);
    const created = r.hermesFetch.called(`POST ${KANBAN}/tasks`)[0]!.body as Record<string, unknown>;
    expect(created.triage).toBe(false);
    const body = String(created.body);
    expect(body.startsWith(`<!-- zain-meeting:${meeting.id}:1 -->`)).toBe(true);
    expect(body).toContain(START.brief);
    expect(body).toContain("At most 250 words");
    expect(body).toContain("(No one has spoken yet.)");
    expect(body).not.toContain("VOTE:");
    expect(r.exec.calls).toEqual([]);
  });

  it("accepts a CEO convening by curl and lists meetings newest first", async () => {
    const r = room();
    await r.start();
    r.clock.t += 60;
    const { meeting } = await r.start({ topic: "Second", requestedBy: "ceo", members: [BUFFETT] }).then((x) => x);
    expect(meeting.requestedBy).toBe("ceo");
    const list = (await (await r.send("GET", "/api/board/meetings")).json()).meetings as BoardMeeting[];
    expect(list.map((m) => m.topic)).toEqual(["Second", START.topic]);
    expect((await r.send("GET", "/api/board/meetings/mtg_9999999999")).status).toBe(404);
    expect((await r.send("GET", "/api/board/meetings/../x")).status).toBe(404);
    expect((await r.send("GET", "/api/board/meetings/nope")).status).toBe(400);
  });
});

describe("running a meeting with the founder", () => {
  it("pauses for remarks, takes an extra round, votes, writes minutes and concludes", async () => {
    const r = room();
    const { meeting } = await r.start();
    expect((await r.remark(meeting.id, { text: "too early" })).status).toBe(409);

    await r.meetings.tick();
    expect((await r.get(meeting.id)).status).toBe("in-round");
    r.answerRound("Opening");
    await r.meetings.tick();
    let m = await r.get(meeting.id);
    expect(m.status).toBe("awaiting-founder");
    expect(m.turns.map((t) => [t.round, t.kind, t.speaker])).toEqual([
      [1, "opening", HORMOZI],
      [1, "opening", BUFFETT],
    ]);

    expect((await r.remark(meeting.id, { text: "", next: "continue" })).status).toBe(400);
    expect((await r.remark(meeting.id, { text: "ok", next: "sideways" })).status).toBe(400);
    expect((await r.remark(meeting.id, { text: "Consider a partner instead of an office.", next: "continue" })).status).toBe(200);
    m = await r.get(meeting.id);
    expect(m).toMatchObject({ status: "in-round", currentRound: 2 });
    const discussion = r.kanban.byTitle("· Discussion 1");
    expect(discussion).toHaveLength(2);
    expect(discussion[0]!.body).toContain("Alex Hormozi: zain-board-hormozi thinks Cairo is promising.");
    expect(discussion[0]!.body).toContain("- Consider a partner instead of an office.");
    expect(discussion[0]!.body).toContain("Address your colleagues by name");

    r.answerRound("Discussion 1");
    await r.meetings.tick();
    expect((await r.remark(meeting.id, { text: "One more round, please.", next: "extra-round" })).status).toBe(200);
    m = await r.get(meeting.id);
    expect(m).toMatchObject({ discussionRounds: 2, currentRound: 3, status: "in-round" });
    r.answerRound("Discussion 2");
    await r.meetings.tick();
    expect((await r.remark(meeting.id, { text: "Vote now.", next: "to-vote" })).status).toBe(200);
    m = await r.get(meeting.id);
    expect(m).toMatchObject({ status: "voting", currentRound: 4 });
    const voteTask = r.kanban.byTitle("· Vote")[0]!;
    expect(voteTask.body).toContain("VOTE: approve|approve-with-conditions|reject|abstain");

    r.kanban.completeAll("· Vote", (t) =>
      t.assignee === HORMOZI ? "VOTE: approve-with-conditions\nCONDITIONS: Partner first, office in year 2.\nVolume beats overhead." : "I like it, sort of.",
    );
    await r.meetings.tick();
    m = await r.get(meeting.id);
    expect(m.status).toBe("minutes");
    expect(m.votes).toEqual([
      { member: HORMOZI, vote: "approve-with-conditions", conditions: "Partner first, office in year 2.", rationale: "Volume beats overhead." },
      { member: BUFFETT, vote: "abstain", rationale: "I like it, sort of." },
    ]);
    expect(m.decision).toBe("approved-with-conditions");
    const minutes = r.kanban.byTitle("· Minutes")[0]!;
    expect(minutes).toMatchObject({ assignee: "default", tenant: "zain-hq" });
    expect(minutes.body).toContain(`<!-- zain-meeting:${meeting.id}:minutes -->`);
    expect(minutes.body).toContain("Decision: approved-with-conditions (Conditions 1 · Abstain 1)");
    expect(r.exec.calls.map((c) => c.args[4])).toEqual([minutes.id]);

    await r.meetings.tick();
    expect((await r.get(meeting.id)).status).toBe("minutes");
    r.kanban.complete(minutes.id, null, "Minutes: the board backs a Cairo partnership first.");
    await r.meetings.tick();
    m = await r.get(meeting.id);
    expect(m).toMatchObject({ status: "concluded", conclusion: "Minutes: the board backs a Cairo partnership first." });
    expect(m.turns.at(-1)).toMatchObject({ speaker: "default", text: m.conclusion });
    expect(r.exec.calls).toHaveLength(1);
  });

  it("refuses an extra round beyond the limit", async () => {
    const r = room();
    const { meeting } = await r.start({ discussionRounds: 3 });
    r.answerRound("Opening");
    await r.meetings.tick();
    expect((await r.remark(meeting.id, { text: "more", next: "extra-round" })).status).toBe(409);
  });
});

describe("a board-only meeting", () => {
  it("runs opening → discussion → vote without pausing for the founder", async () => {
    const r = room();
    const { meeting } = await r.start({ boardOnly: true });
    r.answerRound("Opening");
    await r.meetings.tick();
    expect((await r.get(meeting.id))).toMatchObject({ status: "in-round", currentRound: 2 });
    r.answerRound("Discussion 1");
    await r.meetings.tick();
    expect((await r.get(meeting.id))).toMatchObject({ status: "voting", currentRound: 3 });
    r.kanban.completeAll("· Vote", () => "VOTE: reject\nToo expensive.");
    await r.meetings.tick();
    expect((await r.get(meeting.id))).toMatchObject({ status: "minutes", decision: "rejected" });
    expect((await r.remark(meeting.id, { text: "x" })).status).toBe(409);
  });
});

describe("robustness", () => {
  it("adopts round tasks already on the board by their marker instead of duplicating them", async () => {
    const r = room();
    const { meeting } = await r.start();
    const stored = (await r.meetingStore.get(meeting.id))!;
    stored.rounds[0]!.tasks = {};
    await r.meetingStore.put(stored);
    await r.meetings.tick();
    expect(r.kanban.byTitle("· Opening")).toHaveLength(2);
    expect(r.hermesFetch.called(`POST ${KANBAN}/tasks`)).toHaveLength(2);
    expect((await r.meetingStore.get(meeting.id))!.rounds[0]!.tasks).toEqual({ [HORMOZI]: "t_1", [BUFFETT]: "t_2" });
  });

  it("records a silent advisor after 30 minutes and counts them as abstaining in the vote", async () => {
    const r = room();
    const { meeting } = await r.start({ boardOnly: true, discussionRounds: 1 });
    r.kanban.complete("t_1", "Opening from Hormozi");
    r.clock.t += 29 * 60;
    await r.meetings.tick();
    expect((await r.get(meeting.id)).currentRound).toBe(1);
    r.clock.t += 2 * 60;
    await r.meetings.tick();
    let m = await r.get(meeting.id);
    expect(m.turns.map((t) => t.text)).toEqual(["Opening from Hormozi", "Warren Buffett did not respond."]);
    expect(m.currentRound).toBe(2);
    r.answerRound("Discussion 1");
    await r.meetings.tick();
    r.kanban.completeAll("· Vote", (t) => (t.assignee === HORMOZI ? "VOTE: approve\nGo." : ""));
    r.kanban.tasks.set("t_6", { ...r.kanban.tasks.get("t_6")!, status: "blocked" });
    r.clock.t += 31 * 60;
    await r.meetings.tick();
    m = await r.get(meeting.id);
    expect(m.votes).toEqual([
      { member: HORMOZI, vote: "approve", rationale: "Go." },
      { member: BUFFETT, vote: "abstain", rationale: "Warren Buffett did not respond." },
    ]);
    expect(m.decision).toBe("approved");
  });

  it("cancels, archiving open tasks, and refuses to cancel twice", async () => {
    const r = room();
    const { meeting } = await r.start();
    const res = await r.send("POST", `/api/board/meetings/${meeting.id}/cancel`, {});
    expect((await res.json()).meeting.status).toBe("cancelled");
    expect([...r.kanban.tasks.values()].every((t) => t.status === "archived")).toBe(true);
    expect((await r.send("POST", `/api/board/meetings/${meeting.id}/cancel`, {})).status).toBe(409);
  });

  it("keeps meetings going when Notion fails, exposing the error and retrying", async () => {
    let fail = true;
    const sink = {
      syncMeeting: async (m: BoardMeeting) => {
        if (fail) throw new Error("Notion 502: bad gateway");
        return { pageId: `page-${m.id}`, url: `https://notion.so/${m.id}` };
      },
    };
    const r = room({ sink: sink as never });
    const { meeting } = await r.start();
    expect(meeting).toMatchObject({ status: "in-round", notionSyncError: "Notion 502: bad gateway" });
    fail = false;
    await r.meetings.tick();
    const m = await r.get(meeting.id);
    expect(m.notionSyncError).toBeUndefined();
    expect(m.notionPageUrl).toBe(`https://notion.so/${meeting.id}`);
  });

  it("is behind the write guard but accepts the CEO's curl", async () => {
    const r = room();
    expect((await r.send("POST", "/api/board/meetings", START, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await r.send("POST", "/api/board/meetings", START, { Origin: "https://evil.test" })).status).toBe(403);
    expect((await r.send("POST", "/api/board/meetings", { ...START, requestedBy: "ceo" }, { "User-Agent": "curl/8" })).status).toBe(201);
  });
});
