import { memoryHireStore } from "../../server/src/org/hireStore";
import { KANBAN, TOKEN, json, setup, task } from "./helpers";

const TASK = `${KANBAN}/tasks/t_abc`;

function detail(overrides = {}) {
  return {
    task: task(overrides),
    comments: [{ id: 1, task_id: "t_abc", author: "zain-growth-vp", body: "done", created_at: 2 }],
    events: [],
    links: { parents: ["t_p"], children: ["t_c1", "t_c2"] },
  };
}

describe("board and task detail", () => {
  it("serves the zain-group board", async () => {
    const board = { columns: [{ name: "todo", tasks: [] }], tenants: [], assignees: [], latest_event_id: 3, now: 9 };
    const { send, hermesFetch } = setup({ [`GET ${KANBAN}/board`]: () => board });
    const res = await send("GET", "/api/board");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(board);
    expect(hermesFetch.called(`GET ${KANBAN}/board`)[0]!.query.get("board")).toBe("zain-group");
  });

  it("maps Hermes task detail to comments plus parent/child ids", async () => {
    const { send } = setup({ [`GET ${TASK}`]: () => detail() });
    const body = await (await send("GET", "/api/tasks/t_abc")).json();
    expect(body).toEqual({ task: task(), comments: detail().comments, parents: ["t_p"], children: ["t_c1", "t_c2"] });
  });

  it("passes through Hermes 404 and rejects malformed ids", async () => {
    const { send } = setup({});
    expect((await send("GET", "/api/tasks/t_missing")).status).toBe(404);
    expect((await send("GET", "/api/tasks/..%2Fboards")).status).toBe(400);
  });

  it("adds UI comments as zain-hq-ui", async () => {
    const { send, hermesFetch } = setup({ [`POST ${TASK}/comments`]: () => ({ ok: true }), [`GET ${TASK}`]: () => detail() });
    expect((await send("POST", "/api/tasks/t_abc/comments", { body: "  Looks good  " })).status).toBe(201);
    expect(hermesFetch.called(`POST ${TASK}/comments`)[0]!.body).toEqual({ body: "Looks good", author: "zain-hq-ui" });
    expect((await send("POST", "/api/tasks/t_abc/comments", { body: "   " })).status).toBe(400);
  });

  it("returns JSON errors for bad bodies and unknown routes, never the token", async () => {
    const { send } = setup({});
    const bad = await send("POST", "/api/mandates", "{not json");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "request body must be valid JSON" });
    expect((await send("GET", "/api/nope")).status).toBe(404);
    const big = await send("POST", "/api/mandates", { division: "tech", title: "x", body: "y".repeat(200_000) });
    expect(big.status).toBe(413);
    expect(await big.text()).not.toContain(TOKEN);
  });
});

describe("POST /api/mandates", () => {
  const created = { task: task({ id: "t_new", status: "triage" }) };

  it.each([
    [{ division: "mars", title: "x" }, "division"],
    [{ division: "tech", title: "   " }, "title"],
    [{ division: "tech", title: "x".repeat(201) }, "title"],
    [{ division: "tech", title: "x", body: "y".repeat(20_001) }, "body"],
    [{ division: "tech", title: "x", priority: 1.5 }, "priority"],
    [{ division: "tech", title: "x", priority: 1000 }, "priority"],
    [{ division: "tech", title: "x", priority: "high" }, "priority"],
  ])("rejects %j", async (input, field) => {
    const { send, hermesFetch } = setup({});
    const res = await send("POST", "/api/mandates", input);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(field);
    expect(hermesFetch.called(`POST ${KANBAN}/tasks`)).toHaveLength(0);
  });

  it("creates a triage mandate for the division manager listing only that division's team", async () => {
    const hires = memoryHireStore([
      { profile: "zain-tech-data", title: "Data Engineer", division: "tech", rank: "specialist", reportsTo: "zain-tech-vp", skills: [] },
      { profile: "zain-growth-intern", title: "Growth Intern", division: "growth", rank: "specialist", reportsTo: "zain-growth-vp", skills: [] },
    ]);
    const { send, hermesFetch } = setup(
      { [`POST ${KANBAN}/tasks`]: () => created, [`POST ${KANBAN}/tasks/t_new/home-subscribe/telegram`]: () => ({ ok: true }) },
      { hires },
    );
    const res = await send("POST", "/api/mandates", { division: "tech", title: "  Ship the client portal ", body: "Brief here", priority: 2 });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ task: created.task, telegramSubscribed: true });

    const payload = hermesFetch.called(`POST ${KANBAN}/tasks`)[0]!;
    expect(payload.query.get("board")).toBe("zain-group");
    const sent = payload.body as Record<string, unknown>;
    expect(sent).toMatchObject({ title: "Ship the client portal", assignee: "zain-tech-vp", tenant: "zain-tech", triage: true, priority: 2 });
    const body = sent.body as string;
    expect(body.startsWith("Brief here")).toBe(true);
    for (const p of ["zain-tech-fullstack", "zain-tech-ai", "zain-tech-devops", "zain-tech-qa", "zain-tech-security", "zain-tech-data"]) {
      expect(body).toContain(`\`${p}\``);
    }
    expect(body).not.toMatch(/zain-(growth|studio|labs|hq)-/);
    expect(body).toContain("`review`");
  });

  it("routes HQ mandates to the COO and still succeeds without a telegram home channel", async () => {
    const { send, hermesFetch } = setup({
      [`POST ${KANBAN}/tasks`]: () => created,
      [`POST ${KANBAN}/tasks/t_new/home-subscribe/telegram`]: () => json({ detail: "No home channel" }, 404),
    });
    const res = await send("POST", "/api/mandates", { division: "hq", title: "Quarterly close" });
    expect(res.status).toBe(201);
    expect((await res.json()).telegramSubscribed).toBe(false);
    const sent = hermesFetch.called(`POST ${KANBAN}/tasks`)[0]!.body as Record<string, unknown>;
    expect(sent).toMatchObject({ assignee: "zain-hq-coo", tenant: "zain-hq", priority: 0 });
    expect(sent.body).not.toContain("`default`");
  });
});

