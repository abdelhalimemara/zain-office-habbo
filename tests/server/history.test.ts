import { oneLine, toHistory } from "../../server/src/org/history";
import type { HermesEvent } from "../../server/src/hermes/client";
import type { KanbanComment } from "../../shared/hermes";
import { KANBAN, setup, task } from "./helpers";

const M = "t_2ce68fe1";
const T0 = 1_759_300_000;
let nextId = 1;
const ev = (kind: string, at: number, payload: Record<string, unknown> | null = null, run_id: number | null = null): HermesEvent => ({
  id: nextId++,
  task_id: M,
  kind,
  payload,
  created_at: T0 + at,
  run_id,
});
const comment = (id: number, author: string, at: number, body: string): KanbanComment => ({ id, task_id: M, author, body, created_at: T0 + at });

function mandateSequence() {
  nextId = 1;
  const events = [
    ev("created", 0, { assignee: "zain-hq-coo", status: "ready", parents: [], creator_task_id: null, tenant: "zain-hq" }),
    ev("claimed", 5, { lock: "l1", expires: T0 + 900, run_id: 1 }, 1),
    ev("tip_scratch_workspace", 5, { message: "scratch" }),
    ev("spawned", 6, { pid: 4242, started_at: T0 + 6 }, 1),
    ev("heartbeat", 60, {}, 1),
    ev("commented", 70, { author: "zain-hq-coo", len: 40 }),
    ev("blocked", 80, { reason: "HQ must provision a Notion key\nbefore setup", kind: "capability" }, 1),
    ev("blocked", 81, { reason: "HQ must provision a Notion key\nbefore setup", kind: "capability" }, 1),
    ev("linked", 120, { parent: "t_ops", child: M }),
    ev("linked", 121, { parent: "t_legal", child: M }),
    ev("linked", 122, { parent: M, child: "t_other" }),
    ev("unblocked", 130, { status: "todo", resume_status: "todo" }),
    ev("promoted", 200, {}),
    ev("claimed", 210, { lock: "l2", run_id: 4 }, 4),
    ev("spawned", 211, { pid: 4343 }, 4),
    ev("claimed", 212, { lock: "l2b", run_id: 4 }, 4),
    ev("review_requested", 300, { summary: "Notion route chosen: official API.\nDetails below…", implementer: "zain-hq-coo", reviewer: null }, 4),
    ev("commented", 310, { author: "zain-hq-ui", len: 20 }),
    ev("commented", 316, { author: "zain-hq-ui", len: 14 }),
    ev("completed", 320, { summary: "Approved by HQ", result_len: 900 }, 5),
    ev("mystery_kind", 330, { anything: true }),
  ];
  const comments = [
    comment(2, "zain-hq-ui", 310, "NOTION_AGENT_OS has been set as a key in hermes"),
    comment(1, "zain-hq-coo", 70, "Blocked: need a Notion key."),
    comment(3, "zain-hq-ui", 316, "Approved by HQ"),
  ];
  const detail = {
    task: task({ id: M, assignee: "zain-hq-coo", tenant: "zain-hq", status: "done" }),
    events,
    comments,
    link_tasks: [{ id: "t_ops", title: "Assess Notion integration route", status: "done" as const }],
  };
  return detail;
}

