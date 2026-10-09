import { HeadcountSource } from "../../server/src/headcount/catalog";
import type { SkillFileSink } from "../../server/src/headcount/install";
import { hermesSkillName } from "../../server/src/headcount/skillFile";
import { HermesClient } from "../../server/src/hermes/client";
import { memoryHireStore } from "../../server/src/org/hireStore";
import { soulFor, withMarketingBlock } from "../../server/src/org/persona";
import { describePlan, planSkillSync, syncSkills } from "../../server/src/org/skillSync";
import { CLAUDE_LANE, ROSTER, findAgent, isExternal } from "../../shared/roster";
import { SKILL_SOURCES } from "../../shared/skillSources";
import { githubFetch, hermesBase, json, mockFetch, type Call } from "./helpers";

const mk = SKILL_SOURCES.find((s) => s.id === "mk")!;
const SKILLS_ROOT = "/home/zain/.hermes/profiles";

/** A Hermes with a few hired profiles, their skills and SOULs; POST /api/skills behaves like Hermes. */
function fakeHermes(installed: Record<string, string[]>, souls: Record<string, string> = {}, failSkill?: string) {
  const skills = new Map(Object.entries(installed).map(([p, names]) => [p, new Set(names)]));
  const soul = new Map(Object.entries(souls));
  const descriptions = new Map<string, string>();
  const routes = {
    ...hermesBase,
    "GET /api/profiles": () => ({
      profiles: [...skills.keys()].map((name) => ({
        name, is_default: name === "default", model: "m", provider: "p", description: descriptions.get(name) ?? "", skill_count: 1,
      })),
    }),
    "GET /api/skills": (call: Call) => [...(skills.get(call.query.get("profile")!) ?? [])].map((name) => ({ name, enabled: true })),
    "POST /api/skills": (call: Call) => {
      const body = call.body as { name: string; profile: string };
      if (body.name === failSkill) return json({ detail: "disk full" }, 500);
      const set = skills.get(body.profile)!;
      if (set.has(body.name)) return json({ detail: `A skill named '${body.name}' already exists at x.` }, 400);
      set.add(body.name);
      return { success: true };
    },
    "GET /api/skills/content": (call: Call) => ({
      path: `${SKILLS_ROOT}/${call.query.get("profile")}/skills/zain-marketing/${call.query.get("name")}/SKILL.md`,
    }),
    ...Object.fromEntries(
      [...skills.keys()].flatMap((p) => [
        [`GET /api/profiles/${p}/soul`, () => ({ content: soul.get(p) ?? "" })],
        [`PUT /api/profiles/${p}/soul`, (call: Call) => {
          soul.set(p, (call.body as { content: string }).content);
          return { ok: true };
        }],
        [`PUT /api/profiles/${p}/description`, (call: Call) => {
          descriptions.set(p, (call.body as { description: string }).description);
          return { ok: true };
        }],
      ]),
    ),
  };
  const fetch = mockFetch(routes);
  return { hermes: new HermesClient({ baseUrl: "http://127.0.0.1:9119", fetchImpl: fetch.fetchImpl }), fetch, skills, soul };
}

/** GitHub with the headcount and source SKILL.md files, plus the marketingskills tree and two reference files. */
function github() {
  const base = githubFetch();
  const tree = [
    { path: "skills/ads/SKILL.md", type: "blob" },
    { path: "skills/ads/references/audit-guardrails.md", type: "blob" },
    { path: "skills/ads/references/rsa-output-spec.md", type: "blob" },
    { path: "skills/ads/evals/evals.json", type: "blob" },
    { path: "skills/ads/references", type: "tree" },
    { path: "skills/ad-creative/assets/creative-review-template.html", type: "blob" },
  ];
  const extra = mockFetch({
    [`GET /repos/${mk.repo}/git/trees/${mk.ref}`]: () => ({ tree }),
    [`GET /${mk.repo}/${mk.ref}/skills/ads/references/audit-guardrails.md`]: () => new Response("# Guardrails"),
    [`GET /${mk.repo}/${mk.ref}/skills/ads/references/rsa-output-spec.md`]: () => new Response("# RSA spec"),
    [`GET /${mk.repo}/${mk.ref}/skills/ad-creative/assets/creative-review-template.html`]: () => new Response("<html></html>"),
  });
  const calls: string[] = [];
  const headcount = new HeadcountSource({
    fetchImpl: async (input, init) => {
      calls.push(new URL(input).pathname);
      const res = await extra.fetchImpl(input, init);
      return res.status === 404 ? base.fetchImpl(input, init) : res;
    },
  });
  return { headcount, calls };
}

function memorySink() {
  const written = new Map<string, string>();
  const sink: SkillFileSink = {
    async write(skillMd, path, content) {
      const key = `${skillMd.replace(/SKILL\.md$/, "")}${path}`;
      if (written.has(key)) return false;
      written.set(key, content);
      return true;
    },
  };
  return { sink, written };
}

