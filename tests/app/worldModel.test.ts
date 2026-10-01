import { isManager, rosterOrFallback, toWorldAgents, toWorldStats, truncate } from "../../src/app/worldModel";
import type { KanbanBoard, KanbanTask, TaskStatus } from "../../shared/hermes";
import { TASK_STATUSES } from "../../shared/hermes";
import { ROSTER } from "../../shared/roster";

function task(id: string, status: TaskStatus, assignee: string, tenant: string, title = id): KanbanTask {
  return {
    id, title, body: null, assignee, status, priority: 0, created_by: null,
    created_at: 0, started_at: null, completed_at: null, tenant, result: null,
  };
}

function board(tasks: KanbanTask[]): KanbanBoard {
  return {
    columns: TASK_STATUSES.map((name) => ({ name, tasks: tasks.filter((t) => t.status === name) })),
    tenants: [], assignees: [], latest_event_id: 0, now: 0,
  };
}

describe("worldModel", () => {
  it("falls back to the static roster as vacant seats", () => {
    const roster = rosterOrFallback(undefined);
    expect(roster).toHaveLength(ROSTER.length);
    expect(roster.every((a) => !a.hired)).toBe(true);
  });

  it("maps activity and task title bubbles onto agents", () => {
    const b = board([task("t1", "running", "zain-studio-copy", "zain-studio", "Write the Ramadan campaign hero copy")]);
    const agents = toWorldAgents(rosterOrFallback(undefined), b);
    const copy = agents.find((a) => a.profile === "zain-studio-copy");
    expect(copy).toMatchObject({ activity: "working", division: "studio" });
    expect(copy?.bubble?.length).toBeLessThanOrEqual(28);
    expect(agents.find((a) => a.profile === "zain-studio-ux")).not.toHaveProperty("bubble");
  });

  it("treats every agent as idle before the board loads", () => {
    expect(toWorldAgents(rosterOrFallback(undefined), undefined).every((a) => a.activity === "idle")).toBe(true);
    expect(toWorldStats(undefined)).toBeNull();
  });

  it("computes stats for every division", () => {
    const stats = toWorldStats(board([task("m", "review", "zain-tech-vp", "zain-tech")]));
    expect(Object.keys(stats ?? {})).toEqual(["hq", "studio", "growth", "labs", "tech"]);
    expect(stats?.tech.awaitingApproval).toBe(1);
  });

  it("truncates long text with an ellipsis", () => {
    expect(truncate("short")).toBe("short");
    expect(truncate("x".repeat(40), 10)).toBe(`${"x".repeat(9)}…`);
  });

  it("identifies managers by rank", () => {
    expect(isManager({ rank: "vp" })).toBe(true);
    expect(isManager({ rank: "specialist" })).toBe(false);
    expect(isManager(undefined)).toBe(false);
  });
});
