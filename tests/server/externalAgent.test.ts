import { hire } from "../../server/src/org/hire";
import { fullRoster, memoryHireStore } from "../../server/src/org/hireStore";
import { mandateBody, soulFor } from "../../server/src/org/persona";
import { refreshPersonas } from "../../server/src/org/refreshPersonas";
import { toWorldAgents } from "../../src/app/worldModel";
import type { RosterEntry } from "../../shared/api";
import { agentActivity, rosterActivity } from "../../shared/flow";
import { CLAUDE_LANE, ROSTER, findAgent, managerOf } from "../../shared/roster";
import { fakeKanban } from "./fakeKanban";
import { NO_BRIEFS, setup } from "./helpers";

const claude = findAgent(CLAUDE_LANE)!;
const profile = (name: string) => ({ name, is_default: name === "default", model: "m", provider: "p", description: "", skill_count: 1 });

describe("Claude, the external lane agent", () => {
  it("is on the roster as Zain Studio's Creative Designer in Design, worked by Claude Code", () => {
    expect(claude).toMatchObject({
      name: "Claude",
      title: "Creative Designer",
      division: "studio",
      unit: "design",
      rank: "specialist",
      reportsTo: "zain-studio-vp",
      external: "claude-code",
      skills: [],
    });
    expect(ROSTER.filter((a) => a.external).map((a) => a.profile)).toEqual([CLAUDE_LANE]);
  });

  it("cannot be hired over HTTP, and nothing is sent to Hermes", async () => {
    const { send, hermesFetch } = setup({ "GET /api/profiles": () => ({ profiles: [profile("default")] }) });
    for (const body of [
      { profile: CLAUDE_LANE, title: "Creative Designer", division: "studio", rank: "specialist", reportsTo: "zain-studio-vp", skills: ["marketing:visual-content"] },
      { profile: "zain-studio-claude2", title: "Designer", division: "studio", rank: "specialist", reportsTo: "zain-studio-vp", skills: ["marketing:visual-content"], external: "claude-code" },
      { profile: "zain-studio-intern", title: "Intern", division: "studio", rank: "specialist", reportsTo: CLAUDE_LANE, skills: ["marketing:visual-content"] },
    ]) {
      const res = await send("POST", "/api/hire", body);
      expect(res.status, body.profile).toBe(400);
      expect((await res.json()).error).toMatch(/external/);
    }
    expect(hermesFetch.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("is refused by hire() itself and by the hire stores", async () => {
    const { hermes, hermesFetch } = setup({ "GET /api/profiles": () => ({ profiles: [profile("default")] }) });
    const hires = memoryHireStore();
    await expect(hire(claude, { hermes, headcount: null as never, hires, briefs: NO_BRIEFS, teams: null as never })).rejects.toThrow(/external agent/);
    await expect(hire({ ...claude, external: undefined }, { hermes, headcount: null as never, hires, briefs: NO_BRIEFS, teams: null as never })).rejects.toThrow(
      /external agent/,
    );
    expect(hermesFetch.calls.filter((c) => c.method !== "GET")).toEqual([]);
    await expect(hires.save(claude)).rejects.toThrow(/external agent/);
    await expect(hires.save({ ...claude, profile: "zain-studio-other" })).rejects.toThrow(/external agent/);
    expect((await fullRoster(hires)).filter((a) => a.profile === CLAUDE_LANE)).toHaveLength(1);
  });

  it("is skipped by the persona refresh even if a profile with his lane name exists", async () => {
    const lines: string[] = [];
    const { hermes, hermesFetch } = setup({ "GET /api/profiles": () => ({ profiles: [profile("default"), profile(CLAUDE_LANE)] }) });
    expect(await refreshPersonas({ hermes, hires: memoryHireStore(), briefs: NO_BRIEFS, apply: true, log: (l) => lines.push(l) })).toBe(0);
    expect(hermesFetch.calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect(lines).toContain(`skip ${CLAUDE_LANE} (external: claude-code, not a Hermes profile)`);
  });

  it("shows as on staff in /api/roster without a Hermes profile", async () => {
    const { send } = setup({ "GET /api/profiles": () => ({ profiles: [profile("default")] }) });
    const { agents } = (await (await send("GET", "/api/roster")).json()) as { agents: RosterEntry[] };
    expect(agents.find((a) => a.profile === CLAUDE_LANE)).toMatchObject({ hired: true, model: null, external: "claude-code" });
    expect(agents.find((a) => a.profile === "zain-studio-art")).toMatchObject({ hired: false });
  });

  it("is on the Studio VP's team list, in the SOUL and in every Studio mandate", () => {
    const vp = managerOf("studio");
    for (const text of [soulFor(vp, ROSTER), mandateBody("Launch visuals", vp, ROSTER)]) {
      expect(text).toContain(`- \`${CLAUDE_LANE}\` — Creative Designer (Design) · Claude on Claude Code: Designs every ad`);
    }
    expect(mandateBody("x", managerOf("growth"), ROSTER)).not.toContain(CLAUDE_LANE);
  });
});

describe("Claude's status", () => {
  it("is working while a task on his lane runs, otherwise idle, read from the kanban", async () => {
    const kanban = fakeKanban();
    const { hermes } = setup(kanban.routes);
    const queued = await hermes.createTask({ title: "Ramadan ad set", assignee: CLAUDE_LANE, tenant: "zain-studio", triage: false });

    let board = await hermes.board();
    expect(rosterActivity(claude, board)).toEqual({ activity: "idle", task: null });
    expect(agentActivity(CLAUDE_LANE, board).activity).toBe("queued");

    await hermes.updateTask(queued.id, { status: "running" });
    board = await hermes.board();
    expect(rosterActivity(claude, board)).toMatchObject({ activity: "working", task: { id: queued.id } });

    const entries = ROSTER.map((a) => ({ ...a, hired: true, model: null }));
    expect(toWorldAgents(entries, board).find((a) => a.profile === CLAUDE_LANE)).toMatchObject({
      title: "Claude",
      activity: "working",
      unit: "design",
      bubble: "Ramadan ad set",
    });

    await hermes.updateTask(queued.id, { status: "review" });
    expect(rosterActivity(claude, await hermes.board()).activity).toBe("idle");
  });

  it("leaves Hermes agents on the full activity model", async () => {
    const kanban = fakeKanban();
    const { hermes } = setup(kanban.routes);
    await hermes.createTask({ title: "Logo", assignee: "zain-studio-art", tenant: "zain-studio", triage: false });
    expect(rosterActivity(findAgent("zain-studio-art")!, await hermes.board()).activity).toBe("queued");
  });
});
