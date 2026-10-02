import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BoardMeeting } from "../../shared/meetings";
import type { LiveSessionResponse } from "../../shared/voice";
import { boardLedger } from "../../server/src/board/memory/ledger";
import { parseDraft } from "../../server/src/leadership/actions";
import { DRAFT_FAILED, draftMarker } from "../../server/src/leadership/drafting";
import { condenseExecSoul } from "../../server/src/leadership/prompt";
import { weekLabel } from "../../server/src/leadership/weekly";
import { meetingBlocks, meetingProperties } from "../../server/src/notion/sync";
import { STATUS_OPTIONS, TYPE_OPTIONS } from "../../server/src/notion/boardRoom";
import { CONV, EXECS, NOW, leadershipRoom, type Conversation } from "./leadershipRoom";
import { task } from "./helpers";

let root: string;
let home: string;
let prioritiesPath: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zain-vp-"));
  home = join(root, "hermes-home");
  prioritiesPath = join(root, "ZainGroup", "weekly-priorities.md");
  await mkdir(join(home, "profiles", "zain-studio-vp"), { recursive: true });
  await writeFile(
    join(home, "SOUL.md"),
    "You are Hermes Agent. Be direct and plain.\n\n<!-- zain-hq:approvals:start -->\n## Zain Group approvals (Telegram)\nAPPROVALSMARKER curl -sS -X POST http://127.0.0.1:8787/api/approvals/<id>/approve\n<!-- zain-hq:approvals:end -->\n",
  );
  await writeFile(
    join(home, "profiles", "zain-studio-vp", "SOUL.md"),
    [
      "# VP Studio — Zain Studio",
      "",
      "You are the VP Studio of Zain Studio (Branding & creative). STUDIOPERSONA",
      "You report to the CEO (`default`). Your Hermes profile is `zain-studio-vp`.",
      "",
      "## How work flows at Zain Group",
      "- All work lives on the `zain-group` kanban board. FLOWMARKER",
      "",
      "## Handling a mandate (you are the division manager)",
      "1. Plan. call `kanban_create` PROCEDUREMARKER",
      "",
      "## Expertise",
      "",
      "- marketing:chief-content-officer",
      "- product:chief-product-officer",
    ].join("\n"),
  );
});
afterEach(() => rm(root, { recursive: true, force: true }));

const room = (opts: Partial<Parameters<typeof leadershipRoom>[0]> = {}) => leadershipRoom({ root, home, prioritiesPath, ...opts });

function conversation(agentId: string, transcript: Conversation["transcript"]): Conversation {
  return { agent_id: agentId, status: "done", metadata: { start_time_unix_secs: NOW }, transcript };
}

const MEETING_TALK: Conversation["transcript"] = [
  { role: "user", message: "Studio, ship the Acme brand book by Thursday.", time_in_call_secs: 2 },
  { role: "agent", message: "<Studio>Confirmed: the Acme brand book, owned by Studio, by Thursday.</Studio><CEO>Noted.</CEO>", time_in_call_secs: 5 },
  { role: "user", message: "Tech, fix the client portal login.", time_in_call_secs: 9 },
  { role: "agent", message: "<Tech>Confirmed, portal login fix this week.</Tech>", time_in_call_secs: 12 },
];

const DRAFT = [
  "Here is the list.",
  "```json",
  JSON.stringify({
    priorities: "Ship Acme.\nFix the portal.",
    actions: [
      { division: "studio", title: "Ship the Acme brand book", detail: "Final PDF to the client.", priority: "P1", due: "2026-10-08" },
      { division: "Tech", title: "Fix the client portal login", detail: "Users locked out.", priority: "p2" },
      { division: "marketing", title: "Invented", detail: "", priority: "P1" },
      { division: "hq", title: "Bad due date kept without it", detail: "", priority: "P3", due: "next week" },
    ],
  }),
  "```",
  "Thanks.",
].join("\n");

