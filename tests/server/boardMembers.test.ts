import { HeadcountSource, rawSourceUrl } from "../../server/src/headcount/catalog";
import { hermesSkillName, toHermesSkill } from "../../server/src/headcount/skillFile";
import { boardDescription, boardSoul } from "../../server/src/org/boardPersona";
import { memoryHireStore } from "../../server/src/org/hireStore";
import { profileDescription, soulFor } from "../../server/src/org/persona";
import { refreshPersonas } from "../../server/src/org/refreshPersonas";
import { approvalsSection } from "../../server/src/telegram/ceoSoul";
import { BOARD_MEMBERS, findBoardMember } from "../../shared/board";
import { ROSTER, findAgent } from "../../shared/roster";
import { SKILL_SOURCES } from "../../shared/skillSources";
import { NO_BRIEFS, json, setup, type Handler } from "./helpers";

const hormozi = findBoardMember("zain-board-hormozi")!;
const source = SKILL_SOURCES.find((s) => s.id === "hormozi")!;

describe("registered skill sources", () => {
  it("installs hormozi skills from the pinned raw URL as hz-<skill> in the board category", async () => {
    const urls: string[] = [];
    const hc = new HeadcountSource({ fetchImpl: async (url) => (urls.push(url), new Response("---\nname: x\ndescription: y\n---\n\nBody")) });
    await hc.skillMarkdown("hormozi:pricing-strategy");
    expect(urls).toEqual([
      "https://raw.githubusercontent.com/alexsmedile/hormozi-skills/25ec2b0789ae8c760b45f577024782ff399983a6/skills/pricing-strategy/SKILL.md",
    ]);
    expect(rawSourceUrl(source, "audit-offer")).toContain(`/${source.ref}/skills/audit-offer/SKILL.md`);
    expect(hermesSkillName("hormozi:pricing-strategy")).toBe("hz-pricing-strategy");
    for (const id of hormozi.skills) expect(hermesSkillName(id)).toMatch(/^hz-[a-z0-9-]{1,61}$/);
  });

  it("rewrites the SKILL.md with a ≤60-char description, attribution and the source category", () => {
    const upstream = "---\nname: pricing-strategy\ndescription: Set the right price anchored to value, not guesswork. Use when pricing feels random.\n---\n\n# Pricing\n\nBody.";
    const skill = toHermesSkill("hormozi:pricing-strategy", upstream);
    expect(skill.name).toBe("hz-pricing-strategy");
    expect(skill.category).toBe("board-hormozi");
    const desc = JSON.parse(/^description: (.*)$/m.exec(skill.content)![1]!) as string;
    expect(desc.length).toBeLessThanOrEqual(60);
    expect(skill.content).toContain("github.com/alexsmedile/hormozi-skills at 25ec2b0789ae (MIT)");
    expect(skill.content).toContain("**When to use:** Set the right price");
    expect(toHermesSkill("marketing:brand-voice", upstream).category).toBe("headcount");
  });

  it("accepts only reviewed source skills and lists the source as a catalog department", async () => {
    const { headcount } = setup({});
    expect(await headcount.hasSkill("hormozi:pricing-strategy")).toBe(true);
    expect(await headcount.hasSkill("hormozi:create-plugin")).toBe(false);
    await expect(headcount.skillMarkdown("hormozi:create-plugin")).rejects.toThrow(/not a reviewed hormozi skill/);
    const { departments } = await headcount.catalog();
    expect(departments.filter((d) => d.id === "hormozi")).toEqual([{ id: "hormozi", skills: [...source.skills].sort() }]);
  });
});

describe("board persona", () => {
  const soul = boardSoul(hormozi);

  it("opens with the honest identity line, seat and lens", () => {
    expect(soul).toContain(
      "You are Alex Hormozi on the Zain Group board of advisors — an AI advisor modelled on Alex Hormozi's publicly shared thinking, frameworks and voice.",
    );
    expect(soul).toContain(`Seat: ${hormozi.seat}.`);
    for (const lens of hormozi.lens) expect(soul).toContain(`- ${lens}`);
    expect(soul).toMatch(/Vision 2030/);
    expect(soul).toMatch(/PDPL/);
    expect(soul).toContain("You advise; you do not run anything.");
  });

  it("defines the consultation intake and the answer format", () => {
    expect(soul).toContain('"Board consultation: …" on board `zain-group` (tenant `zain-hq`)');
    for (const part of ["**Bottom line**", "**Reasoning**", "**Risks**", "**Next actions**", "**Vote**"]) expect(soul).toContain(part);
    expect(soul).toContain("Approve / Approve with conditions / Reject");
    expect(soul).toContain("owner division, a metric and a timeframe");
    expect(soul).toContain("`kanban_complete`, with the full advice as the result");
    expect(soul).toMatch(/Block \(`needs_input`\) only if no useful advice is possible/);
  });

  it("sets hard limits and persona integrity", () => {
    expect(soul).toContain("Never `kanban_create` or assign work, and never approve or reject mandates.");
    expect(soul).toContain("Never contact anyone outside Zain, and never handle credentials.");
    expect(soul).toContain("never claim to be the real Alex Hormozi");
    expect(soul).toContain("never write content meant to be published under Alex Hormozi's name");
    expect(soul).toContain("say you are Zain's AI board advisor modelled on their public work");
    expect(soul).toMatch(/language of the question \(Arabic is fine\)/);
  });

  it("is what hire/refresh use for rank board, with a routing description", () => {
    const agent = findAgent("zain-board-hormozi")!;
    expect(soulFor(agent, ROSTER)).toBe(soul);
    expect(profileDescription(agent)).toBe("Zain board advisor · Alex Hormozi: Offers, pricing, sales and scaling service businesses");
    expect(boardDescription(hormozi)).toBe(profileDescription(agent));
  });

  it("keeps the board out of the COO's team list", () => {
    const coo = soulFor(findAgent("zain-hq-coo")!, ROSTER);
    expect(coo).not.toContain("zain-board-");
    for (const m of BOARD_MEMBERS) expect(coo).not.toContain(m.name);
  });
});

