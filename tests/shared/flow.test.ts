import { agentActivity, divisionStats, isMandate, pendingApprovals } from "../../shared/flow";
import type { KanbanBoard, KanbanTask, TaskStatus } from "../../shared/hermes";
import { TASK_STATUSES } from "../../shared/hermes";

function task(id: string, status: TaskStatus, assignee: string | null, tenant = "zain-studio"): KanbanTask {
  return {
    id, title: id, body: null, assignee, status, priority: 0, created_by: null,
    created_at: 0, started_at: null, completed_at: null, tenant, result: null,
  };
}

function board(tasks: KanbanTask[]): KanbanBoard {
  return {
    columns: TASK_STATUSES.map((name) => ({ name, tasks: tasks.filter((t) => t.status === name) })),
    tenants: [], assignees: [], latest_event_id: 0, now: 0,
  };
}

describe("flow", () => {
  const b = board([
    task("m1", "review", "zain-studio-vp"),
    task("c1", "running", "zain-studio-copy"),
    task("c2", "blocked", "zain-studio-copy"),
    task("c3", "ready", "zain-studio-art"),
    task("c4", "done", "zain-studio-art"),
    task("g1", "running", "zain-growth-paid", "zain-growth"),
  ]);

  it("treats VP-assigned tasks as mandates", () => {
    expect(isMandate(task("x", "todo", "zain-studio-vp"))).toBe(true);
    expect(isMandate(task("x", "todo", "zain-studio-copy"))).toBe(false);
    expect(isMandate(task("x", "todo", null))).toBe(false);
  });

  it("lists tasks awaiting HQ approval", () => {
    expect(pendingApprovals(b).map((t) => t.id)).toEqual(["m1"]);
  });

  it("surfaces the most urgent activity per agent", () => {
    expect(agentActivity("zain-studio-copy", b)).toMatchObject({ activity: "blocked", task: { id: "c2" } });
    expect(agentActivity("zain-studio-vp", b).activity).toBe("awaiting-approval");
    expect(agentActivity("zain-studio-art", b).activity).toBe("queued");
    expect(agentActivity("zain-studio-ux", b)).toEqual({ activity: "idle", task: null });
  });

  it("counts division stats by tenant", () => {
    expect(divisionStats(b, "zain-studio")).toEqual({ working: 1, blocked: 1, awaitingApproval: 1, queued: 1, done: 1 });
    expect(divisionStats(b, "zain-growth").working).toBe(1);
  });
});
