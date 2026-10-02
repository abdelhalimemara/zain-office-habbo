import { CeoWake } from "../../server/src/telegram/ceoWake";
import type { KanbanBoard, KanbanTask, TaskStatus } from "../../shared/hermes";
import { ROSTER } from "../../shared/roster";
import { KANBAN, TELEGRAM_HOME, json, mockExec, setup, task, type Handler } from "./helpers";

const TASK = `${KANBAN}/tasks/t_cr`;
const DRAFT = "Hi Sara, we can deliver the landing page by Thursday 9 Oct for SAR 12,000.";

function reply(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return task({
    id: "t_cr",
    title: "Client reply: Sara (Nakheel) — landing page price",
    assignee: "zain-hq-accounts",
    tenant: "zain-hq",
    status: "review",
    result: null,
    latest_summary: DRAFT,
    ...overrides,
  });
}

function crSetup(current: KanbanTask, patch: Record<string, Handler> = {}) {
  return setup({
    [`GET ${TASK}`]: () => ({ task: current, comments: [], links: { parents: [], children: [] } }),
    [`POST ${TASK}/comments`]: () => ({ ok: true }),
    [`PATCH ${TASK}`]: (c) => ({ task: { ...current, ...(c.body as object) } }),
    ...patch,
  });
}

const writes = (s: ReturnType<typeof crSetup>) => s.hermesFetch.calls.filter((c) => c.method !== "GET").map((c) => [`${c.method} ${c.path}`, c.body]);

describe("approving a client reply", () => {
  it("approves the draft as written: the exact text becomes the result and the completion summary", async () => {
    const s = crSetup(reply());
    expect((await s.send("POST", "/api/approvals/t_cr/approve", { note: "via Telegram" })).status).toBe(200);
    expect(writes(s)).toEqual([
      [`POST ${TASK}/comments`, { body: "Approved by HQ: via Telegram", author: "zain-hq-ui" }],
      [`PATCH ${TASK}`, { status: "done", result: DRAFT, summary: `Approved reply — send exactly:\n${DRAFT}` }],
    ]);
  });

  it("sends HQ's edited final text instead of the draft", async () => {
    const s = crSetup(reply());
    const edited = "Hi Sara, Thursday 9 Oct works. The price is SAR 13,500 including revisions.";
    await s.send("POST", "/api/approvals/t_cr/approve", { finalText: `  ${edited}  ` });
    expect(writes(s)).toEqual([
      [`POST ${TASK}/comments`, { body: "Approved by HQ with edits", author: "zain-hq-ui" }],
      [`PATCH ${TASK}`, { status: "done", result: edited, summary: `Approved reply — send exactly:\n${edited}` }],
    ]);
  });

  it("falls back to the result when the draft is only there", async () => {
    const s = crSetup(reply({ latest_summary: null, result: "Draft in result" }));
    await s.send("POST", "/api/approvals/t_cr/approve", {});
    expect(writes(s)[1]![1]).toMatchObject({ result: "Draft in result" });
  });

  it.each([
    [reply({ latest_summary: null, result: null }), {}, 409, "no draft"],
    [reply({ status: "ready" }), {}, 409, "not awaiting approval"],
    [reply(), { finalText: "   " }, 400, "finalText"],
    [reply(), { finalText: "x".repeat(4001) }, 400, "finalText"],
    [task({ id: "t_cr", status: "review", assignee: "zain-growth-vp", tenant: "zain-growth" }), { finalText: "x" }, 409, "not a client reply"],
    [reply({ title: "Client reply: x", assignee: "zain-hq-finance" }), { finalText: "x" }, 409, "not a client reply"],
  ])("guards %#", async (current, body, status, message) => {
    const s = crSetup(current);
    const res = await s.send("POST", "/api/approvals/t_cr/approve", body);
    expect(res.status).toBe(status);
    expect((await res.json()).error).toContain(message);
    expect(writes(s)).toEqual([]);
  });

  it("sends back to Ahmad with HQ's notes and keeps him assigned", async () => {
    const s = crSetup(reply(), { [`PATCH ${TASK}`]: () => ({ task: reply({ status: "ready" }) }) });
    expect((await s.send("POST", "/api/approvals/t_cr/reject", { reason: "Quote 13,500, not 12,000" })).status).toBe(200);
    expect(writes(s)).toEqual([
      [`POST ${TASK}/comments`, { body: "Changes requested by HQ: Quote 13,500, not 12,000", author: "zain-hq-ui" }],
      [`PATCH ${TASK}`, { status: "todo" }],
    ]);
  });

  it("surfaces Hermes failures", async () => {
    const s = crSetup(reply(), { [`PATCH ${TASK}`]: () => json({ detail: "db locked" }, 500) });
    expect((await s.send("POST", "/api/approvals/t_cr/approve", {})).status).toBe(502);
  });
});

describe("CEO wake for client replies", () => {
  const board = (tasks: KanbanTask[]): KanbanBoard => {
    const names: TaskStatus[] = ["triage", "todo", "ready", "running", "blocked", "review", "done"];
    return { columns: names.map((name) => ({ name, tasks: tasks.filter((t) => t.status === name) })), tenants: [], assignees: [], latest_event_id: 1, now: 2 };
  };

  it("subscribes open client replies (review and future ones) but not finished ones or look-alikes", async () => {
    const exec = mockExec();
    const s = setup({ [`GET ${KANBAN}/home-channels`]: () => ({ home_channels: [TELEGRAM_HOME] }) }, { exec });
    const wake = new CeoWake({ hermes: s.hermes, execFile: exec.execFile, hermesBin: "/bin/hermes", log: () => undefined });
    const subscribed = await wake.backfill(
      board([
        reply({ id: "t_r1", status: "review" }),
        reply({ id: "t_r2", status: "ready" }),
        reply({ id: "t_r3", status: "done" }),
        reply({ id: "t_r4", assignee: "zain-hq-finance" }),
        reply({ id: "t_r5", title: "Prepare client deck" }),
      ]),
      ROSTER,
    );
    expect(subscribed).toBe(2);
    expect(exec.calls.map((c) => c.args[4]).sort()).toEqual(["t_r1", "t_r2"]);
  });
});
