import { memoryHireStore } from "../../server/src/org/hireStore";
import { mandateBody, soulFor } from "../../server/src/org/persona";
import { Reconciler, reconcileOnce } from "../../server/src/org/reconcile";
import type { KanbanTask } from "../../shared/hermes";
import { ROSTER, findAgent } from "../../shared/roster";
import { createApp } from "../../server/src/app";
import { HermesClient } from "../../server/src/hermes/client";
import { KANBAN, hermesBase, json, mockFetch, setup, task, type Handler } from "./helpers";

const M = "t_mandate";

function boardOf(tasks: KanbanTask[]) {
  const names = ["triage", "todo", "ready", "running", "blocked", "review", "done"];
  return { columns: names.map((name) => ({ name, tasks: tasks.filter((t) => t.status === name) })), tenants: [], assignees: [], latest_event_id: 1, now: 2 };
}

const mandate = (overrides: Partial<KanbanTask> = {}) =>
  task({ id: M, status: "blocked", assignee: "zain-hq-coo", tenant: "zain-hq", link_counts: { parents: 0, children: 2 }, ...overrides });
const sub = (id: string, overrides: Partial<KanbanTask> = {}) =>
  task({ id, status: "todo", assignee: "zain-hq-ops", tenant: "zain-hq", link_counts: { parents: 1, children: 0 }, ...overrides });

/** A tiny stateful Hermes: links are real edges so repairs are visible to the next run. */
function hermesWith(tasks: KanbanTask[], edges: [string, string][], overrides: Record<string, Handler> = {}) {
  const links = new Set(edges.map(([p, c]) => `${p}>${c}`));
  const children = (id: string) => [...links].filter((l) => l.startsWith(`${id}>`)).map((l) => l.split(">")[1]!);
  const parents = (id: string) => [...links].filter((l) => l.endsWith(`>${id}`)).map((l) => l.split(">")[0]!);
  const withCounts = () =>
    tasks.map((t) => ({ ...t, link_counts: { parents: parents(t.id).length, children: children(t.id).length } }));
  const routes: Record<string, Handler> = {
    [`GET ${KANBAN}/board`]: () => boardOf(withCounts()),
    [`DELETE ${KANBAN}/links`]: (c) => ({ ok: links.delete(`${c.query.get("parent_id")}>${c.query.get("child_id")}`) }),
    [`POST ${KANBAN}/links`]: (c) => {
      const { parent_id, child_id } = c.body as { parent_id: string; child_id: string };
      links.add(`${parent_id}>${child_id}`);
      return { ok: true, gated: false };
    },
    [`PATCH ${KANBAN}/tasks/${M}`]: (c) => ({ task: { ...tasks[0], ...(c.body as object), status: "todo" } }),
    [`POST ${KANBAN}/tasks/${M}/comments`]: () => ({ ok: true }),
    ...Object.fromEntries(
      tasks.map((t) => [`GET ${KANBAN}/tasks/${t.id}`, () => ({ task: t, comments: [], links: { parents: parents(t.id), children: children(t.id) } })]),
    ),
    ...overrides,
  };
  const s = setup(routes);
  const writes = () =>
    s.hermesFetch.calls
      .filter((c) => c.method !== "GET")
      .map((c) => `${c.method} ${c.path.replace(KANBAN, "")}${c.method === "DELETE" ? `?${c.query.get("parent_id")}>${c.query.get("child_id")}` : ""}`);
  return { ...s, links, writes };
}

const logs: string[] = [];
const log = (line: string) => logs.push(line);
beforeEach(() => {
  logs.length = 0;
});