describe("hiring a board member", () => {
  const routes = (exists = false): Record<string, Handler> => ({
    "GET /api/profiles": () => ({ profiles: [{ name: "default" }, ...(exists ? [{ name: hormozi.profile }] : [])] }),
    "POST /api/profiles": () => ({ ok: true }),
    [`PUT /api/profiles/${hormozi.profile}/soul`]: () => ({ ok: true }),
    [`PUT /api/profiles/${hormozi.profile}/description`]: () => ({ ok: true }),
    "POST /api/skills": () => ({ success: true }),
  });
  const request = { profile: hormozi.profile, title: "Board · Alex Hormozi", division: "hq", rank: "board", reportsTo: null, skills: hormozi.skills };

  it("creates the profile, writes the board SOUL and installs all 17 source skills", async () => {
    const { send, hermesFetch, hires } = setup(routes());
    const body = await (await send("POST", "/api/hire", request)).json();
    expect(body.ok).toBe(true);
    expect(body.steps).toHaveLength(3 + 17);
    const soul = (hermesFetch.called(`PUT /api/profiles/${hormozi.profile}/soul`)[0]!.body as { content: string }).content;
    expect(soul).toBe(boardSoul(hormozi));
    const skills = hermesFetch.called("POST /api/skills").map((c) => c.body as { name: string; category: string; profile: string });
    expect(skills).toHaveLength(17);
    expect(skills.every((s) => s.category === "board-hormozi" && s.profile === hormozi.profile && s.name.startsWith("hz-"))).toBe(true);
    expect(await hires.list()).toEqual([]);
  });

  it.each([
    [{ reportsTo: "default" }, "reportsTo must be null"],
    [{ profile: "zain-board-buffett" }, "not a board seat"],
    [{ profile: "zain-hq-advisor" }, "zain-board-*"],
    [{ rank: "specialist", reportsTo: "zain-hq-coo" }, "rank board"],
    [{ title: "Board · Someone Else" }, "title must match the roster"],
  ])("rejects %j", async (patch, message) => {
    const { send, hermesFetch } = setup(routes());
    const res = await send("POST", "/api/hire", { ...request, ...patch });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(message);
    expect(hermesFetch.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("is idempotent for an existing board profile", async () => {
    const { send, hermesFetch } = setup({ ...routes(true), "POST /api/skills": () => json({ detail: "A skill named 'hz-x' already exists" }, 400) });
    expect((await (await send("POST", "/api/hire", { ...request, reportsTo: undefined })).json()).ok).toBe(true);
    expect(hermesFetch.called("POST /api/profiles")).toEqual([]);
  });
});

describe("refreshPersonas", () => {
  it("rewrites a hired board member's SOUL and description from the board persona", async () => {
    const { hermes, hermesFetch } = setup({
      "GET /api/profiles": () => ({ profiles: [{ name: "default" }, { name: hormozi.profile }] }),
      [`PUT /api/profiles/${hormozi.profile}/soul`]: () => ({ ok: true }),
      [`PUT /api/profiles/${hormozi.profile}/description`]: () => ({ ok: true }),
    });
    expect(await refreshPersonas({ hermes, hires: memoryHireStore(), briefs: NO_BRIEFS, apply: true, log: () => undefined })).toBe(0);
    expect((hermesFetch.called(`PUT /api/profiles/${hormozi.profile}/soul`)[0]!.body as { content: string }).content).toBe(boardSoul(hormozi));
    expect(hermesFetch.called(`PUT /api/profiles/${hormozi.profile}/description`)[0]!.body).toEqual({ description: boardDescription(hormozi) });
  });
});

describe("CEO approvals section: board consultations", () => {
  const text = approvalsSection(8787);
  it("relays completed consultations briefly and consults the board through Zain HQ", () => {
    expect(text).toContain("### Board consultations");
    expect(text).toContain('"Board consultation: …"');
    expect(text).toMatch(/≤8 lines — the advisor's name, the bottom line, the vote if any and the top 3 actions/);
    expect(text).toContain(
      `curl -sS -X POST http://127.0.0.1:8787/api/board/consult -H 'Content-Type: application/json' -d '{"question":"<their question>","members":["zain-board-hormozi"]}'`,
    );
    expect(text).toMatch(/Omit `members` to ask the whole board/);
    expect(text).toMatch(/never present their words as the real people's/);
  });
});
