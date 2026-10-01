import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileHireStore, fullRoster, memoryHireStore } from "../../server/src/org/hireStore";
import { ROSTER } from "../../shared/roster";
import { json, setup, type Handler } from "./helpers";

const request = {
  profile: "zain-tech-data",
  title: "Data Engineer",
  division: "tech",
  rank: "specialist",
  reportsTo: "zain-tech-vp",
  skills: ["technology:api-design", "security:incident-response"],
};

const defaultProfile = { name: "default", is_default: true, model: "gpt-6-luna", provider: "x", description: "", skill_count: 90 };

function hermesRoutes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "GET /api/profiles": () => ({ profiles: [defaultProfile] }),
    "POST /api/profiles": () => ({ ok: true }),
    "PUT /api/profiles/zain-tech-data/soul": () => ({ ok: true }),
    "PUT /api/profiles/zain-tech-data/description": () => ({ ok: true }),
    "POST /api/skills": () => ({ success: true }),
    ...overrides,
  };
}

describe("POST /api/hire validation", () => {
  it.each([
    [{ profile: "data-engineer" }, "profile"],
    [{ profile: "zain-X" }, "profile"],
    [{ title: "" }, "title"],
    [{ title: "x".repeat(61) }, "title"],
    [{ division: "mars" }, "division"],
    [{ rank: "ceo" }, "rank"],
    [{ reportsTo: "zain-nobody" }, "reportsTo"],
    [{ reportsTo: null }, "reportsTo"],
    [{ skills: [] }, "skills"],
    [{ skills: Array.from({ length: 16 }, (_, i) => `technology:s${i}`) }, "skills"],
    [{ skills: ["technology:not-a-skill"] }, "unknown headcount skill"],
    [{ skills: ["api-design"] }, "department:skill"],
    [{ skills: "technology:api-design" }, "skills"],
    [{ reviewer: "yes" }, "reviewer"],
  ])("rejects %j", async (patch, message) => {
    const { send, hermesFetch } = setup(hermesRoutes());
    const res = await send("POST", "/api/hire", { ...request, ...patch });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(message);
    expect(hermesFetch.calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });
});

describe("POST /api/hire", () => {
  it("clones default without channels, writes soul and description, installs each skill in order", async () => {
    const { send, hermesFetch, hires } = setup(hermesRoutes());
    const res = await send("POST", "/api/hire", request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.steps.map((s: { step: string; target: string }) => `${s.step}:${s.target}`)).toEqual([
      "create-profile:zain-tech-data",
      "write-soul:zain-tech-data",
      "describe:zain-tech-data",
      "install-skill:technology:api-design",
      "install-skill:security:incident-response",
    ]);

    const create = hermesFetch.called("POST /api/profiles")[0]!.body as Record<string, unknown>;
    expect(create).toMatchObject({ name: "zain-tech-data", clone_from: "default", clone_channels: false });
    expect(create).not.toHaveProperty("no_skills");
    expect(create).not.toHaveProperty("model");

    const soul = (hermesFetch.called("PUT /api/profiles/zain-tech-data/soul")[0]!.body as { content: string }).content;
    expect(soul).toContain("Data Engineer");
    expect(soul).toContain("Zain Tech");
    expect(soul).toContain("VP Tech (`zain-tech-vp`)");
    expect(soul).toContain("kanban_complete");
    expect(soul).toMatch(/Do not request review from HQ/);
    expect(soul).not.toContain("kanban_link");
    expect(soul).not.toContain("Reviewer authority");

    const desc = (hermesFetch.called("PUT /api/profiles/zain-tech-data/description")[0]!.body as { description: string }).description;
    expect(desc).toContain("Zain Tech");
    expect(desc).toContain("Data Engineer");

    const skills = hermesFetch.called("POST /api/skills").map((c) => c.body as Record<string, string>);
    expect(skills.map((s) => s.name)).toEqual(["hc-technology-api-design", "hc-security-incident-response"]);
    for (const s of skills) {
      expect(s).toMatchObject({ category: "headcount", profile: "zain-tech-data" });
      expect(s.content).toMatch(/^---\nname: hc-[a-z-]+\ndescription: "[^"]{1,60}"\n---\n/);
    }
    expect((await hires.list()).map((h) => h.profile)).toEqual(["zain-tech-data"]);
  });

  it("gives reviewer-class VPs decomposition, roll-up and blocking duties", async () => {
    const { send, hermesFetch } = setup(
      hermesRoutes({ "PUT /api/profiles/zain-tech-cto2/soul": () => ({}), "PUT /api/profiles/zain-tech-cto2/description": () => ({}) }),
    );
    await send("POST", "/api/hire", { ...request, profile: "zain-tech-cto2", rank: "vp", reportsTo: "default", reviewer: true });
    const soul = (hermesFetch.called("PUT /api/profiles/zain-tech-cto2/soul")[0]!.body as { content: string }).content;
    expect(soul).toContain('tenant="zain-tech"');
    expect(soul).toContain("kanban_link(parent_id=<subtask id>, child_id=<this mandate's id>)");
    expect(soul).toContain('kanban_block(kind="dependency"');
    expect(soul).toContain("kanban_request_review");
    expect(soul).toMatch(/Never complete the mandate yourself/);
    expect(soul).toContain("may block");
    expect(soul).toContain("`zain-tech-fullstack`");
    expect(soul).not.toMatch(/zain-(growth|studio|labs|hq)-/);
    expect(soul).toContain("the CEO");
  });

  it("continues past a failed skill and reports it", async () => {
    const { send } = setup(
      hermesRoutes({
        "POST /api/skills": (call) =>
          (call.body as { name: string }).name === "hc-technology-api-design"
            ? json({ detail: "Description is too long" }, 400)
            : { success: true },
      }),
    );
    const body = await (await send("POST", "/api/hire", request)).json();
    expect(body.ok).toBe(false);
    expect(body.steps).toHaveLength(5);
    expect(body.steps[3]).toEqual({ step: "install-skill", target: "technology:api-design", ok: false, error: "Description is too long" });
    expect(body.steps[4]).toMatchObject({ target: "security:incident-response", ok: true });
  });

  it("stops when the profile cannot be created", async () => {
    const { send, hermesFetch, hires } = setup(hermesRoutes({ "POST /api/profiles": () => json({ detail: "disk full" }, 500) }));
    const body = await (await send("POST", "/api/hire", request)).json();
    expect(body).toEqual({ ok: false, profile: "zain-tech-data", steps: [{ step: "create-profile", target: "zain-tech-data", ok: false, error: "disk full" }] });
    expect(hermesFetch.called("POST /api/skills")).toHaveLength(0);
    expect(await hires.list()).toEqual([]);
  });

  it("is idempotent: existing profile is kept and already-installed skills count as done", async () => {
    const { send, hermesFetch } = setup(
      hermesRoutes({
        "GET /api/profiles": () => ({ profiles: [defaultProfile, { ...defaultProfile, name: "zain-tech-data", is_default: false }] }),
        "POST /api/skills": () => json({ detail: "A skill named 'hc-technology-api-design' already exists at /x." }, 400),
      }),
    );
    const body = await (await send("POST", "/api/hire", request)).json();
    expect(body.ok).toBe(true);
    expect(hermesFetch.called("POST /api/profiles")).toHaveLength(0);
    expect(body.steps[0]).toEqual({ step: "create-profile", target: "zain-tech-data", ok: true });
  });
});

describe("hiring canonical roster positions", () => {
  const qa = ROSTER.find((a) => a.profile === "zain-tech-qa")!;
  const qaRoutes = hermesRoutes({ "PUT /api/profiles/zain-tech-qa/soul": () => ({}), "PUT /api/profiles/zain-tech-qa/description": () => ({}) });

  it.each([
    [{ title: "Chief Hacker" }, "title"],
    [{ division: "growth" }, "division"],
    [{ rank: "vp" }, "rank"],
    [{ reportsTo: "default" }, "reportsTo"],
  ])("rejects %j as a mismatch with the roster", async (patch, field) => {
    const { send, hermesFetch } = setup(qaRoutes);
    const res = await send("POST", "/api/hire", { ...qa, skills: ["technology:code-review"], ...patch });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(new RegExp(`roster position.*${field}`));
    expect(hermesFetch.calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });

  it("hires a roster position with matching fields, idempotently and without persisting it locally", async () => {
    let exists = false;
    const { send, hires, hermesFetch } = setup({
      ...qaRoutes,
      "GET /api/profiles": () => ({ profiles: exists ? [defaultProfile, { ...defaultProfile, name: "zain-tech-qa" }] : [defaultProfile] }),
      "POST /api/profiles": () => {
        exists = true;
        return { ok: true };
      },
    });
    expect((await (await send("POST", "/api/hire", { ...qa, title: `  ${qa.title} ` })).json()).ok).toBe(true);
    expect((await (await send("POST", "/api/hire", qa)).json()).ok).toBe(true);
    expect(hermesFetch.called("POST /api/profiles")).toHaveLength(1);
    expect(await hires.list()).toEqual([]);
  });
});

describe("GET /api/roster", () => {
  it("merges ROSTER and local hires with live profiles", async () => {
    const hires = memoryHireStore([{ ...request, division: "tech", rank: "specialist", skills: ["technology:api-design"] }]);
    const { send } = setup(
      { "GET /api/profiles": () => ({ profiles: [defaultProfile, { ...defaultProfile, name: "zain-tech-vp", model: "m2" }] }) },
      { hires },
    );
    const { agents } = await (await send("GET", "/api/roster")).json();
    expect(agents).toHaveLength(ROSTER.length + 1);
    const by = (p: string) => agents.find((a: { profile: string }) => a.profile === p);
    expect(by("default")).toMatchObject({ hired: true, model: "gpt-6-luna", rank: "ceo" });
    expect(by("zain-tech-vp")).toMatchObject({ hired: true, model: "m2" });
    expect(by("zain-tech-qa")).toMatchObject({ hired: false, model: null });
    expect(by("zain-tech-data")).toMatchObject({ hired: false, title: "Data Engineer" });
  });
});

describe("fileHireStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zain-hires-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("serializes concurrent saves without losing updates", async () => {
    const store = fileHireStore(dir);
    const base = { title: "T", division: "tech" as const, rank: "specialist" as const, reportsTo: "zain-tech-vp", skills: [] };
    await Promise.all(Array.from({ length: 12 }, (_, i) => store.save({ ...base, profile: `zain-tech-x${i}` })));
    const saved = JSON.parse(await readFile(join(dir, ".zain", "hires.json"), "utf8")) as { profile: string }[];
    expect(saved.map((h) => h.profile).sort()).toEqual(Array.from({ length: 12 }, (_, i) => `zain-tech-x${i}`).sort());
    expect((await readdir(join(dir, ".zain"))).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("persists non-ROSTER hires to .zain/hires.json and ignores ROSTER agents", async () => {
    const store = fileHireStore(dir);
    expect(await store.list()).toEqual([]);
    const extra = { profile: "zain-tech-data", title: "Data Engineer", division: "tech" as const, rank: "specialist" as const, reportsTo: "zain-tech-vp", skills: ["technology:api-design"] };
    await store.save(extra);
    await store.save({ ...extra, title: "Senior Data Engineer" });
    await store.save(ROSTER[1]!);
    const saved = JSON.parse(await readFile(join(dir, ".zain", "hires.json"), "utf8"));
    expect(saved).toEqual([{ ...extra, title: "Senior Data Engineer" }]);
    expect((await fullRoster(fileHireStore(dir))).at(-1)!.profile).toBe("zain-tech-data");
  });
});