/** A meeting ended live and drafted into review with the given answer from the CEO agent. */
async function reviewed(r: ReturnType<typeof room>, answer = DRAFT) {
  const { meeting } = await r.start();
  await r.session(meeting.id);
  r.labs.conversations.set(CONV, conversation("agent_room0000000001", MEETING_TALK));
  const ended = (await (await r.end(meeting.id, { conversationId: CONV })).json()).meeting as BoardMeeting;
  const draft = r.kanban.byTitle("Leadership meeting")[0]!;
  r.kanban.complete(draft.id, answer);
  await r.meetings.tick();
  return { ended, draft, meeting: await r.meeting(meeting.id) };
}

describe("starting a leadership meeting", () => {
  it("defaults to this week's priorities with every hired seat, live, with no kanban rounds", async () => {
    const r = room({ hired: ["zain-hq-coo", "zain-studio-vp", "zain-tech-vp"] });
    const { res, meeting } = await r.start();
    expect(res.status).toBe(201);
    expect(meeting).toMatchObject({
      kind: "leadership",
      mode: "voice",
      status: "live",
      requestedBy: "hq",
      topic: "Weekly priorities · week of 28 Sep 2026",
      brief: "",
      members: ["default", "zain-hq-coo", "zain-studio-vp", "zain-tech-vp"],
      turns: [],
      votes: [],
    });
    expect(r.kanban.tasks.size).toBe(0);
    const list = (await (await r.send("GET", "/api/board/meetings")).json()).meetings as BoardMeeting[];
    expect(list.map((m) => m.kind)).toEqual(["leadership"]);
  });

  it("takes a topic, brief and members in seat order, and validates them", async () => {
    const r = room();
    const { meeting } = await r.start({ topic: "Q4 push", brief: "1. Clients\n2. Hiring", members: ["zain-tech-vp", "default", "zain-tech-vp"] });
    expect(meeting).toMatchObject({ topic: "Q4 push", brief: "1. Clients\n2. Hiring", members: ["default", "zain-tech-vp"] });
    expect((await r.start({ members: ["zain-board-hormozi"] })).res.status).toBe(400);
    expect((await r.start({ members: [] })).res.status).toBe(400);
    expect((await r.start({ topic: "x".repeat(200) })).res.status).toBe(400);
    const partial = room({ hired: ["zain-hq-coo"] });
    expect((await partial.start({ members: ["zain-labs-vp"] })).res.status).toBe(409);
  });

  it("labels the week by its Monday in Riyadh", () => {
    expect(weekLabel(Date.UTC(2026, 9, 4, 20, 59) / 1000)).toBe("week of 28 Sep 2026");
    expect(weekLabel(Date.UTC(2026, 9, 4, 21, 0) / 1000)).toBe("week of 5 Oct 2026");
  });
});