describe("approvals", () => {
  function approvalSetup(status: string, after: Record<string, unknown> = {}) {
    return setup({
      [`GET ${TASK}`]: () => detail({ status }),
      [`POST ${TASK}/comments`]: () => ({ ok: true }),
      [`PATCH ${TASK}`]: (call) => ({ task: task({ ...(call.body as object), ...after }) }),
    });
  }

  it("approves a task in review: comment, then done keeping the roll-up result", async () => {
    const { send, hermesFetch } = approvalSetup("review");
    const res = await send("POST", "/api/approvals/t_abc/approve", { note: "Great work" });
    expect(res.status).toBe(200);
    expect((await res.json()).task.status).toBe("done");
    expect(hermesFetch.called(`POST ${TASK}/comments`)[0]!.body).toEqual({ body: "Approved by HQ: Great work", author: "zain-hq-ui" });
    expect(hermesFetch.called(`PATCH ${TASK}`)[0]!.body).toEqual({
      status: "done",
      summary: "Approved by HQ: Great work",
      result: "Rolled-up result",
    });
    const order = hermesFetch.calls.map((c) => `${c.method} ${c.path}`).filter((k) => k.startsWith("POST") || k.startsWith("PATCH"));
    expect(order).toEqual([`POST ${TASK}/comments`, `PATCH ${TASK}`]);
  });

  it("approves without a note", async () => {
    const { send, hermesFetch } = approvalSetup("review");
    expect((await send("POST", "/api/approvals/t_abc/approve", {})).status).toBe(200);
    expect(hermesFetch.called(`POST ${TASK}/comments`)[0]!.body).toMatchObject({ body: "Approved by HQ" });
  });

  it.each(["approve", "reject"])("%s returns 409 unless the task is in review", async (action) => {
    const { send, hermesFetch } = approvalSetup("running");
    const res = await send("POST", `/api/approvals/t_abc/${action}`, { reason: "x" });
    expect(res.status).toBe(409);
    expect(hermesFetch.called(`PATCH ${TASK}`)).toHaveLength(0);
    expect(hermesFetch.called(`POST ${TASK}/comments`)).toHaveLength(0);
  });

  it.each([{}, { reason: "  " }, { reason: "x".repeat(2001) }, { reason: 5 }])("reject requires a 1..2000 char reason: %j", async (body) => {
    const { send, hermesFetch } = approvalSetup("review");
    expect((await send("POST", "/api/approvals/t_abc/reject", body)).status).toBe(400);
    expect(hermesFetch.called(`GET ${TASK}`)).toHaveLength(0);
  });

  it("rejects back to todo with a comment and keeps the manager assigned", async () => {
    const { send, hermesFetch } = approvalSetup("review", { status: "ready", assignee: "zain-growth-vp" });
    const res = await send("POST", "/api/approvals/t_abc/reject", { reason: "Needs Arabic copy" });
    expect(res.status).toBe(200);
    expect(hermesFetch.called(`POST ${TASK}/comments`)[0]!.body).toEqual({
      body: "Changes requested by HQ: Needs Arabic copy",
      author: "zain-hq-ui",
    });
    expect(hermesFetch.called(`PATCH ${TASK}`).map((c) => c.body)).toEqual([{ status: "todo" }]);
  });

  it("re-pins the division manager when the reopened task landed elsewhere", async () => {
    const { send, hermesFetch } = approvalSetup("review", { assignee: "zain-growth-paid" });
    await send("POST", "/api/approvals/t_abc/reject", { reason: "Redo" });
    expect(hermesFetch.called(`PATCH ${TASK}`).map((c) => c.body)).toEqual([
      { status: "todo" },
      { assignee: "zain-growth-vp" },
    ]);
  });
});