/** Hermes profiles on the roster: external agents (Claude's lane) are never synced. */
const PROFILES = ROSTER.filter((a) => !isExternal(a)).length;

const allNames = (profile: string) => findAgent(profile)!.skills.map(hermesSkillName);

describe("planSkillSync", () => {
  it("lists missing roster skills by Hermes name, and unhired profiles as needing a hire", async () => {
    const paid = findAgent("zain-growth-paid")!;
    const headcountOnly = paid.skills.filter((s) => !s.startsWith("mk:")).map(hermesSkillName);
    const { hermes, fetch } = fakeHermes({ "zain-growth-paid": [...headcountOnly, "some-default-skill"] });
    const plans = await planSkillSync({ hermes, hires: memoryHireStore() });

    expect(plans).toHaveLength(PROFILES);
    expect(plans.map((p) => p.profile)).not.toContain(CLAUDE_LANE);
    const plan = plans.find((p) => p.profile === "zain-growth-paid")!;
    expect(plan.missing).toEqual(["mk:ads", "mk:ad-creative", "mk:attribution", "mk:ab-testing"]);
    expect(describePlan(plan)).toMatch(/^zain-growth-paid \(Paid Ads Manager\): install 4 skill\(s\): mk-ads, mk-ad-creative, mk-attribution, mk-ab-testing; SOUL: add unit \/ marketing context; description: update$/);
    expect(describePlan(plans.find((p) => p.profile === "zain-growth-audit")!)).toBe("zain-growth-audit (Prospect Audit Lead): needs hire");
    expect(fetch.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("narrows to one profile and rejects one that is not on the roster", async () => {
    const { hermes } = fakeHermes({ "zain-growth-paid": [] });
    const plans = await planSkillSync({ hermes, hires: memoryHireStore(), profile: "zain-growth-paid" });
    expect(plans.map((p) => p.profile)).toEqual(["zain-growth-paid"]);
    await expect(planSkillSync({ hermes, hires: memoryHireStore(), profile: "zain-nobody" })).rejects.toThrow(/not on the roster/);
  });

  it("refuses to sync an external agent, even one that somehow has a Hermes profile", async () => {
    const { hermes, fetch } = fakeHermes({ [CLAUDE_LANE]: [] });
    await expect(planSkillSync({ hermes, hires: memoryHireStore(), profile: CLAUDE_LANE })).rejects.toThrow(/external agent/);
    expect((await planSkillSync({ hermes, hires: memoryHireStore() })).map((p) => p.profile)).not.toContain(CLAUDE_LANE);
    expect(fetch.calls.some((c) => c.path.includes(CLAUDE_LANE) || c.query.get("profile") === CLAUDE_LANE)).toBe(false);
  });

  it("never touches the CEO's SOUL or description", async () => {
    const { hermes } = fakeHermes({ default: [] }, { default: "# Susu" });
    const [plan] = await planSkillSync({ hermes, hires: memoryHireStore(), profile: "default" });
    expect(plan).toMatchObject({ hired: true, missing: findAgent("default")!.skills });
    expect(plan!.soul).toBeUndefined();
    expect(plan!.description).toBeUndefined();
  });
});

describe("syncSkills", () => {
  it("dry run prints the plan and writes nothing", async () => {
    const lines: string[] = [];
    const { hermes, fetch } = fakeHermes({ "zain-growth-seo": [] });
    const { headcount } = github();
    expect(await syncSkills({ hermes, headcount, hires: memoryHireStore(), apply: false, log: (l) => lines.push(l) })).toBe(0);
    expect(fetch.calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect(lines.find((l) => l.startsWith("zain-growth-seo"))).toMatch(/install 11 skill\(s\)/);
    expect(lines.at(-1)).toBe(`${PROFILES} profile(s): 1 to update, ${PROFILES - 1} need a hire.`);
  });

  it("applies like hiring: same names and category, references next to SKILL.md, then the SOUL block; a re-run is a no-op", async () => {
    const lines: string[] = [];
    const handWritten = "# Paid Ads Manager\n\n## Identity\n\nHand-written by the founder.\n";
    const { hermes, fetch, skills, soul } = fakeHermes({ "zain-growth-paid": ["hc-demand-generation-paid-advertising"] }, { "zain-growth-paid": handWritten });
    const { headcount } = github();
    const { sink, written } = memorySink();
    const opts = { hermes, headcount, hires: memoryHireStore(), apply: true, files: sink, profile: "zain-growth-paid", log: (l: string) => lines.push(l) };

    expect(await syncSkills(opts)).toBe(0);
    const posted = fetch.called("POST /api/skills").map((c) => c.body as { name: string; category: string; profile: string; content: string });
    expect(posted.map((b) => b.name)).toEqual(["hc-demand-generation-experimentation", "mk-ads", "mk-ad-creative", "mk-attribution", "mk-ab-testing"]);
    expect(posted.find((b) => b.name === "mk-ads")).toMatchObject({ category: "zain-marketing", profile: "zain-growth-paid" });
    expect(posted.find((b) => b.name === "mk-ads")!.content).toContain("~/ZainGroup/product-marketing.md");
    expect([...skills.get("zain-growth-paid")!].sort()).toEqual([...allNames("zain-growth-paid")].sort());
    expect([...written.keys()].sort()).toEqual([
      `${SKILLS_ROOT}/zain-growth-paid/skills/zain-marketing/mk-ad-creative/assets/creative-review-template.html`,
      `${SKILLS_ROOT}/zain-growth-paid/skills/zain-marketing/mk-ads/references/audit-guardrails.md`,
      `${SKILLS_ROOT}/zain-growth-paid/skills/zain-marketing/mk-ads/references/rsa-output-spec.md`,
    ]);
    expect(lines).toContain("  ok mk-ads <- mk:ads (2 reference file(s))");

    const next = soul.get("zain-growth-paid")!;
    expect(next.startsWith(handWritten.trimEnd())).toBe(true);
    expect(next).toContain("You work in the Performance unit of Zain Growth");
    expect(next).toContain("Zain's product marketing context is at `~/ZainGroup/product-marketing.md`; read it before marketing work.");

    lines.length = 0;
    const before = fetch.calls.length;
    expect(await syncSkills(opts)).toBe(0);
    expect(lines[0]).toBe("zain-growth-paid (Paid Ads Manager): up to date");
    expect(fetch.calls.slice(before).filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("never removes skills the roster does not list", async () => {
    const { hermes, fetch, skills } = fakeHermes({ "zain-growth-cro": ["custom-skill", ...allNames("zain-growth-cro")] });
    const { headcount } = github();
    await syncSkills({ hermes, headcount, hires: memoryHireStore(), apply: true, profile: "zain-growth-cro", log: () => undefined });
    expect(skills.get("zain-growth-cro")!.has("custom-skill")).toBe(true);
    expect(fetch.calls.filter((c) => c.method === "DELETE" || c.method === "POST")).toEqual([]);
  });

  it("counts a failed install and carries on with the rest", async () => {
    const lines: string[] = [];
    const { hermes } = fakeHermes({ "zain-growth-outbound": [] }, {}, "mk-cold-email");
    const { headcount } = github();
    const failed = await syncSkills({ hermes, headcount, hires: memoryHireStore(), apply: true, profile: "zain-growth-outbound", log: (l) => lines.push(l) });
    expect(failed).toBe(1);
    expect(lines).toContain("  FAILED mk-cold-email <- mk:cold-email: disk full");
    expect(lines).toContain("  ok mk-co-marketing <- mk:co-marketing");
  });
});

describe("syncSkills when Hermes fails for one profile", () => {
  it("reports that profile and still plans the rest", async () => {
    const lines: string[] = [];
    const { hermes } = fakeHermes({ "zain-growth-seo": [], "zain-growth-cro": [] });
    const listSkills = hermes.listSkills.bind(hermes);
    hermes.listSkills = async (p: string) => {
      if (p === "zain-growth-seo") throw new Error("Hermes unreachable at http://127.0.0.1:9119 (TimeoutError)");
      return listSkills(p);
    };
    const { headcount } = github();
    const failed = await syncSkills({ hermes, headcount, hires: memoryHireStore(), apply: false, log: (l) => lines.push(l) });
    expect(failed).toBe(1);
    expect(lines).toContain("zain-growth-seo (SEO & AI Search): FAILED to read from Hermes: Hermes unreachable at http://127.0.0.1:9119 (TimeoutError)");
    expect(lines.find((l) => l.startsWith("zain-growth-cro"))).toMatch(/install 10 skill\(s\)/);
  });
});

describe("withMarketingBlock", () => {
  const paid = findAgent("zain-growth-paid")!;

  it("is a no-op for a SOUL written with the sections and for roles without them", () => {
    const fresh = soulFor(paid, ROSTER);
    expect(withMarketingBlock(fresh, paid)).toBe(fresh);
    const coo = findAgent("zain-hq-coo")!;
    expect(withMarketingBlock("# COO\n", coo)).toBe("# COO\n");
  });

  it("replaces its own block in place, keeping the text around it", () => {
    const once = withMarketingBlock("# Paid\n\nIdentity.\n", paid);
    const edited = `${once.replace("Performance unit", "Old unit")}\n## Later notes\n\nKeep me.\n`;
    const again = withMarketingBlock(edited, paid);
    expect(again).toContain("Performance unit");
    expect(again).not.toContain("Old unit");
    expect(again).toContain("Keep me.");
    expect(again.match(/zain-hq:marketing -->/g)).toHaveLength(2);
  });
});
