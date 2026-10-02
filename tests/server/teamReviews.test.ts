import { beforeEach, describe, expect, it } from "vitest";
import { HermesClient } from "../../server/src/hermes/client";
import type { HermesEvent } from "../../server/src/hermes/client";
import { memoryHireStore } from "../../server/src/org/hireStore";
import { TeamReviews, parseVerdict } from "../../server/src/org/teamReviews";
import { CeoWake } from "../../server/src/telegram/ceoWake";
import { isMandate, teamReviewTarget } from "../../shared/flow";
import type { CreateTaskInput, KanbanComment, KanbanTask, UpdateTaskInput } from "../../shared/hermes";
import { ROSTER } from "../../shared/roster";
import { KANBAN, TELEGRAM_HOME, hermesBase, mockExec, mockFetch, task, type Handler } from "./helpers";

const VP = "zain-tech-vp";
const HEAD = "zain-tech-storelens-head";
const FRONTEND = "zain-tech-storelens-frontend";
const NOW = 1_000_000;

const requested = (taskId: string, implementer: string, reviewer: string | null, at = NOW - 60, summary = "done"): HermesEvent => ({
  id: 0, task_id: taskId, kind: "review_requested", payload: { summary, implementer, reviewer }, created_at: at, run_id: 1,
});

/** A stateful Hermes kanban: tasks, events and comments, routed for any task id. */
function fakeHermes(initial: KanbanTask[], initialEvents: HermesEvent[] = []) {
  const tasks = new Map(initial.map((t) => [t.id, t]));
  const events = [...initialEvents];
  const comments: KanbanComment[] = [];
  let next = 0;
  const statuses = ["triage", "todo", "ready", "running", "blocked", "review", "done"] as const;
  const fixed: Record<string, Handler> = {
    ...hermesBase,
    [`GET ${KANBAN}/home-channels`]: () => ({ home_channels: [TELEGRAM_HOME] }),
    [`GET ${KANBAN}/board`]: () => ({
      columns: statuses.map((name) => ({ name, tasks: [...tasks.values()].filter((t) => t.status === name) })),
      tenants: [], assignees: [], latest_event_id: 1, now: NOW,
    }),
    [`POST ${KANBAN}/tasks`]: (c) => {
      const body = c.body as CreateTaskInput;
      const created = task({ id: `t_new${++next}`, status: "ready", result: null, latest_summary: null, created_by: "dashboard", created_at: NOW, ...body });
      tasks.set(created.id, created);
      return { task: created };
    },
  };
  const perTask = (key: string): Handler | undefined => {
    const m = /^(GET|PATCH|POST) \/api\/plugins\/kanban\/tasks\/([^/]+)(\/comments)?$/.exec(key);
    if (!m) return undefined;
    const [, method, id, sub] = m as unknown as [string, string, string, string | undefined];
    if (!tasks.has(id!)) return undefined;
    if (method === "GET" && !sub)
      return () => ({ task: tasks.get(id), comments: comments.filter((c) => c.task_id === id), links: { parents: [], children: ["t_mandate"] }, events: events.filter((e) => e.task_id === id) });
    if (method === "PATCH" && !sub)
      return (c) => {
        const updated = { ...tasks.get(id)!, ...(c.body as UpdateTaskInput) } as KanbanTask;
        tasks.set(id, updated);
        return { task: updated };
      };
    if (method === "POST" && sub)
      return (c) => {
        const { body, author } = c.body as { body: string; author: string };
        comments.push({ id: comments.length + 1, task_id: id, author, body, created_at: NOW });
        return { ok: true };
      };
    return undefined;
  };
  const routes = new Proxy(fixed, { get: (target, key: string) => target[key] ?? perTask(key) });
  const fetch = mockFetch(routes);
  const hermes = new HermesClient({ baseUrl: "http://hermes.test", fetchImpl: fetch.fetchImpl });
  const helpers = () => [...tasks.values()].filter((t) => teamReviewTarget(t));
  const writes = () => fetch.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path.replace(KANBAN, "")}`);
  return { hermes, tasks, events, comments, fetch, helpers, writes };
}

const logs: string[] = [];
let clock = NOW * 1000;
beforeEach(() => {
  logs.length = 0;
  clock = NOW * 1000;
});

function step(h: ReturnType<typeof fakeHermes>, maxPerTick?: number) {
  return new TeamReviews({ hermes: h.hermes, hires: memoryHireStore(), log: (l) => logs.push(l), now: () => clock, maxPerTick });
}

/** A Head Engineer's task the VP created, parked in review with the VP named as reviewer (Hermes reassigned it). */
const headTask = (id = "t_sub") =>
  task({ id, title: "StoreLens · Repo onboarding", assignee: VP, created_by: VP, tenant: "zain-tech", status: "review", result: null, latest_summary: "Onboarding doc written" });

describe("team reviews", () => {
  it("wakes the reviewer named on the review request with a helper task", async () => {
    const h = fakeHermes([headTask()], [requested("t_sub", HEAD, VP)]);
    await step(h).tick();
    expect(h.helpers()).toHaveLength(1);
    const created = h.fetch.called(`POST ${KANBAN}/tasks`)[0]!.body as CreateTaskInput;
    expect(created).toMatchObject({ title: "Review: StoreLens · Repo onboarding", assignee: VP, tenant: "zain-tech", triage: false });
    expect(created.parents).toBeUndefined();
    expect(created.body).toContain("<!-- zain-team-review:t_sub -->");
    expect(created.body).toContain('kanban_show("t_sub")');
    expect(created.body).toContain('kanban_complete(summary="APPROVED: <one line>")');
    expect(created.body).toContain('Do not call kanban_complete, kanban_request_changes or kanban_block with task_id="t_sub"');
    expect(created.body).toContain('kanban_show("t_mandate")');
    expect(h.fetch.called(`POST ${KANBAN}/links`)).toHaveLength(0);
    expect(isMandate(h.helpers()[0]!, ROSTER)).toBe(false);
    expect(logs).toEqual([`team-review: woke ${VP} to review t_sub (t_new1)`]);
  });

  it("falls back to the implementer's manager when the request names no other reviewer", async () => {
    const t = task({ id: "t_fe", title: "Fix navbar", assignee: FRONTEND, created_by: HEAD, tenant: "zain-tech", status: "review" });
    const h = fakeHermes([t], [requested("t_fe", FRONTEND, null)]);
    await step(h).tick();
    expect(h.helpers().map((x) => x.assignee)).toEqual([HEAD]);
  });

  it("uses reportsTo for a task in review with no request event at all", async () => {
    const t = task({ id: "t_fe", assignee: FRONTEND, created_by: HEAD, tenant: "zain-tech", status: "review" });
    const h = fakeHermes([t]);
    await step(h).tick();
    expect(h.helpers().map((x) => x.assignee)).toEqual([HEAD]);
  });

  it("ignores HQ mandates and client replies in review", async () => {
    const mandate = task({ id: "t_m", assignee: "zain-growth-vp", created_by: "dashboard", status: "review" });
    const reply = task({ id: "t_r", title: "Client reply: pricing", assignee: "zain-hq-accounts", created_by: "zain-hq-accounts", tenant: "zain-hq", status: "review" });
    const h = fakeHermes([mandate, reply], [requested("t_m", "zain-growth-vp", null), requested("t_r", "zain-hq-accounts", null)]);
    await step(h).tick();
    expect(h.writes()).toEqual([]);
  });

  it("never creates a second helper while one is open", async () => {
    const h = fakeHermes([headTask()], [requested("t_sub", HEAD, VP)]);
    const s = step(h);
    await s.tick();
    await s.tick();
    await step(h).tick();
    expect(h.helpers()).toHaveLength(1);
    h.tasks.set("t_new1", { ...h.tasks.get("t_new1")!, status: "blocked" });
    await step(h).tick();
    expect(h.helpers()).toHaveLength(1);
  });

  it("archives an open helper once its task leaves review, but leaves a running one alone", async () => {
    const h = fakeHermes([headTask("t_a"), headTask("t_b")], [requested("t_a", HEAD, VP), requested("t_b", HEAD, VP)]);
    await step(h).tick();
    const [forA, forB] = h.helpers();
    h.tasks.set("t_a", { ...h.tasks.get("t_a")!, status: "done" });
    h.tasks.set("t_b", { ...h.tasks.get("t_b")!, status: "ready" });
    h.tasks.set(forB!.id, { ...forB!, status: "running" });
    await step(h).tick();
    expect(h.tasks.get(forA!.id)!.status).toBe("archived");
    expect(h.tasks.get(forB!.id)!.status).toBe("running");
    expect(logs).toContain(`team-review: archived ${forA!.id}; t_a left review`);
  });

  it("creates at most five helpers per tick", async () => {
    const ids = ["t_1", "t_2", "t_3", "t_4", "t_5", "t_6", "t_7"];
    const h = fakeHermes(ids.map((id) => headTask(id)), ids.map((id) => requested(id, HEAD, VP)));
    await step(h).tick();
    expect(h.helpers()).toHaveLength(5);
    await step(h).tick();
    expect(h.helpers()).toHaveLength(7);
    expect(new Set(h.helpers().map(teamReviewTarget))).toEqual(new Set(ids));
  });

  it("never wakes the CEO: a VP's own task has no reviewer, and helpers are not subscribed to Telegram", async () => {
    const own = task({ id: "t_own", assignee: VP, created_by: VP, tenant: "zain-tech", status: "review" });
    const ceo = task({ id: "t_ceo", assignee: "default", created_by: "default", tenant: "zain-labs", status: "review" });
    const h = fakeHermes([own, ceo, headTask()], [requested("t_own", VP, null), requested("t_ceo", "default", null), requested("t_sub", HEAD, VP)]);
    await step(h).tick();
    expect(h.helpers().map((x) => x.assignee)).toEqual([VP]);
    expect(h.helpers().map(teamReviewTarget)).toEqual(["t_sub"]);
    const exec = mockExec();
    const wake = new CeoWake({ hermes: h.hermes, execFile: exec.execFile, hermesBin: "/opt/hermes/bin/hermes", log: () => undefined });
    expect(await wake.backfill(await h.hermes.board(), ROSTER)).toBe(0);
    expect(exec.calls).toEqual([]);
  });

  it("skips a task whose reviewer is not on the roster, logging it once", async () => {
    const stray = task({ id: "t_x", assignee: "zain-tech-ghost", created_by: VP, tenant: "zain-tech", status: "review" });
    const named = task({ id: "t_y", assignee: "zain-unknown", created_by: VP, tenant: "zain-tech", status: "review" });
    const h = fakeHermes([stray, named], [requested("t_x", "zain-tech-ghost", null), requested("t_y", HEAD, "zain-unknown")]);
    const s = step(h);
    await s.tick();
    await s.tick();
    expect(h.helpers()).toEqual([]);
    expect(logs).toEqual([
      "team-review: t_x has no VP or Head Engineer to review it; skipped",
      "team-review: t_y has no VP or Head Engineer to review it; skipped",
    ]);
  });

  it("applies an approval: done, with the implementer's full handoff and the verdict as the result", async () => {
    const full = "Onboarding doc written\nBuild passes on Node 22; 114 tests pass.";
    const h = fakeHermes([{ ...headTask(), latest_summary: full }], [requested("t_sub", HEAD, VP, NOW - 60, "Onboarding doc written")]);
    await step(h).tick();
    h.tasks.set("t_new1", { ...h.tasks.get("t_new1")!, status: "done", completed_at: NOW, latest_summary: "APPROVED: doc is complete and accurate" });
    await step(h).tick();
    const patch = h.fetch.called(`PATCH ${KANBAN}/tasks/t_sub`)[0]!.body;
    expect(patch).toEqual({
      status: "done",
      summary: `Approved by ${VP}: doc is complete and accurate`,
      result: `${full}\n\nReviewer verdict (${VP}): APPROVED: doc is complete and accurate`,
    });
    expect(h.tasks.get("t_sub")!.result).toContain("114 tests pass");
    expect(h.comments.map((c) => [c.task_id, c.author])).toEqual([["t_sub", "zain-hq-ui"]]);
    expect(h.helpers()).toHaveLength(1);
  });

  it("an approval falls back to the event's summary when the task carries no matching handoff", async () => {
    const h = fakeHermes([{ ...headTask(), latest_summary: null, result: null }], [requested("t_sub", HEAD, VP, NOW - 60, "Shipped the fix")]);
    await step(h).tick();
    h.tasks.set("t_new1", { ...h.tasks.get("t_new1")!, status: "done", completed_at: NOW, latest_summary: "APPROVED" });
    await step(h).tick();
    expect((h.fetch.called(`PATCH ${KANBAN}/tasks/t_sub`)[0]!.body as UpdateTaskInput).result).toBe(`Shipped the fix\n\nReviewer verdict (${VP}): APPROVED`);
  });

  it("applies requested changes: reopened, reassigned to the implementer, with the changes as a comment", async () => {
    const h = fakeHermes([headTask()], [requested("t_sub", HEAD, VP)]);
    await step(h).tick();
    h.tasks.set("t_new1", { ...h.tasks.get("t_new1")!, status: "done", completed_at: NOW, latest_summary: "CHANGES REQUESTED: rerun tests on Node 22" });
    await step(h).tick();
    expect(h.fetch.called(`PATCH ${KANBAN}/tasks/t_sub`).map((c) => c.body)).toEqual([{ status: "todo" }, { assignee: HEAD }]);
    expect(h.tasks.get("t_sub")!.assignee).toBe(HEAD);
    expect(h.comments.map((c) => [c.task_id, c.body])).toEqual([["t_sub", `Changes requested by ${VP}: rerun tests on Node 22`]]);
  });

  it("requested changes on a task still assigned to its implementer need no reassignment", async () => {
    const t = task({ id: "t_fe", assignee: FRONTEND, created_by: HEAD, tenant: "zain-tech", status: "review" });
    const h = fakeHermes([t], [requested("t_fe", FRONTEND, null)]);
    await step(h).tick();
    h.tasks.set("t_new1", { ...h.tasks.get("t_new1")!, status: "done", completed_at: NOW, latest_summary: "CHANGES REQUESTED: add a test" });
    await step(h).tick();
    expect(h.fetch.called(`PATCH ${KANBAN}/tasks/t_fe`).map((c) => c.body)).toEqual([{ status: "todo" }]);
    expect(h.comments[0]!.body).toBe(`Changes requested by ${HEAD}: add a test`);
  });

  it("a done helper without a verdict: no new helper, one comment after the grace period", async () => {
    const h = fakeHermes([headTask()], [requested("t_sub", HEAD, VP)]);
    await step(h).tick();
    h.tasks.set("t_new1", { ...h.tasks.get("t_new1")!, status: "done", completed_at: NOW, latest_summary: "Looked at it." });
    const s = step(h);
    await s.tick();
    expect(h.comments).toEqual([]);
    clock += 11 * 60_000;
    await s.tick();
    await s.tick();
    await step(h).tick();
    expect(h.helpers()).toHaveLength(1);
    expect(h.comments).toHaveLength(1);
    expect(h.comments[0]!.body).toContain("<!-- zain-team-review-stalled:t_new1 -->");
    expect(logs.filter((l) => l.includes("still in review"))).toHaveLength(2);
    expect(h.fetch.called(`PATCH ${KANBAN}/tasks/t_sub`)).toHaveLength(0);
  });

  it("a new review round after requested changes gets a new helper", async () => {
    const h = fakeHermes([headTask()], [requested("t_sub", HEAD, VP, NOW - 600)]);
    await step(h).tick();
    h.tasks.set("t_new1", { ...h.tasks.get("t_new1")!, status: "done", created_at: NOW - 500, completed_at: NOW - 400, latest_summary: "CHANGES REQUESTED: more tests" });
    h.events.push(requested("t_sub", HEAD, VP, NOW - 10));
    await step(h).tick();
    expect(h.helpers().filter((x) => x.status === "ready")).toHaveLength(1);
    expect(h.fetch.called(`PATCH ${KANBAN}/tasks/t_sub`)).toHaveLength(0);
  });
});

describe("parseVerdict", () => {
  it("reads the verdict from the first words, and refuses changes without a reason", () => {
    expect(parseVerdict("APPROVED: fine")).toEqual({ approved: true, text: "fine" });
    expect(parseVerdict("**Approved** — fine")).toEqual({ approved: true, text: "fine" });
    expect(parseVerdict("CHANGES REQUESTED: a\nb")).toEqual({ approved: false, text: "a\nb" });
    expect(parseVerdict("CHANGES REQUESTED:")).toBeNull();
    expect(parseVerdict("I approved it")).toBeNull();
    expect(parseVerdict(null)).toBeNull();
  });
});
