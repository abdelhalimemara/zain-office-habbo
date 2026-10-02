import { existsSync, readdirSync } from "node:fs";
import { hermesSkillName } from "../../server/src/headcount/skillFile";
import { MAX_SKILLS, SKILL_ID_PATTERN } from "../../shared/hireRules";
import { ROSTER, agentsInDivision, findAgent } from "../../shared/roster";
import { SKILL_SOURCES, skillSourceFor, sourceSkillIds } from "../../shared/skillSources";
import { DIVISION_UNITS, findUnit, unitsOf } from "../../shared/units";

const mk = SKILL_SOURCES.find((s) => s.id === "mk")!;
const CLONE = "/tmp/mskills/skills";
const NEW_HIRES = ["zain-growth-audit", "zain-growth-outbound", "zain-studio-social", "zain-studio-content"];

describe("marketingskills source", () => {
  it("is pinned to a full commit with the repo's licence, prefix and category", () => {
    expect(mk).toMatchObject({ repo: "coreyhaines31/marketingskills", hermesPrefix: "mk", category: "zain-marketing", license: "MIT" });
    expect(mk.ref).toMatch(/^[0-9a-f]{40}$/);
    expect(mk.skillPath("seo-audit")).toBe("skills/seo-audit/SKILL.md");
    expect(mk.skillDir?.("seo-audit")).toBe("skills/seo-audit");
  });

  it("lists all 50 skills once, with valid ids and Hermes names", () => {
    expect(mk.skills).toHaveLength(50);
    expect(new Set(mk.skills).size).toBe(50);
    const ids = sourceSkillIds(mk);
    for (const id of ids) {
      expect(id).toMatch(SKILL_ID_PATTERN);
      expect(skillSourceFor(id)).toBe(mk);
      expect(hermesSkillName(id)).toMatch(/^mk-[a-z0-9-]+$/);
    }
    expect(new Set(ids.map(hermesSkillName)).size).toBe(50);
  });

  it("does not capture the headcount marketing department", () => {
    expect(skillSourceFor("marketing:brand-voice")).toBeUndefined();
    expect(SKILL_SOURCES.map((s) => s.id)).not.toContain("marketing");
  });

  it.skipIf(!existsSync(CLONE))("matches the skills in the reviewed clone", () => {
    const upstream = readdirSync(CLONE, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    expect([...mk.skills].sort()).toEqual(upstream);
    for (const skill of mk.skills) expect(existsSync(`${CLONE}/${skill}/SKILL.md`), skill).toBe(true);
  });
});

describe("Growth and Studio units", () => {
  it("defines Performance and Growth for Zain Growth, Creative, Organic and Design for Zain Studio", () => {
    expect(unitsOf("growth").map((u) => u.name)).toEqual(["Performance", "Growth"]);
    expect(unitsOf("studio").map((u) => u.name)).toEqual(["Creative", "Organic", "Design"]);
    expect(new Set(DIVISION_UNITS.map((u) => u.id)).size).toBe(DIVISION_UNITS.length);
  });

  it("puts every Growth and Studio specialist in a unit of their own division, and no VP in one", () => {
    for (const division of ["growth", "studio"] as const) {
      for (const agent of agentsInDivision(division)) {
        if (agent.rank === "vp") expect(agent.unit, agent.profile).toBeUndefined();
        else expect(findUnit(agent.unit)?.division, agent.profile).toBe(division);
      }
    }
    for (const agent of ROSTER.filter((a) => a.division !== "growth" && a.division !== "studio")) expect(agent.unit).toBeUndefined();
  });

  it("places each role in the unit the founder asked for", () => {
    const unitOf = (p: string) => findAgent(p)?.unit;
    expect(["zain-growth-paid", "zain-growth-cro", "zain-growth-analyst"].map(unitOf)).toEqual(["performance", "performance", "performance"]);
    expect(["zain-growth-seo", "zain-growth-lifecycle", "zain-growth-campaigns", "zain-growth-audit", "zain-growth-outbound"].map(unitOf)).toEqual(
      Array(5).fill("growth"),
    );
    expect(["zain-studio-art", "zain-studio-video", "zain-studio-copy"].map(unitOf)).toEqual(Array(3).fill("creative"));
    expect(["zain-studio-social", "zain-studio-content"].map(unitOf)).toEqual(["organic", "organic"]);
    expect(["zain-studio-brand", "zain-studio-ux"].map(unitOf)).toEqual(["design", "design"]);
  });
});

describe("marketing roster", () => {
  it("uses only reviewed marketingskills ids, within the hire limit", () => {
    for (const agent of ROSTER) {
      expect(agent.skills.length, agent.profile).toBeLessThanOrEqual(MAX_SKILLS);
      expect(new Set(agent.skills).size, agent.profile).toBe(agent.skills.length);
      for (const id of agent.skills.filter((s) => s.startsWith("mk:"))) expect(mk.skills, `${agent.profile} ${id}`).toContain(id.slice(3));
    }
  });

  it("keeps the existing headcount skills and adds the marketing ones", () => {
    const vp = findAgent("zain-growth-vp")!;
    expect(vp.skills).toEqual(expect.arrayContaining(["marketing:chief-marketing-officer", "mk:marketing-plan", "mk:revops"]));
    expect(findAgent("zain-studio-vp")!.skills).toEqual(
      expect.arrayContaining(["marketing:chief-content-officer", "mk:product-marketing", "mk:marketing-plan"]),
    );
    expect(findAgent("zain-growth-cro")!.skills.filter((s) => s.startsWith("mk:"))).toHaveLength(8);
  });

  it("hires the four new specialists under their VP with their names", () => {
    const expected: Record<string, [string, string, string]> = {
      "zain-growth-audit": ["Rami Saleh", "Prospect Audit Lead", "zain-growth-vp"],
      "zain-growth-outbound": ["Hadi Nasser", "Outbound & Partnerships", "zain-growth-vp"],
      "zain-studio-social": ["Dana Al-Shammari", "Organic Social Lead", "zain-studio-vp"],
      "zain-studio-content": ["Karim Mansour", "Content & PR Lead", "zain-studio-vp"],
    };
    for (const profile of NEW_HIRES) {
      const a = findAgent(profile)!;
      expect([a.name, a.title, a.reportsTo]).toEqual(expected[profile]);
      expect(a.rank).toBe("specialist");
    }
    expect(findAgent("zain-growth-audit")!.skills).toEqual(
      ["seo-audit", "competitors", "competitor-profiling", "ads", "analytics", "prospecting"].map((s) => `mk:${s}`),
    );
  });

  it("keeps profiles and person names unique", () => {
    const profiles = ROSTER.map((a) => a.profile);
    expect(new Set(profiles).size).toBe(profiles.length);
    const names = ROSTER.flatMap((a) => (a.name ? [a.name] : []));
    expect(new Set(names).size).toBe(names.length);
  });

  it("leaves client email to Ahmad", () => {
    expect(ROSTER.filter((a) => a.clientChannels?.length).map((a) => a.profile)).toEqual(["zain-hq-accounts"]);
    expect(findAgent("zain-growth-outbound")!.focus).toMatch(/Ahmad \(zain-hq-accounts\) sends every client and prospect email/);
  });
});
