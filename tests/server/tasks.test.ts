import { memoryHireStore } from "../../server/src/org/hireStore";
import { KANBAN, TOKEN, json, setup, task, type Handler } from "./helpers";

const TASK = `${KANBAN}/tasks/t_abc`;

function detail(overrides = {}) {
  return {
    task: task(overrides),
    comments: [{ id: 1, task_id: "t_abc", author: "zain-growth-vp", body: "done", created_at: 2 }],
    events: [],
    links: { parents: ["t_p"], children: ["t_c1", "t_c2"] },
    link_tasks: [{ id: "t_p", title: "Draft copy", status: "done" }],
  };
}

function boardOf(tasks: ReturnType<typeof task>[]) {
  const names = ["triage", "todo", "ready", "running", "blocked", "review", "done"];
  return {
    columns: names.map((name) => ({ name, tasks: tasks.filter((t) => t.status === name) })),
    tenants: [],
    assignees: [],
    latest_event_id: 1,
    now: 2,
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

  it("maps Hermes task detail and lists a mandate's parents as its subtasks", async () => {
    const sub = task({ id: "t_p", title: "Draft copy", status: "running", assignee: "zain-growth-paid" });
    const { send } = setup({ [`GET ${TASK}`]: () => detail(), [`GET ${KANBAN}/board`]: () => boardOf([sub]) });
    const body = await (await send("GET", "/api/tasks/t_abc")).json();
    expect(body).toEqual({
      task: task(),
      comments: detail().comments,
      parents: ["t_p"],
      children: ["t_c1", "t_c2"],
      subtasks: [{ id: "t_p", title: "Draft copy", status: "running", assignee: "zain-growth-paid" }],
    });
  });

  it("falls back to Hermes link rows for subtasks missing from the board (archived)", async () => {
    const { send } = setup({ [`GET ${TASK}`]: () => detail(), [`GET ${KANBAN}/board`]: () => boardOf([]) });
    expect((await (await send("GET", "/api/tasks/t_abc")).json()).subtasks).toEqual([
      { id: "t_p", title: "Draft copy", status: "done", assignee: null },
    ]);
  });

  it("has no subtasks for non-mandates", async () => {
    const { send, hermesFetch } = setup({ [`GET ${TASK}`]: () => detail({ assignee: "zain-growth-paid" }) });
    expect((await (await send("GET", "/api/tasks/t_abc")).json()).subtasks).toEqual([]);
    expect(hermesFetch.called(`GET ${KANBAN}/board`)).toHaveLength(0);
  });

  it("adds dependencyProgress to mandates from their parents and tolerates detail failures", async () => {
    const m1 = task({ id: "t_m1", status: "blocked", link_counts: { parents: 3, children: 0 }, progress: null });
    const m2 = task({ id: "t_m2", status: "todo", assignee: "zain-tech-vp", tenant: "zain-tech", link_counts: { parents: 1, children: 0 } });
    const plain = task({ id: "t_m3", status: "todo", link_counts: { parents: 0, children: 0 } });
    const spec = task({ id: "t_s", status: "todo", assignee: "zain-growth-paid", link_counts: { parents: 2, children: 1 } });
    const subs = [
      task({ id: "t_a", status: "done", assignee: "zain-growth-paid", link_counts: { parents: 0, children: 1 }, progress: { done: 0, total: 1 } }),
      task({ id: "t_b", status: "running", assignee: "zain-growth-seo" }),
    ];
    const { send, hermesFetch } = setup({
      [`GET ${KANBAN}/board`]: () => boardOf([m1, m2, plain, spec, ...subs]),
      [`GET ${KANBAN}/tasks/t_m1`]: () => ({
        task: m1,
        comments: [],
        links: { parents: ["t_a", "t_b", "t_old"], children: [] },
        link_tasks: [{ id: "t_old", title: "Old", status: "archived" }],
      }),
      [`GET ${KANBAN}/tasks/t_m2`]: () => json({ detail: "boom" }, 500),
    });
    const res = await send("GET", "/api/board");
    expect(res.status).toBe(200);
    const tasks = (await res.json()).columns.flatMap((c: { tasks: unknown[] }) => c.tasks);
    const by = (id: string) => tasks.find((t: { id: string }) => t.id === id);
    expect(by("t_m1").dependencyProgress).toEqual({ done: 2, total: 3 });
    expect(by("t_m2")).not.toHaveProperty("dependencyProgress");
    expect(by("t_m3")).not.toHaveProperty("dependencyProgress");
    expect(by("t_s")).not.toHaveProperty("dependencyProgress");
    expect(hermesFetch.calls.map((c) => c.path).filter((p) => p.startsWith(`${KANBAN}/tasks/`)).sort()).toEqual([
      `${KANBAN}/tasks/t_m1`,
      `${KANBAN}/tasks/t_m2`,
    ]);
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

  it("sends the mandate straight to the division VP with the fan-out protocol for only that team", async () => {
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
    expect(sent).toMatchObject({ title: "Ship the client portal", assignee: "zain-tech-vp", tenant: "zain-tech", triage: false, priority: 2 });
    const body = sent.body as string;
    expect(body.startsWith("Brief here")).toBe(true);
    for (const p of ["zain-tech-fullstack", "zain-tech-ai", "zain-tech-devops", "zain-tech-qa", "zain-tech-security", "zain-tech-data"]) {
      expect(body).toContain(`\`${p}\``);
    }
    expect(body).not.toMatch(/zain-(growth|studio|labs|hq)-/);
    expect(body).toContain('tenant="zain-tech"');
    expect(body).toContain("kanban_create");
    expect(body).toContain("kanban_link(parent_id=<subtask id>, child_id=<this mandate's id>)");
    expect(body).toContain('kanban_block(kind="dependency"');
    expect(body).toContain("kanban_request_review");
    expect(body).toMatch(/Never complete the mandate yourself/);
    expect(body).toMatch(/never assign work outside your team/);
    const steps = ["kanban_create", "kanban_link", "kanban_block", "kanban_request_review"].map((t) => body.indexOf(t));
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
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

  it("keeps the VP's review summary as the result when no result was written", async () => {
    const { send, hermesFetch } = setup({
      [`GET ${TASK}`]: () => detail({ status: "review", result: null, latest_summary: "Full roll-up" }),
      [`POST ${TASK}/comments`]: () => ({ ok: true }),
      [`PATCH ${TASK}`]: (call) => ({ task: task(call.body as object) }),
    });
    await send("POST", "/api/approvals/t_abc/approve", {});
    expect(hermesFetch.called(`PATCH ${TASK}`)[0]!.body).toEqual({ status: "done", summary: "Approved by HQ", result: "Full roll-up" });
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

  it("treats a review routed to a reviewer as a mandate once Hermes restores the VP", async () => {
    const { send, hermesFetch } = setup({
      [`GET ${TASK}`]: () => detail({ status: "review", assignee: "zain-tech-security", tenant: "zain-tech" }),
      [`POST ${TASK}/comments`]: () => ({ ok: true }),
      [`PATCH ${TASK}`]: (call, n) => ({ task: task({ tenant: "zain-tech", assignee: n === 1 ? "zain-tech-vp" : "x", ...(call.body as object) }) }),
    });
    await send("POST", "/api/approvals/t_abc/reject", { reason: "Redo" });
    expect(hermesFetch.called(`PATCH ${TASK}`).map((c) => c.body)).toEqual([{ status: "todo" }]);
  });

  it("leaves a non-mandate with the implementer Hermes restored", async () => {
    const { send, hermesFetch } = setup({
      [`GET ${TASK}`]: () => detail({ status: "review", assignee: "zain-growth-seo" }),
      [`POST ${TASK}/comments`]: () => ({ ok: true }),
      [`PATCH ${TASK}`]: () => ({ task: task({ status: "ready", assignee: "zain-growth-paid" }) }),
    });
    const res = await send("POST", "/api/approvals/t_abc/reject", { reason: "Redo" });
    expect(res.status).toBe(200);
    expect((await res.json()).task.assignee).toBe("zain-growth-paid");
    expect(hermesFetch.called(`PATCH ${TASK}`).map((c) => c.body)).toEqual([{ status: "todo" }]);
  });

  it("still allows approving a non-mandate through the API", async () => {
    const { send } = setup({
      [`GET ${TASK}`]: () => detail({ status: "review", assignee: "zain-growth-seo" }),
      [`POST ${TASK}/comments`]: () => ({ ok: true }),
      [`PATCH ${TASK}`]: (call) => ({ task: task(call.body as object) }),
    });
    expect((await send("POST", "/api/approvals/t_abc/approve", {})).status).toBe(200);
  });

  it("returns the reopened mandate when the re-pin loses a race to a worker claim (409)", async () => {
    const { send, hermesFetch } = setup({
      [`GET ${TASK}`]: () => detail({ status: "review" }),
      [`POST ${TASK}/comments`]: () => ({ ok: true }),
      [`PATCH ${TASK}`]: (_call, n) =>
        n === 1
          ? { task: task({ status: "ready", assignee: "zain-growth-paid" }) }
          : json({ detail: "cannot reassign t_abc: currently running (claimed)." }, 409),
    });
    const res = await send("POST", "/api/approvals/t_abc/reject", { reason: "Redo" });
    expect(res.status).toBe(200);
    expect((await res.json()).task).toMatchObject({ status: "ready", assignee: "zain-growth-paid" });
    expect(hermesFetch.called(`PATCH ${TASK}`)).toHaveLength(2);
  });

  it("still surfaces other re-pin failures", async () => {
    const { send } = setup({
      [`GET ${TASK}`]: () => detail({ status: "review" }),
      [`POST ${TASK}/comments`]: () => ({ ok: true }),
      [`PATCH ${TASK}`]: (_call, n) =>
        n === 1 ? { task: task({ status: "ready", assignee: "zain-growth-paid" }) } : json({ detail: "db locked" }, 500),
    });
    expect((await send("POST", "/api/approvals/t_abc/reject", { reason: "Redo" })).status).toBe(502);
  });
});

describe("POST /api/tasks/:id/reopen", () => {
  function reopenSetup(status: string, patch: Record<string, unknown> = {}, routes: Record<string, Handler> = {}) {
    return setup({
      [`GET ${TASK}`]: () => detail({ status, ...patch }),
      [`POST ${TASK}/comments`]: () => ({ ok: true }),
      [`PATCH ${TASK}`]: (call) => ({ task: task({ ...patch, ...(call.body as object) }) }),
      ...routes,
    });
  }

  it.each(["done", "review"])("reopens a %s mandate to ready with HQ's instructions as a comment", async (status) => {
    const { send, hermesFetch } = reopenSetup(status);
    const res = await send("POST", "/api/tasks/t_abc/reopen", { instructions: "  Key is set; proceed with setup  " });
    expect(res.status).toBe(200);
    expect((await res.json()).task).toMatchObject({ status: "ready", assignee: "zain-growth-vp" });
    expect(hermesFetch.called(`POST ${TASK}/comments`)[0]!.body).toEqual({
      body: "HQ reopened this mandate: Key is set; proceed with setup",
      author: "zain-hq-ui",
    });
    const writes = hermesFetch.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`);
    expect(writes).toEqual([`POST ${TASK}/comments`, `PATCH ${TASK}`]);
    expect(hermesFetch.called(`PATCH ${TASK}`)[0]!.body).toEqual({ status: "ready" });
  });

  it("falls back to todo when Hermes refuses ready because a subtask reopened", async () => {
    const { send, hermesFetch } = reopenSetup("done", {}, {
      [`PATCH ${TASK}`]: (call) =>
        (call.body as { status: string }).status === "ready"
          ? json({ detail: "Cannot move to 'ready': blocked by parent(s) not done" }, 409)
          : { task: task({ status: "todo" }) },
    });
    const res = await send("POST", "/api/tasks/t_abc/reopen", { instructions: "Redo" });
    expect(res.status).toBe(200);
    expect(hermesFetch.called(`PATCH ${TASK}`).map((c) => c.body)).toEqual([{ status: "ready" }, { status: "todo" }]);
  });

  it("re-pins the division manager when the mandate sits with someone else", async () => {
    const { send, hermesFetch } = setup({
      [`GET ${TASK}`]: () => detail({ status: "done" }),
      [`POST ${TASK}/comments`]: () => ({ ok: true }),
      [`PATCH ${TASK}`]: (call, n) => ({ task: task({ assignee: n === 1 ? "zain-growth-paid" : "zain-growth-vp", ...(call.body as object) }) }),
    });
    await send("POST", "/api/tasks/t_abc/reopen", { instructions: "Redo" });
    expect(hermesFetch.called(`PATCH ${TASK}`).map((c) => c.body)).toEqual([{ status: "ready" }, { assignee: "zain-growth-vp" }]);
  });

  it.each(["running", "todo", "blocked", "ready", "triage"])("refuses a %s mandate with 409 and writes nothing", async (status) => {
    const { send, hermesFetch } = reopenSetup(status);
    const res = await send("POST", "/api/tasks/t_abc/reopen", { instructions: "Redo" });
    expect(res.status).toBe(409);
    expect(hermesFetch.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("refuses non-mandates with 409", async () => {
    const { send, hermesFetch } = reopenSetup("done", { assignee: "zain-growth-seo" });
    expect((await send("POST", "/api/tasks/t_abc/reopen", { instructions: "Redo" })).status).toBe(409);
    expect(hermesFetch.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it.each([{}, { instructions: "   " }, { instructions: "x".repeat(4001) }, { instructions: 3 }])("requires 1..4000 chars of instructions: %j", async (body) => {
    const { send, hermesFetch } = reopenSetup("done");
    expect((await send("POST", "/api/tasks/t_abc/reopen", body)).status).toBe(400);
    expect(hermesFetch.called(`GET ${TASK}`)).toHaveLength(0);
  });

  it("is behind the same write guard", async () => {
    const { send } = reopenSetup("done");
    expect((await send("POST", "/api/tasks/t_abc/reopen", { instructions: "x" }, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await send("POST", "/api/tasks/t_abc/reopen", { instructions: "x" }, { Origin: "https://evil.example" })).status).toBe(403);
  });
});
