import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRIEF_PRECEDENCE, boardDescription } from "../../server/src/org/boardPersona";
import { fileBriefs } from "../../server/src/org/privateBriefs";
import { BOARD_MEMBERS, findBoardMember } from "../../shared/board";
import { SKILL_ID_PATTERN } from "../../shared/hireRules";
import { ROSTER, findAgent } from "../../shared/roster";
import { skillSourceFor } from "../../shared/skillSources";
import { KANBAN, TELEGRAM_HOME, setup, task, type Handler } from "./helpers";

const SEATS = ["zain-board-hormozi", "zain-board-alwaleed", "zain-board-bezos", "zain-board-buffett", "zain-board-jobs"];
const NEW_SEATS = [
  { profile: "zain-board-bezos", name: "Jeff Bezos", title: "Board · Jeff Bezos", seat: "Customer obsession, invention and operating mechanisms" },
  { profile: "zain-board-buffett", name: "Warren Buffett", title: "Board · Warren Buffett", seat: "Business finance, capital allocation and owner economics" },
  { profile: "zain-board-jobs", name: "Steve Jobs", title: "Board · Steve Jobs", seat: "Product, brand, focus and craft" },
];
const PRIVATE = SEATS.filter((p) => findBoardMember(p)?.privateBrief);

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zain-seats-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const marker = (profile: string) => `FIXTURE-${profile}-c41d`;
async function fixtureBriefs(profiles: readonly string[]) {
  await mkdir(join(root, ".zain", "board"), { recursive: true });
  for (const p of profiles) await writeFile(join(root, ".zain", "board", `${p}.md`), `## Fixture\n\n${marker(p)}\n`, { mode: 0o600 });
  return fileBriefs(root);
}

function hireRoutes(profile: string): Record<string, Handler> {
  return {
    "GET /api/profiles": () => ({ profiles: [{ name: "default" }] }),
    "POST /api/profiles": () => ({ ok: true }),
    [`PUT /api/profiles/${profile}/soul`]: () => ({ ok: true }),
    [`PUT /api/profiles/${profile}/description`]: () => ({ ok: true }),
    "POST /api/skills": () => ({ success: true }),
    "GET /api/status": () => ({ gateway_platforms: {} }),
  };
}

const hireBody = (profile: string) => {
  const agent = findAgent(profile)!;
  return { profile, title: agent.title, division: "hq", rank: "board", reportsTo: null, skills: agent.skills };
};

describe("board seats", () => {
  it("are ordered as the board-room seats", () => {
    expect(BOARD_MEMBERS.map((m) => m.profile)).toEqual(SEATS);
    expect(ROSTER.filter((a) => a.rank === "board").map((a) => a.profile)).toEqual(SEATS);
  });

  it.each(NEW_SEATS)("$profile is an advisor seat with its title, seat and a private brief", ({ profile, name, title, seat }) => {
    const member = findBoardMember(profile)!;
    expect(member).toMatchObject({ name, title, seat, privateBrief: true });
    expect(findAgent(profile)).toMatchObject({ title, rank: "board", division: "hq", reportsTo: null });
    expect(member.lens.length).toBeGreaterThanOrEqual(4);
    expect(boardDescription(member)).toBe(`Zain board advisor · ${name}: ${seat}`);
  });

  it.each(SEATS)("%s has a title within 60 characters and valid skills", async (profile) => {
    const agent = findAgent(profile)!;
    expect(agent.title.length).toBeLessThanOrEqual(60);
    expect(agent.skills.length).toBeGreaterThan(0);
    const { headcount } = setup({});
    for (const id of agent.skills) {
      expect(id).toMatch(SKILL_ID_PATTERN);
      expect(await headcount.hasSkill(id)).toBe(true);
    }
  });

  it("uses headcount skills for every new seat", () => {
    for (const { profile } of NEW_SEATS) expect(findAgent(profile)!.skills.every((id) => !skillSourceFor(id))).toBe(true);
  });
});

describe("private-brief seats", () => {
  it.each(PRIVATE)("%s fails write-soul cleanly without a brief and writes no SOUL", async (profile) => {
    const { send, hermesFetch } = setup(hireRoutes(profile), { briefs: fileBriefs(root) });
    const body = await (await send("POST", "/api/hire", hireBody(profile))).json();
    expect(body.ok).toBe(false);
    expect(body.steps.find((s: { step: string }) => s.step === "write-soul")).toMatchObject({
      ok: false,
      error: `missing private brief .zain/board/${profile}.md`,
    });
    expect(hermesFetch.called(`PUT /api/profiles/${profile}/soul`)).toEqual([]);
    expect(body.steps.filter((s: { step: string; ok: boolean }) => s.step === "install-skill").every((s: { ok: boolean }) => s.ok)).toBe(true);
  });

  it.each(PRIVATE)("%s embeds its own brief only, and the brief never leaks into API responses", async (profile) => {
    const briefs = await fixtureBriefs(PRIVATE);
    const { send, hermesFetch } = setup(hireRoutes(profile), { briefs });
    const hireText = await (await send("POST", "/api/hire", hireBody(profile))).text();
    expect(JSON.parse(hireText).ok).toBe(true);
    const soul = (hermesFetch.called(`PUT /api/profiles/${profile}/soul`)[0]!.body as { content: string }).content;
    const name = findBoardMember(profile)!.name;
    expect(soul).toContain(`You are ${name} on the Zain Group board of advisors`);
    expect(soul).toContain(BRIEF_PRECEDENCE);
    expect(soul).toContain(marker(profile));
    for (const other of PRIVATE.filter((p) => p !== profile)) expect(soul).not.toContain(marker(other));
    const texts = [hireText, JSON.stringify(hermesFetch.called(`PUT /api/profiles/${profile}/description`)[0]!.body)];
    for (const path of ["/api/roster", "/api/headcount/catalog", "/api/health"]) texts.push(await (await send("GET", path)).text());
    for (const text of texts) for (const p of PRIVATE) expect(text).not.toContain(marker(p));
  });
});

describe("consulting the five-seat board", () => {
  function consultSetup(hired: readonly string[]) {
    let n = 0;
    return setup({
      "GET /api/profiles": () => ({ profiles: [{ name: "default" }, ...hired.map((name) => ({ name }))] }),
      [`POST ${KANBAN}/tasks`]: (c) => ({ task: task({ id: `t_b${++n}`, ...(c.body as object) }) }),
      [`GET ${KANBAN}/home-channels`]: () => ({ home_channels: [TELEGRAM_HOME] }),
    });
  }

  it("asks every hired seat in board order by default", async () => {
    const { send, hermesFetch, exec } = consultSetup([...SEATS].reverse());
    expect((await send("POST", "/api/board/consult", { question: "Enter Egypt next year?" })).status).toBe(201);
    expect(hermesFetch.called(`POST ${KANBAN}/tasks`).map((c) => (c.body as { assignee: string }).assignee)).toEqual(SEATS);
    expect(exec.calls).toHaveLength(5);
  });

  it("skips vacant seats by default", async () => {
    const { send, hermesFetch } = consultSetup(["zain-board-buffett", "zain-board-jobs"]);
    await send("POST", "/api/board/consult", { question: "Price the new retainer?" });
    expect(hermesFetch.called(`POST ${KANBAN}/tasks`).map((c) => (c.body as { assignee: string }).assignee)).toEqual([
      "zain-board-buffett",
      "zain-board-jobs",
    ]);
  });
});
