import {
  agentActivity,
  boardConsultations,
  divisionStats,
  hqDecisionCount,
  isBoardTask,
  isClientReply,
  isMandate,
  pendingApprovals,
  pendingClientReplies,
  splitMandateBody,
  waitingSubtaskReviews,
} from "../../shared/flow";
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

const allOf = (b: KanbanBoard) => b.columns.flatMap((c) => c.tasks);

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

  it("lists only mandates awaiting HQ approval", () => {
    const withSpecialistReview = board([...allOf(b), task("s1", "review", "zain-studio-copy"), task("u1", "review", null)]);
    expect(pendingApprovals(withSpecialistReview).map((t) => t.id)).toEqual(["m1"]);
  });

  it("recognises mandates of locally hired VPs when given the merged roster", () => {
    const hired = { profile: "zain-studio-vp2", title: "VP Motion", division: "studio" as const, rank: "vp" as const, reportsTo: "default", skills: [] };
    const b2 = board([task("m2", "review", "zain-studio-vp2")]);
    expect(pendingApprovals(b2)).toEqual([]);
    expect(pendingApprovals(b2, [hired]).map((t) => t.id)).toEqual(["m2"]);
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

  it("lists specialists' review tasks separately from HQ approvals", () => {
    const b2 = board([...allOf(b), task("s1", "review", "zain-studio-copy")]);
    expect(waitingSubtaskReviews(b2).map((t) => t.id)).toEqual(["s1"]);
  });
});

describe("splitMandateBody", () => {
  const instructions = "**Instructions for VP Studio (`zain-studio-vp`)**\n\nThis is an HQ mandate.";

  it("splits HQ's brief from the VP instructions", () => {
    expect(splitMandateBody(`Rebrand the site\n\n  keep spacing\n\n---\n${instructions}`)).toEqual({
      brief: "Rebrand the site\n\n  keep spacing",
      instructions,
    });
  });

  it("keeps a --- inside the brief and splits at the instructions heading", () => {
    expect(splitMandateBody(`Part one\n---\nPart two\n\n---\n${instructions}`)).toEqual({
      brief: "Part one\n---\nPart two",
      instructions,
    });
  });

  it("returns the whole body when there are no instructions", () => {
    expect(splitMandateBody("Just a brief\n---\nmore")).toEqual({ brief: "Just a brief\n---\nmore", instructions: null });
    expect(splitMandateBody("brief\n---")).toEqual({ brief: "brief\n---", instructions: null });
    expect(splitMandateBody("x\n --- \n**Instructions for VP**")).toEqual({ brief: "x\n --- \n**Instructions for VP**", instructions: null });
  });
});

describe("board consultations", () => {
  it("never treats board consultations as mandates or HQ approvals, and lists them newest first", () => {
    const b3 = board([
      { ...task("b_old", "review", "zain-board-hormozi", "zain-hq"), created_at: 1 },
      { ...task("b_new", "running", "zain-board-hormozi", "zain-hq"), created_at: 5 },
      task("m1", "review", "zain-hq-coo", "zain-hq"),
    ]);
    expect(isMandate(task("x", "review", "zain-board-hormozi"))).toBe(false);
    expect(isBoardTask(task("x", "review", "zain-board-hormozi"))).toBe(true);
    expect(isBoardTask(task("x", "review", "zain-hq-coo"))).toBe(false);
    expect(pendingApprovals(b3).map((t) => t.id)).toEqual(["m1"]);
    expect(boardConsultations(b3).map((t) => t.id)).toEqual(["b_new", "b_old"]);
  });
});

describe("client replies", () => {
  const cr = (id: string, status: TaskStatus, assignee: string | null, title = `Client reply: Acme — ${id}`) => ({ ...task(id, status, assignee, "zain-hq"), title });
  const b4 = board([
    cr("c1", "review", "zain-hq-accounts"),
    cr("c2", "running", "zain-hq-accounts"),
    cr("c3", "review", "zain-hq-finance"),
    cr("c4", "review", "zain-hq-accounts", "Prepare Acme deck"),
    task("m1", "review", "zain-hq-coo", "zain-hq"),
  ]);

  it("are tasks titled Client reply: for an agent with client channels", () => {
    expect(isClientReply(cr("x", "review", "zain-hq-accounts"))).toBe(true);
    expect(isClientReply(cr("x", "review", "zain-hq-finance"))).toBe(false);
    expect(isClientReply(cr("x", "review", "zain-hq-accounts", "Client update"))).toBe(false);
    expect(isClientReply(cr("x", "review", null))).toBe(false);
  });

  it("await HQ alongside mandates without becoming mandates", () => {
    expect(pendingClientReplies(b4).map((t) => t.id)).toEqual(["c1"]);
    expect(pendingApprovals(b4).map((t) => t.id)).toEqual(["m1"]);
    expect(hqDecisionCount(b4)).toBe(2);
    expect(waitingSubtaskReviews(b4).map((t) => t.id).sort()).toEqual(["c3", "c4"]);
  });
});
