import {
  hqDecisionCount,
  internalReviewsFor,
  isInternalReview,
  isMandate,
  pendingApprovals,
  waitingSubtaskReviews,
} from "../../shared/flow";
import type { KanbanBoard, KanbanTask, TaskStatus } from "../../shared/hermes";
import { TASK_STATUSES } from "../../shared/hermes";

function task(id: string, status: TaskStatus, assignee: string, created_by: string | null): KanbanTask {
  return {
    id, title: id, body: null, assignee, status, priority: 0, created_by,
    created_at: Number(id.replace(/\D/g, "")) || 0, started_at: null, completed_at: null, tenant: "zain-tech", result: null,
  };
}

function board(tasks: KanbanTask[]): KanbanBoard {
  return {
    columns: TASK_STATUSES.map((name) => ({ name, tasks: tasks.filter((t) => t.status === name) })),
    tenants: [], assignees: [], latest_event_id: 0, now: 0,
  };
}

describe("internal reviews (Zain Tech)", () => {
  const mandate = task("m1", "review", "zain-tech-vp", "dashboard");
  const ceoMandate = task("m2", "review", "zain-tech-vp", "default");
  const teamRollup = task("t3", "review", "zain-tech-vp", "zain-tech-vp");
  const prReview = task("t4", "review", "zain-tech-storelens-head", "zain-tech-storelens-head");
  const specialistReview = task("t5", "review", "zain-tech-storelens-frontend", "zain-tech-storelens-head");
  const b = board([mandate, ceoMandate, teamRollup, prReview, specialistReview]);

  it("keeps HQ- and CEO-created VP tasks as mandates but not the VP's own team roll-ups", () => {
    expect(isMandate(mandate)).toBe(true);
    expect(isMandate(ceoMandate)).toBe(true);
    expect(isMandate(teamRollup)).toBe(false);
    expect(isMandate(task("x", "todo", "zain-tech-vp", "zain-growth-vp"))).toBe(true);
  });

  it("shows HQ only the mandates", () => {
    expect(pendingApprovals(b).map((t) => t.id)).toEqual(["m1", "m2"]);
    expect(hqDecisionCount(b)).toBe(2);
  });

  it("routes a lead's roll-up to the VP and specialist work to the Head Engineer, never to HQ's inbox", () => {
    expect(isInternalReview(teamRollup)).toBe(true);
    expect(isInternalReview(prReview)).toBe(true);
    expect(isInternalReview(specialistReview)).toBe(false);
    expect(isInternalReview(mandate)).toBe(false);
    expect(isInternalReview({ ...teamRollup, status: "running" })).toBe(false);
    expect(internalReviewsFor(b, "zain-tech-vp").map((t) => t.id)).toEqual(["t3"]);
    expect(internalReviewsFor(b, "zain-tech-storelens-head").map((t) => t.id)).toEqual(["t4"]);
    expect(waitingSubtaskReviews(b).map((t) => t.id)).toEqual(["t5"]);
  });
});