describe("reconcileOnce", () => {
  it("flips reversed subtask edges, unblocks the mandate and comments, in order", async () => {
    const h = hermesWith([mandate(), sub("t_a"), sub("t_b", { status: "ready" })], [[M, "t_a"], [M, "t_b"]]);
    expect(await reconcileOnce(h.hermes, ROSTER, log)).toBe(2);
    expect(h.writes()).toEqual([
      `DELETE /links?${M}>t_a`,
      "POST /links",
      `DELETE /links?${M}>t_b`,
      "POST /links",
      `PATCH /tasks/${M}`,
      `POST /tasks/${M}/comments`,
    ]);
    expect([...h.links].sort()).toEqual([`t_a>${M}`, `t_b>${M}`]);
    expect(h.hermesFetch.called(`PATCH ${KANBAN}/tasks/${M}`)[0]!.body).toEqual({ status: "ready" });
    const comment = h.hermesFetch.called(`POST ${KANBAN}/tasks/${M}/comments`)[0]!.body as { body: string; author: string };
    expect(comment.author).toBe("zain-hq-ui");
    expect(comment.body).toMatch(/^Zain HQ repaired the dependencies: t_a, t_b are now prerequisites/);
    expect(comment.body).toContain("resumes automatically when all are done");
    expect(h.hermesFetch.calls.filter((c) => c.path.startsWith(KANBAN) && !c.path.endsWith("/boards")).every((c) => c.query.get("board") === "zain-group")).toBe(true);
    expect(logs).toEqual([`reconcile: repaired t_a -> ${M}`, `reconcile: repaired t_b -> ${M}`]);
  });

  it("does not unblock a mandate that is not blocked", async () => {
    const h = hermesWith([mandate({ status: "todo" }), sub("t_a")], [[M, "t_a"]]);
    expect(await reconcileOnce(h.hermes, ROSTER, log)).toBe(1);
    expect(h.writes()).toEqual([`DELETE /links?${M}>t_a`, "POST /links", `POST /tasks/${M}/comments`]);
  });

  it("is idempotent: a second run on the repaired board does nothing", async () => {
    const h = hermesWith([mandate(), sub("t_a")], [[M, "t_a"]]);
    await reconcileOnce(h.hermes, ROSTER, log);
    const before = h.writes().length;
    expect(await reconcileOnce(h.hermes, ROSTER, log)).toBe(0);
    expect(h.writes()).toHaveLength(before);
  });

  it("skips a running mandate this tick", async () => {
    const h = hermesWith([mandate({ status: "running" }), sub("t_a")], [[M, "t_a"]]);
    expect(await reconcileOnce(h.hermes, ROSTER, log)).toBe(0);
    expect(h.writes()).toEqual([]);
    expect(h.hermesFetch.called(`GET ${KANBAN}/tasks/${M}`)).toHaveLength(0);
  });

  it("ignores finished or cross-tenant children and non-mandates", async () => {
    const spec = sub("t_spec", { assignee: "zain-hq-ops", link_counts: { parents: 0, children: 1 } });
    const h = hermesWith(
      [mandate(), sub("t_done", { status: "done" }), sub("t_other", { tenant: "zain-tech" }), spec, sub("t_x")],
      [[M, "t_done"], [M, "t_other"], [M, "t_archived"], ["t_spec", "t_x"]],
    );
    expect(await reconcileOnce(h.hermes, ROSTER, log)).toBe(0);
    expect(h.writes()).toEqual([]);
    expect(h.hermesFetch.called(`GET ${KANBAN}/tasks/t_spec`)).toHaveLength(0);
  });

  it("treats locally hired VPs as mandate owners via the merged roster", async () => {
    const vp = { profile: "zain-hq-vp2", title: "VP Ops", division: "hq" as const, rank: "vp" as const, reportsTo: "default", skills: [] };
    const h = hermesWith([mandate({ assignee: vp.profile }), sub("t_a")], [[M, "t_a"]]);
    expect(await reconcileOnce(h.hermes, ROSTER, log)).toBe(0);
    expect(await reconcileOnce(h.hermes, [...ROSTER, vp], log)).toBe(1);
  });

  it("continues past a failed unlink and still repairs the rest", async () => {
    let n = 0;
    const s = hermesWith([mandate(), sub("t_a"), sub("t_b")], [[M, "t_a"], [M, "t_b"]], {
      [`DELETE ${KANBAN}/links`]: (c) => {
        n++;
        if (c.query.get("child_id") === "t_a") return json({ detail: "db locked" }, 500);
        return { ok: true };
      },
    });
    expect(await reconcileOnce(s.hermes, ROSTER, log)).toBe(1);
    expect(n).toBe(2);
    expect(s.writes()).toEqual([
      `DELETE /links?${M}>t_a`,
      `DELETE /links?${M}>t_b`,
      "POST /links",
      `PATCH /tasks/${M}`,
      `POST /tasks/${M}/comments`,
    ]);
    expect(logs[0]).toBe(`reconcile: unlink ${M} -> t_a failed (HTTP 500)`);
    const comment = s.hermesFetch.called(`POST ${KANBAN}/tasks/${M}/comments`)[0]!.body as { body: string };
    expect(comment.body).toContain("t_b is now a prerequisite of this mandate");
    expect(comment.body).not.toContain("t_a");
  });

  it("adds no comment and does not unblock when nothing could be repaired", async () => {
    const h = hermesWith([mandate(), sub("t_a")], [[M, "t_a"]], {
      [`POST ${KANBAN}/links`]: () => json({ detail: "would create a cycle" }, 400),
    });
    expect(await reconcileOnce(h.hermes, ROSTER, log)).toBe(0);
    expect(h.writes()).toEqual([`DELETE /links?${M}>t_a`, "POST /links"]);
    expect(logs).toEqual([`reconcile: link t_a -> ${M} failed after unlink (HTTP 400)`]);
  });
});

