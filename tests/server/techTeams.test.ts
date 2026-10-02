import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryHireStore } from "../../server/src/org/hireStore";
import { allTeams, fileTeamStore, memoryTeamStore } from "../../server/src/org/teamStore";
import type { KanbanTask } from "../../shared/hermes";
import { ROSTER } from "../../shared/roster";
import { TECH_TEAMS } from "../../shared/techTeams";
import { KANBAN, mockExec, setup, task, type Handler } from "./helpers";

const defaultProfile = { name: "default", is_default: true, model: "m", provider: "x", description: "", skill_count: 1 };
const profile = (name: string) => ({ ...defaultProfile, name, is_default: false });

const specialist = {
  profile: "zain-tech-storelens-mobile",
  title: "StoreLens · Mobile Engineer",
  division: "tech",
  rank: "specialist",
  reportsTo: "zain-tech-storelens-head",
  team: "storelens",
  teamRole: "specialist",
  focus: "Merchant mobile app.",
  skills: ["agency:engineering/engineering-mobile-app-builder"],
};

function hermesRoutes(hired: string[] = [], overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "GET /api/profiles": () => ({ profiles: [defaultProfile, ...hired.map(profile)] }),
    "POST /api/profiles": () => ({ ok: true }),
    "POST /api/skills": () => ({ success: true }),
    ...overrides,
  };
}

const okSoul = (p: string): Record<string, Handler> => ({
  [`PUT /api/profiles/${p}/soul`]: () => ({ ok: true }),
  [`PUT /api/profiles/${p}/description`]: () => ({ ok: true }),
});

describe("POST /api/hire with a repo team", () => {
  it("hires a team specialist under the Head Engineer and rewrites the leads' and VP's SOULs", async () => {
    const hires = memoryHireStore();
    const { send, hermesFetch } = setup(
      hermesRoutes(["zain-tech-vp", "zain-tech-storelens-head", "zain-tech-storelens-pm"], {
        ...okSoul(specialist.profile),
        ...okSoul("zain-tech-vp"),
        ...okSoul("zain-tech-storelens-head"),
        ...okSoul("zain-tech-storelens-pm"),
      }),
      { hires },
    );
    const res = await send("POST", "/api/hire", specialist);
    const out = await res.json();
    expect(out.ok).toBe(true);
    expect((await hires.list())[0]).toMatchObject({ team: "storelens", teamRole: "specialist", focus: "Merchant mobile app." });
    const skill = hermesFetch.called("POST /api/skills")[0]!.body as Record<string, string>;
    expect(skill).toMatchObject({ name: "ag-engineering-mobile-app-builder", category: "zain-tech-agency" });
    const souls = out.steps.filter((s: { step: string }) => s.step === "write-soul").map((s: { target: string }) => s.target);
    expect(souls).toEqual([specialist.profile, "zain-tech-storelens-head", "zain-tech-storelens-pm", "zain-tech-vp"]);
    const headSoul = (hermesFetch.called("PUT /api/profiles/zain-tech-storelens-head/soul")[0]!.body as { content: string }).content;
    expect(headSoul).toContain("   - `zain-tech-storelens-mobile`");
  });

  it("accepts a lead for a runtime team", async () => {
    const teams = memoryTeamStore([{ id: "zainpay", name: "Zain Pay", repo: "abdelhalimemara/zainpay", summary: "Payments." }]);
    const { send } = setup(hermesRoutes([], okSoul("zain-tech-zainpay-head")), { teams });
    const res = await send("POST", "/api/hire", {
      ...specialist, profile: "zain-tech-zainpay-head", title: "Zain Pay · Head Engineer", rank: "lead",
      reportsTo: "zain-tech-vp", team: "zainpay", teamRole: "head-engineer",
    });
    expect((await res.json()).ok).toBe(true);
  });

  it.each([
    [{ team: "mars" }, "not a Zain Tech team"],
    [{ team: 7 }, "team must be a string"],
    [{ division: "growth", reportsTo: "zain-growth-vp" }, "only Zain Tech"],
    [{ teamRole: "boss" }, "teamRole must be"],
    [{ team: undefined }, "teamRole needs a team"],
    [{ reportsTo: "zain-tech-vp" }, "report to the StoreLens Head Engineer"],
    [{ reportsTo: "zain-tech-storelens-pm" }, "report to the StoreLens Head Engineer"],
    [{ rank: "lead" }, "rank specialist"],
    [{ teamRole: "head-engineer" }, "rank lead"],
    [{ teamRole: "head-engineer", rank: "lead", reportsTo: "zain-tech-storelens-head" }, "report to the VP Tech"],
    [{ teamRole: "project-manager", rank: "lead", reportsTo: "zain-tech-vp" }, "already has a project-manager"],
    [{ focus: "x".repeat(201) }, "focus"],
    [{ skills: ["agency:engineering/engineering-nope"] }, "unknown skill"],
    [{ skills: ["agency:design/design-ui-designer"] }, "unknown skill"],
    [{ profile: "zain-tech-storelens-frontend", title: "StoreLens · Frontend Engineer", team: "bookme", reportsTo: "zain-tech-bookme-head" }, "must match the roster"],
  ])("rejects %j", async (overrides, error) => {
    const { send, hermesFetch } = setup(hermesRoutes());
    const res = await send("POST", "/api/hire", { ...specialist, ...overrides });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(error);
    expect(hermesFetch.called("POST /api/profiles")).toHaveLength(0);
  });
});