describe("toHistory", () => {
  it("tells the t_2ce68fe1 story oldest first", () => {
    const history = toHistory(mandateSequence(), M, new Map([["t_legal", "Notion security requirements"]]));
    expect(history.map((h) => [h.kind, h.actor, h.text, h.relatedTaskId ?? null])).toEqual([
      ["created", "zain-hq-coo", null, null],
      ["started", "zain-hq-coo", null, null],
      ["commented", "zain-hq-coo", "Blocked: need a Notion key.", null],
      ["blocked", null, "HQ must provision a Notion key before setup", null],
      ["subtask-linked", null, "Assess Notion integration route", "t_ops"],
      ["subtask-linked", null, "Notion security requirements", "t_legal"],
      ["unblocked", null, null, null],
      ["started", "zain-hq-coo", null, null],
      ["review-requested", "zain-hq-coo", "Notion route chosen: official API.", null],
      ["commented", "zain-hq-ui", "NOTION_AGENT_OS has been set as a key in hermes", null],
      ["commented", "zain-hq-ui", "Approved by HQ", null],
      ["completed", null, "Approved by HQ", null],
    ]);
    expect(history[0]).toMatchObject({ id: 1, at: T0 });
    expect(history.every((h, i) => i === 0 || h.at >= history[i - 1]!.at)).toBe(true);
  });

  it("falls back to the subtask id when its title is unknown", () => {
    const history = toHistory(mandateSequence(), M);
    expect(history.find((h) => h.relatedTaskId === "t_legal")?.text).toBe("t_legal");
  });

  it("maps dependency waits, send-backs, status changes and reviewer verdicts", () => {
    nextId = 1;
    const history = toHistory(
      {
        task: task({ id: M, assignee: "zain-hq-coo" }),
        comments: [],
        events: [
          ev("dependency_wait", 1, { reason: "parent_not_done", kind: "dependency" }),
          ev("review_reopened", 2, { status: "ready", implementer: "zain-hq-coo" }),
          ev("changes_requested", 3, { reason: "Add the rollout plan", reviewer: "zain-tech-security" }),
          ev("status", 4, { status: "ready", requested_status: "ready" }),
          ev("assigned", 5, { assignee: "zain-hq-coo", from: "zain-hq-ops" }),
          ev("heartbeat", 6, {}),
          ev("spawned", 7, { pid: 1 }, 99),
        ],
      },
      M,
    );
    expect(history.map((h) => [h.kind, h.actor, h.text])).toEqual([
      ["blocked", null, "Waiting on subtasks"],
      ["sent-back", "zain-hq-coo", null],
      ["sent-back", "zain-tech-security", "Add the rollout plan"],
      ["status", null, "→ ready"],
      ["status", null, "Assigned to zain-hq-coo"],
    ]);
  });

  it("keeps a comment without a matching row and copes with missing events", () => {
    nextId = 1;
    const detail = { task: task({ id: M }), comments: [], events: [ev("commented", 1, { author: "zain-hq-ui" })] };
    expect(toHistory(detail, M)).toEqual([{ id: 1, at: T0 + 1, kind: "commented", actor: "zain-hq-ui", text: null }]);
    expect(toHistory({ task: task({ id: M }), comments: [] }, M)).toEqual([]);
  });
});

describe("oneLine", () => {
  it("flattens whitespace and caps at 280 characters with an ellipsis", () => {
    expect(oneLine("a\n\n  b\tc")).toBe("a b c");
    const long = oneLine("x".repeat(400))!;
    expect(long).toHaveLength(280);
    expect(long.endsWith("…")).toBe(true);
    expect(oneLine("first\nsecond", true)).toBe("first");
    expect(oneLine("   ")).toBeNull();
    expect(oneLine(42)).toBeNull();
  });
});

describe("GET /api/tasks/:id history", () => {
  it("returns the mapped history and reads the board only to name unknown subtasks", async () => {
    const detail = mandateSequence();
    const { send, hermesFetch } = setup({
      [`GET ${KANBAN}/tasks/${M}`]: () => ({ ...detail, links: { parents: ["t_ops", "t_legal"], children: [] } }),
      [`GET ${KANBAN}/board`]: () => ({
        columns: [{ name: "done", tasks: [task({ id: "t_legal", title: "Notion security requirements", status: "done" })] }],
        tenants: [],
        assignees: [],
        latest_event_id: 1,
        now: 2,
      }),
    });
    const body = await (await send("GET", `/api/tasks/${M}`)).json();
    expect(body.history).toHaveLength(12);
    expect(body.history[5]).toMatchObject({ kind: "subtask-linked", text: "Notion security requirements", relatedTaskId: "t_legal" });
    expect(hermesFetch.called(`GET ${KANBAN}/board`)).toHaveLength(1);
  });

  it("does not read the board for a plain task without linked events", async () => {
    nextId = 1;
    const { send, hermesFetch } = setup({
      [`GET ${KANBAN}/tasks/t_x`]: () => ({
        task: task({ id: "t_x", assignee: "zain-growth-seo" }),
        comments: [],
        links: { parents: [], children: [] },
        events: [ev("created", 0, { assignee: "zain-growth-seo" })],
      }),
    });
    const body = await (await send("GET", "/api/tasks/t_x")).json();
    expect(body.history).toEqual([{ id: 1, at: T0, kind: "created", actor: "zain-growth-seo", text: null }]);
    expect(hermesFetch.called(`GET ${KANBAN}/board`)).toEqual([]);
  });
});