describe("Reconciler", () => {
  it("runs extra steps (meetings, consultations) each run and logs their failures", async () => {
    const h = hermesWith([], []);
    const ran: string[] = [];
    const r = new Reconciler({
      hermes: h.hermes,
      hires: memoryHireStore(),
      log,
      steps: [
        async () => void ran.push("meetings"),
        async () => {
          throw new Error("boom");
        },
        async () => void ran.push("consultations"),
      ],
    });
    await r.run();
    expect(ran).toEqual(["meetings", "consultations"]);
    expect(logs).toContain("reconcile: step failed (Error)");
  });

  it("never overlaps runs and records the last result", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let boardReads = 0;
    const h = hermesWith([mandate(), sub("t_a")], [[M, "t_a"]], {
      [`GET ${KANBAN}/board`]: async () => {
        boardReads++;
        await gate;
        return boardOf([mandate({ link_counts: { parents: 0, children: 0 } })]);
      },
    });
    const r = new Reconciler({ hermes: h.hermes, hires: memoryHireStore(), log, now: () => 1_700_000_000_500 });
    expect(r.status()).toEqual({ lastRunAt: null, repaired: 0 });
    const first = r.run();
    const second = r.run();
    expect(second).toBe(first);
    release();
    await first;
    expect(boardReads).toBe(1);
    expect(r.status()).toEqual({ lastRunAt: 1_700_000_000, repaired: 0 });
    await r.run();
    expect(boardReads).toBe(2);
  });

  it("runs at start and on each interval tick, logging instead of throwing", async () => {
    const h = hermesWith([], [], { [`GET ${KANBAN}/board`]: () => json({ detail: "down" }, 500) });
    let tick: (() => void) | undefined;
    let cleared = false;
    const r = new Reconciler({
      hermes: h.hermes,
      hires: memoryHireStore(),
      log,
      intervalMs: 30_000,
      setInterval: (fn, ms) => {
        expect(ms).toBe(30_000);
        tick = fn;
        return 7;
      },
      clearInterval: (handle) => {
        cleared = handle === 7;
      },
    });
    const stop = r.start();
    await r.run();
    tick!();
    await r.run();
    expect(h.hermesFetch.called(`GET ${KANBAN}/board`).length).toBeGreaterThanOrEqual(2);
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(logs)).toEqual(new Set(["reconcile: run failed (HTTP 500)"]));
    expect(r.status().lastRunAt).toBeNull();
    stop();
    expect(cleared).toBe(true);
  });
});

describe("GET /api/health reconciler status", () => {
  it("reports the last run when the server runs a reconciler", async () => {
    const { headcount, hires, ceoWake, briefs, connections, meetings, consultations, voice } = setup({});
    const statusRoute = mockFetch({ ...hermesBase, "GET /api/status": () => ({ gateway_platforms: {} }) });
    const app = createApp({
      hermes: new HermesClient({ baseUrl: "http://hermes.test", fetchImpl: statusRoute.fetchImpl }),
      headcount,
      hires,
      ceoWake,
      briefs,
      connections,
      meetings,
      consultations,
      voice,
      reconcilerStatus: () => ({ lastRunAt: 1_700_000_000, repaired: 2 }),
    });
    const res = await app.request("/api/health", { headers: { Host: "127.0.0.1:8787" } });
    expect((await res.json()).reconciler).toEqual({ lastRunAt: 1_700_000_000, repaired: 2 });
  });

  it("is absent without a reconciler", async () => {
    const { send } = setup({ "GET /api/status": () => ({ gateway_platforms: {} }) });
    expect(await (await send("GET", "/api/health")).json()).not.toHaveProperty("reconciler");
  });
});

describe("fan-out protocol", () => {
  const coo = findAgent("zain-hq-coo")!;
  it.each([
    ["mandate body", () => mandateBody("Brief", coo, ROSTER)],
    ["VP soul", () => soulFor(coo, ROSTER)],
  ])("%s forbids parents on kanban_create and explains cycle recovery", (_name, text) => {
    const body = text();
    expect(body).toContain("Do NOT pass `parents`");
    expect(body).toContain("deadlocks the work");
    expect(body).toContain("kanban_link(parent_id=<subtask id>, child_id=<this mandate's id>)");
    expect(body).toMatch(/If a link is refused as a cycle, do not retry/);
    expect(body).toContain("Zain HQ repairs reversed links automatically");
  });
});