describe("the leadership live session", () => {
  it("uses its own Zain Leadership Room agent, with a label and a distinct voice per seat", async () => {
    const r = room({ hired: [...EXECS, "zain-board-hormozi"] });
    const board = await r.send("POST", "/api/board/meetings", { topic: "Cairo", brief: "Open?", mode: "voice" });
    await r.session((await board.json()).meeting.id);
    const { meeting } = await r.start();
    const res = await r.session(meeting.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as LiveSessionResponse;
    expect(body.signedUrl).toContain("agent_room0000000002");
    expect(body.speakers.map((s) => s.tag)).toEqual(["CEO", "COO", "Studio", "Growth", "Labs", "Tech"]);
    expect(body.overrides.agent.firstMessage).toBe("");

    const [boardAgent, vpAgent] = r.labs.called("POST", "/v1/convai/agents/create").map((c) => c.json!);
    expect(boardAgent!.name).toBe("Zain Board Room");
    expect(boardAgent!.conversation_config.tts.supported_voices.map((v: { label: string }) => v.label)).not.toContain("COO");
    expect(vpAgent!.name).toBe("Zain Leadership Room");
    const voices = vpAgent!.conversation_config.tts.supported_voices as { label: string; voice_id: string }[];
    expect(voices.map((v) => v.label)).toEqual(["CEO", "COO", "Studio", "Growth", "Labs", "Tech"]);
    expect(new Set(voices.map((v) => v.voice_id)).size).toBe(6);
    expect(vpAgent!.conversation_config.agent.first_message).toBe("");
    const saved = JSON.parse(await readFile(r.agentsFile, "utf8"));
    expect(saved.boardRoom.agentId).toBe("agent_room0000000001");
    expect(saved.leadershipRoom.agentId).toBe("agent_room0000000002");

    await r.session(meeting.id);
    expect(r.labs.called("POST", "/v1/convai/agents/create")).toHaveLength(2);
  });

  it("briefs the room with personas, every division's kanban state, last week's priorities and the dashboard", async () => {
    const r = room({ dashboard: `Updated: ${new Date(NOW * 1000).toISOString()} · by coo\n\n| Metric | Value |\n|---|---|\n| Active clients | 7 |\n` });
    await mkdir(join(root, "ZainGroup"), { recursive: true });
    await writeFile(prioritiesPath, "# Weekly priorities · week of 21 Sep 2026\n\n## Priorities\n\nLASTWEEKMARKER close Acme.\n");
    await mkdir(join(root, ".zain", "board"), { recursive: true });
    await writeFile(join(root, ".zain", "board", "zain-board-hormozi.md"), "BOARDBRIEFMARKER");
    const seed = (t: Parameters<typeof task>[0]) => r.kanban.tasks.set(t!.id!, task(t));
    seed({ id: "t_70", title: "Acme brand book", assignee: "zain-studio-vp", tenant: "zain-studio", status: "blocked", latest_summary: "Waiting on client logo files" });
    seed({ id: "t_71", title: "Q3 report", assignee: "zain-studio-vp", tenant: "zain-studio", status: "review" });
    seed({ id: "t_72", title: "Launch site", assignee: "zain-studio-vp", tenant: "zain-studio", status: "done", completed_at: NOW - 86_400 });
    seed({ id: "t_73", title: "Old work", assignee: "zain-studio-vp", tenant: "zain-studio", status: "done", completed_at: NOW - 30 * 86_400 });
    seed({ id: "t_74", title: "Logo drafts", assignee: "zain-studio-art", tenant: "zain-studio", status: "running" });
    const { meeting } = await r.start();
    const { prompt } = ((await (await r.session(meeting.id)).json()) as LiveSessionResponse).overrides.agent.prompt;
    expect(prompt).toContain("Abdelhalim, the founder, runs this meeting");
    expect(prompt).toContain("<CEO>: CEO. The CEO agent: the founder's chief of staff");
    expect(prompt).toContain("Be direct and plain.");
    expect(prompt).toContain("<Studio>: VP Studio. Heads Zain Studio");
    expect(prompt).toContain("STUDIOPERSONA");
    expect(prompt).toContain("Expertise: chief content officer, chief product officer.");
    expect(prompt).not.toMatch(/APPROVALSMARKER|FLOWMARKER|PROCEDUREMARKER|BOARDBRIEFMARKER|kanban_create|curl/);
    expect(prompt).toContain('"Acme brand book" (blocked: Waiting on client logo files)');
    expect(prompt).toContain('"Q3 report" (awaiting HQ approval)');
    expect(prompt).toContain('Done in the last 7 days: "Launch site".');
    expect(prompt).not.toContain("Old work");
    expect(prompt).toContain("Team tasks: 1 in progress");
    expect(prompt).toContain("LASTWEEKMARKER close Acme.");
    expect(prompt).toContain("| Active clients | 7 |");
    expect(prompt).toContain("its owner confirms it out loud");
    expect(prompt).toContain("Nobody decides for Abdelhalim");
    expect(prompt).toMatch(/Wrap every line in its speaker's tag/);
    expect(prompt).toContain("There is no vote");
    expect(prompt).not.toContain("You report to");
  });

  it("stays under 14k characters with everything at its largest, including a reconnect", async () => {
    const big = "word ".repeat(3000);
    for (const p of ["zain-hq-coo", "zain-growth-vp", "zain-labs-vp", "zain-tech-vp"]) {
      await mkdir(join(home, "profiles", p), { recursive: true });
      await writeFile(join(home, "profiles", p, "SOUL.md"), `# ${p}\n\n${big}`);
    }
    await mkdir(join(root, "ZainGroup"), { recursive: true });
    await writeFile(prioritiesPath, `# Weekly\n${"| a | b |\n".repeat(800)}`);
    const r = room({ dashboard: `Updated: x\n${"| Detail | row |\n".repeat(500)}` });
    for (let i = 0; i < 60; i++) {
      const d = ["studio", "growth", "labs", "tech", "hq"][i % 5]!;
      const head = d === "hq" ? "zain-hq-coo" : `zain-${d}-vp`;
      r.kanban.tasks.set(`t_x${i}`, task({ id: `t_x${i}`, title: `Mandate ${i} ${"long title ".repeat(20)}`, assignee: head, tenant: `zain-${d}`, status: "blocked", latest_summary: "reason ".repeat(50) }));
    }
    const { meeting } = await r.start({ brief: "Agenda ".repeat(1000) });
    await r.session(meeting.id);
    r.labs.conversations.set(CONV, conversation("agent_room0000000001", Array.from({ length: 200 }, (_, i) => ({ role: "user", message: `Long remark ${i} ${"blah ".repeat(30)}`, time_in_call_secs: i }))));
    await r.end(meeting.id, { conversationId: CONV, final: false });
    const { prompt } = ((await (await r.session(meeting.id)).json()) as LiveSessionResponse).overrides.agent.prompt;
    expect(prompt).toContain("## Earlier in this meeting");
    expect(prompt.length).toBeLessThan(14_000);
  });

  it("condenses an executive SOUL to its persona", () => {
    const text = condenseExecSoul("# T\n\nYou are the COO. Your Hermes profile is `zain-hq-coo`.\n\n## Handling a mandate\n1. kanban_create\n\n## Style\nCalm and exact.\n");
    expect(text).toBe("You are the COO. Calm and exact.");
  });
});

describe("ending a leadership meeting", () => {
  it("saves the transcript by seat, then drafts the actions with the CEO agent: no vote, no wake", async () => {
    const r = room();
    const { ended, draft, meeting } = await reviewed(r);
    expect(ended.status).toBe("drafting");
    expect(ended.turns.map((t) => [t.speaker, t.text])).toEqual([
      ["founder", "Studio, ship the Acme brand book by Thursday."],
      ["zain-studio-vp", "Confirmed: the Acme brand book, owned by Studio, by Thursday."],
      ["default", "Noted."],
      ["founder", "Tech, fix the client portal login."],
      ["zain-tech-vp", "Confirmed, portal login fix this week."],
    ]);
    expect(r.kanban.tasks.size).toBe(1);
    expect(draft).toMatchObject({ assignee: "default", tenant: "zain-hq" });
    expect(draft.body).toContain(draftMarker(meeting.id));
    expect(draft.body).toContain("VP Studio: Confirmed: the Acme brand book");
    expect(draft.body).toContain("Founder (Abdelhalim): Tech, fix the client portal login.");
    expect(draft.body).toContain("Include ONLY tasks the founder actually gave");
    expect(draft.body).toContain('"priorities"');
    expect(JSON.stringify(r.exec.calls)).not.toContain(draft.id);

    expect(meeting.status).toBe("review");
    expect(meeting.votes).toEqual([]);
    expect(meeting.outcome!.priorities).toBe("Ship Acme.\nFix the portal.");
    expect(meeting.outcome!.actions.map((a) => [a.division, a.title, a.priority, a.due, a.status])).toEqual([
      ["studio", "Ship the Acme brand book", "P1", "2026-10-08", "proposed"],
      ["tech", "Fix the client portal login", "P2", undefined, "proposed"],
    ]);
    expect(meeting.outcome!.actions.every((a) => /^act_[a-f0-9]{8}$/.test(a.id))).toBe(true);
  });

  it("goes to review with no actions when the draft cannot be read", async () => {
    const r = room();
    const { meeting } = await reviewed(r, "Sorry, I could not do it.");
    expect(meeting.status).toBe("review");
    expect(meeting.outcome).toEqual({ priorities: DRAFT_FAILED, actions: [] });
  });

  it("parses drafts tolerantly and logs every dropped item", () => {
    const logs: string[] = [];
    const draft = parseDraft(DRAFT, (l) => logs.push(l));
    expect(draft!.actions).toHaveLength(2);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain("unknown division");
    expect(logs[1]).toContain("due");
    expect(parseDraft('{"priorities": "x", "actions": []}')).toEqual({ priorities: "x", actions: [] });
    expect(parseDraft("```json\n{not json}\n```")).toBeNull();
    expect(parseDraft('Sure: {"actions": [{"division": "labs", "title": "T", "detail": "D", "priority": "P3"}]} done')!.actions).toHaveLength(1);
  });

  it("refuses a conversation from the board room", async () => {
    const r = room();
    const { meeting } = await r.start();
    await r.session(meeting.id);
    r.labs.conversations.set(CONV, conversation("agent_someoneelse001", MEETING_TALK));
    expect((await r.end(meeting.id, { conversationId: CONV })).status).toBe(400);
    expect((await r.meeting(meeting.id)).status).toBe("live");
  });
});

describe("reviewing the actions", () => {
  it("only edits in review, and validates the list", async () => {
    const r = room();
    const { meeting: live } = await r.start();
    expect((await r.putActions(live.id, { actions: [] })).status).toBe(409);
    const { meeting } = await reviewed(r);
    const ok = { division: "labs", title: "T", detail: "D", priority: "P1" };
    for (const body of [
      {},
      { actions: [{ ...ok, priority: "P4" }] },
      { actions: [{ ...ok, division: "nowhere" }] },
      { actions: [{ ...ok, title: "x".repeat(201) }] },
      { actions: [{ ...ok, detail: "x".repeat(4001) }] },
      { actions: [{ ...ok, due: "2026-02-30" }] },
      { actions: [{ ...ok, id: 42 }] },
      { actions: Array.from({ length: 26 }, () => ok) },
      { priorities: "x".repeat(2001), actions: [] },
    ]) {
      expect((await r.putActions(meeting.id, body)).status).toBe(400);
    }
  });

  it("replaces the list: known ids are kept, new items get server ids, omitted ones are dropped", async () => {
    const r = room();
    const { meeting } = await reviewed(r);
    const [studio, tech] = meeting.outcome!.actions;
    const res = await r.putActions(meeting.id, {
      priorities: "Only Acme.",
      actions: [
        { ...studio, title: "Ship the Acme brand book v2", status: "assigned", taskId: "t_99" },
        { division: "hq", title: "Close September books", detail: "", priority: "P2", due: "2026-10-06" },
        { id: "act_00000000", division: "growth", title: "Unknown id", detail: "", priority: "P3" },
        { id: "local-1f3a", division: "labs", title: "Client row", detail: "", priority: "P3" },
      ],
    });
    expect(res.status).toBe(200);
    const { outcome } = (await res.json()).meeting as BoardMeeting;
    expect(outcome!.priorities).toBe("Only Acme.");
    expect(outcome!.actions.map((a) => [a.id === studio!.id, a.title, a.status, a.taskId])).toEqual([
      [true, "Ship the Acme brand book v2", "proposed", undefined],
      [false, "Close September books", "proposed", undefined],
      [false, "Unknown id", "proposed", undefined],
      [false, "Client row", "proposed", undefined],
      [false, tech!.title, "dropped", undefined],
    ]);
    expect(outcome!.actions[3]!.id).toMatch(/^act_[a-f0-9]{8}$/);
    expect(outcome!.actions[4]!.id).toBe(tech!.id);
    expect(outcome!.actions[2]!.id).not.toBe("act_00000000");
  });
});

describe("assigning the actions", () => {
  it("creates one mandate per action, survives a partial failure without duplicates, and writes the weekly priorities", async () => {
    let techDown = true;
    const r = room({
      routes: (routes) => {
        const create = routes["POST /api/plugins/kanban/tasks"]!;
        return {
          ...routes,
          "POST /api/plugins/kanban/tasks": (c, n) => ((c.body as { tenant?: string }).tenant === "zain-tech" && techDown ? new Response("{}", { status: 500 }) : create(c, n)),
        };
      },
    });
    const { meeting } = await reviewed(r);
    const res = await r.assign(meeting.id);
    expect(res.status).toBe(200);
    const first = (await res.json()) as { meeting: BoardMeeting; results: { id: string; ok: boolean; taskId?: string; error?: string }[] };
    let m = first.meeting;
    expect(m.status).toBe("review");
    const [studio, tech] = m.outcome!.actions;
    expect(first.results).toEqual([
      { id: studio!.id, ok: true, taskId: studio!.taskId },
      { id: tech!.id, ok: false, error: expect.any(String) },
    ]);
    expect(studio).toMatchObject({ status: "assigned", taskId: expect.stringMatching(/^t_/) });
    expect(tech).toMatchObject({ status: "proposed" });
    const mandate = r.kanban.tasks.get(studio!.taskId!)!;
    expect(mandate).toMatchObject({ title: "Ship the Acme brand book", assignee: "zain-studio-vp", tenant: "zain-studio", priority: 30 });
    expect(mandate.body).toContain("Final PDF to the client.");
    expect(mandate.body).toContain('From the leadership meeting "Weekly priorities · week of 28 Sep 2026" on 2026-10-02.');
    expect(mandate.body).toContain("Due: 2026-10-08.");
    expect(await readFile(prioritiesPath, "utf8")).toContain("| Zain Studio | Ship the Acme brand book | P1 | 2026-10-08 |");

    techDown = false;
    m = (await (await r.assign(meeting.id)).json()).meeting as BoardMeeting;
    expect(m.status).toBe("assigned");
    expect(m.outcome!.assignedAt).toBe(NOW);
    expect(m.outcome!.actions.map((a) => a.status)).toEqual(["assigned", "assigned"]);
    expect(r.kanban.byTitle("Ship the Acme brand book")).toHaveLength(1);
    expect(r.kanban.tasks.get(m.outcome!.actions[1]!.taskId!)).toMatchObject({ assignee: "zain-tech-vp", priority: 20 });
    const weekly = await readFile(prioritiesPath, "utf8");
    expect(weekly).toContain("# Weekly priorities · week of 28 Sep 2026");
    expect(weekly).toContain("Ship Acme.\nFix the portal.");
    expect(weekly).toContain(`| Zain Tech | Fix the client portal login | P2 | — | ${m.outcome!.actions[1]!.taskId} |`);
    expect(weekly).toMatch(/Updated: 2026-10-02T09:00:00\.000Z/);
    expect((await r.assign(meeting.id)).status).toBe(409);
    expect((await r.putActions(meeting.id, { actions: [] })).status).toBe(409);
  });

  it("assigns only the chosen ids, adopts a mandate already on the board, and reports when everything fails", async () => {
    const r = room();
    const { meeting } = await reviewed(r);
    const [studio, tech] = meeting.outcome!.actions;
    expect((await r.assign(meeting.id, { ids: ["act_ffffffff"] })).status).toBe(400);
    expect((await r.assign(meeting.id, { ids: "all" })).status).toBe(400);
    const before = r.kanban.tasks.size;
    r.kanban.tasks.set("t_60", task({ id: "t_60", status: "ready", body: `x <!-- zain-leadership-action:${meeting.id}:${tech!.id} -->` }));
    const m = (await (await r.assign(meeting.id, { ids: [tech!.id] })).json()).meeting as BoardMeeting;
    expect(m.outcome!.actions.find((a) => a.id === tech!.id)).toMatchObject({ status: "assigned", taskId: "t_60" });
    expect(m.outcome!.actions.find((a) => a.id === studio!.id)!.status).toBe("proposed");
    expect(r.kanban.tasks.size).toBe(before + 1);

    const down = room({ routes: (routes) => ({ ...routes, "POST /api/plugins/kanban/tasks": (c, n) => (n === 1 ? routes["POST /api/plugins/kanban/tasks"]!(c, n) : new Response("{}", { status: 500 })) }) });
    const { meeting: m2 } = await reviewed(down);
    expect((await down.assign(m2.id)).status).toBe(502);
    expect((await down.meeting(m2.id)).outcome!.actions.every((a) => a.status === "proposed")).toBe(true);
  });
});

describe("cancelling a leadership meeting", () => {
  it("works while live, drafting or in review, archives the drafting task, and not once assigned", async () => {
    const r = room();
    const cancel = (id: string) => r.send("POST", `/api/board/meetings/${id}/cancel`, {});
    const { meeting: live } = await r.start();
    expect(((await (await cancel(live.id)).json()).meeting as BoardMeeting).status).toBe("cancelled");

    const { meeting } = await r.start();
    await r.session(meeting.id);
    r.labs.conversations.set(CONV, conversation("agent_room0000000001", MEETING_TALK));
    await r.end(meeting.id, { conversationId: CONV });
    const draft = r.kanban.byTitle("Leadership meeting")[0]!;
    expect((await cancel(meeting.id)).status).toBe(200);
    expect(r.kanban.tasks.get(draft.id)!.status).toBe("archived");

    const done = room();
    const { meeting: m } = await reviewed(done);
    expect((await done.send("POST", `/api/board/meetings/${m.id}/cancel`, {})).status).toBe(200);
    const again = room();
    const { meeting: m3 } = await reviewed(again);
    await again.assign(m3.id);
    expect((await again.send("POST", `/api/board/meetings/${m3.id}/cancel`, {})).status).toBe(409);
  });
});

describe("board flows stay as they are", () => {
  it("keeps leadership meetings out of the board ledger, the vote and the board's Notion type", async () => {
    const r = room({ hired: [...EXECS, "zain-board-hormozi"] });
    const { meeting } = await reviewed(r);
    expect(boardLedger([{ ...meeting, status: "concluded" }])).toEqual([]);
    const board = (await (await r.send("POST", "/api/board/meetings", { topic: "Cairo", brief: "Open?", mode: "voice" })).json()).meeting as BoardMeeting;
    expect(board.kind).toBeUndefined();
    await r.meetings.tick();
    expect(r.kanban.byTitle("Board meeting")).toHaveLength(0);
    expect((meetingProperties(board).Type as { select: { name: string } }).select.name).toBe("Meeting");
    expect(r.kanban.tasks.size).toBe(1);
  });

  it("mirrors leadership meetings to Notion as their own type, with priorities, actions and transcript", async () => {
    const r = room();
    const { meeting } = await reviewed(r);
    expect(TYPE_OPTIONS).toContain("Leadership");
    expect(STATUS_OPTIONS).toEqual(expect.arrayContaining(["Drafting tasks", "Review tasks", "Assigned"]));
    const props = meetingProperties(meeting) as Record<string, any>;
    expect(props.Type.select.name).toBe("Leadership");
    expect(props.Status.select.name).toBe("Review tasks");
    expect(props.Members.multi_select.map((x: { name: string }) => x.name)).toEqual(["CEO", "COO", "VP Studio", "VP Growth", "VP Labs", "VP Tech"]);
    const blocks = JSON.stringify(meetingBlocks(meeting));
    expect(blocks).toContain("Priorities");
    expect(blocks).toContain("[Proposed] Zain Studio · P1 · due 2026-10-08 — Ship the Acme brand book: Final PDF to the client.");
    expect(blocks).toContain("Transcript");
    expect(blocks).toContain("VP Studio");
    expect(blocks).not.toContain("Votes");
  });
});