describe("tech teams API", () => {
  const body = { id: "zainpay", name: "Zain Pay", repo: "abdelhalimemara/zainpay", summary: "Payments gateway.", stack: "Node" };

  it("lists built-in teams with their roster and hired state", async () => {
    const { send } = setup(hermesRoutes(["zain-tech-storelens-head"]));
    const { teams } = await (await send("GET", "/api/tech/teams")).json();
    expect(teams.map((t: { id: string }) => t.id)).toEqual(TECH_TEAMS.map((t) => t.id));
    const storelens = teams[0];
    expect(storelens.runtime).toBe(false);
    expect(storelens.members).toHaveLength(ROSTER.filter((a) => a.team === "storelens").length);
    expect(storelens.members.find((m: { profile: string }) => m.profile === "zain-tech-storelens-head").hired).toBe(true);
    expect(storelens.members.find((m: { profile: string }) => m.profile === "zain-tech-storelens-pm").hired).toBe(false);
  });

  it("creates a team for a repo gh can see, then lists it", async () => {
    const exec = mockExec();
    const teams = memoryTeamStore();
    const { send } = setup(hermesRoutes(), { teams, gh: { execFile: exec.execFile, ghBin: "/opt/gh" } });
    const res = await send("POST", "/api/tech/teams", body);
    expect(res.status).toBe(201);
    expect((await res.json()).team).toEqual(body);
    expect(exec.calls).toEqual([{ file: "/opt/gh", args: ["repo", "view", "abdelhalimemara/zainpay", "--json", "nameWithOwner"], timeout: 15_000 }]);
    const listed = (await (await send("GET", "/api/tech/teams")).json()).teams.at(-1);
    expect(listed).toMatchObject({ id: "zainpay", runtime: true, members: [] });
  });

  it("refuses a repo gh cannot see", async () => {
    const teams = memoryTeamStore();
    const { send } = setup(hermesRoutes(), { teams, gh: { execFile: mockExec(() => true).execFile } });
    const res = await send("POST", "/api/tech/teams", body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("gh cannot see");
    expect(await teams.list()).toEqual([]);
  });

  it.each([
    [{ id: "Zain Pay" }, "id"],
    [{ id: "x" }, "id"],
    [{ repo: "zainpay" }, "repo"],
    [{ repo: "a/b c" }, "repo"],
    [{ repo: "owner/.." }, "repo"],
    [{ repo: "-owner/x" }, "repo"],
    [{ name: "" }, "name"],
    [{ summary: "s".repeat(301) }, "summary"],
  ])("validates %j", async (overrides, field) => {
    const exec = mockExec();
    const { send } = setup(hermesRoutes(), { gh: { execFile: exec.execFile } });
    const res = await send("POST", "/api/tech/teams", { ...body, ...overrides });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(field);
    expect(exec.calls).toHaveLength(0);
  });

  it.each([
    [{ id: "storelens" }, "already exists"],
    [{ repo: "AbdelhalimEmara/BookMe" }, "already belongs to team bookme"],
  ])("refuses duplicates %j with 409", async (overrides, error) => {
    const { send } = setup(hermesRoutes(), { gh: { execFile: mockExec().execFile } });
    const res = await send("POST", "/api/tech/teams", { ...body, ...overrides });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain(error);
  });

  it("persists runtime teams in .zain/teams.json and ignores invalid rows", async () => {
    const root = await mkdtemp(join(tmpdir(), "zain-teams-"));
    try {
      const store = fileTeamStore(root);
      await store.save({ id: "zainpay", name: "Zain Pay", repo: "abdelhalimemara/zainpay", summary: "P" });
      await store.save({ id: "zainpay", name: "Zain Pay 2", repo: "abdelhalimemara/zainpay", summary: "P" });
      const raw = JSON.parse(await readFile(join(root, ".zain", "teams.json"), "utf8"));
      expect(raw).toHaveLength(1);
      expect(raw[0].name).toBe("Zain Pay 2");
      await writeFile(join(root, ".zain", "teams.json"), JSON.stringify([...raw, { id: "BAD ID" }, { id: "storelens", name: "x", repo: "a/b", summary: "s" }]));
      expect((await store.list()).map((t) => t.id)).toEqual(["zainpay", "storelens"]);
      expect((await allTeams(store)).map((t) => t.id)).toEqual([...TECH_TEAMS.map((t) => t.id), "zainpay"]);
      await mkdir(join(root, "empty"));
      expect(await fileTeamStore(join(root, "empty")).list()).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("reconciler on team lead tasks", () => {
  const LEAD = "t_lead";
  const tasks: KanbanTask[] = [
    task({ id: "t_m", status: "blocked", assignee: "zain-tech-vp", tenant: "zain-tech", created_by: "dashboard" }),
    task({ id: LEAD, status: "blocked", assignee: "zain-tech-storelens-head", tenant: "zain-tech", created_by: "zain-tech-vp" }),
    task({ id: "t_spec", status: "todo", assignee: "zain-tech-storelens-frontend", tenant: "zain-tech", created_by: "zain-tech-storelens-head" }),
  ];

  it("flips a specialist edge created the wrong way round but keeps the lead → mandate edge", async () => {
    const links = new Set([`${LEAD}>t_m`, `${LEAD}>t_spec`]);
    const children = (id: string) => [...links].filter((l) => l.startsWith(`${id}>`)).map((l) => l.split(">")[1]!);
    const parents = (id: string) => [...links].filter((l) => l.endsWith(`>${id}`)).map((l) => l.split(">")[0]!);
    const counts = () => tasks.map((t) => ({ ...t, link_counts: { parents: parents(t.id).length, children: children(t.id).length } }));
    const names = ["todo", "ready", "running", "blocked", "review", "done"];
    const { hermes, hermesFetch } = setup({
      [`GET ${KANBAN}/board`]: () => ({ columns: names.map((name) => ({ name, tasks: counts().filter((t) => t.status === name) })), tenants: [], assignees: [], latest_event_id: 1, now: 2 }),
      ...Object.fromEntries(tasks.map((t) => [`GET ${KANBAN}/tasks/${t.id}`, () => ({ task: t, comments: [], links: { parents: parents(t.id), children: children(t.id) } })])),
      [`DELETE ${KANBAN}/links`]: (c) => ({ ok: links.delete(`${c.query.get("parent_id")}>${c.query.get("child_id")}`) }),
      [`POST ${KANBAN}/links`]: (c) => {
        const { parent_id, child_id } = c.body as { parent_id: string; child_id: string };
        links.add(`${parent_id}>${child_id}`);
        return { ok: true };
      },
      [`PATCH ${KANBAN}/tasks/${LEAD}`]: () => ({ task: tasks[1] }),
      [`POST ${KANBAN}/tasks/${LEAD}/comments`]: () => ({ ok: true }),
    });
    const { reconcileOnce } = await import("../../server/src/org/reconcile");
    expect(await reconcileOnce(hermes, ROSTER, () => undefined)).toBe(1);
    expect([...links].sort()).toEqual([`${LEAD}>t_m`, `t_spec>${LEAD}`]);
    const comment = hermesFetch.called(`POST ${KANBAN}/tasks/${LEAD}/comments`)[0]!.body as { body: string };
    expect(comment.body).toContain("prerequisite of this task");
  });
});
