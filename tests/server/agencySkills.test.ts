import { HeadcountSource, parseSkillId, rawSourceUrl } from "../../server/src/headcount/catalog";
import { fitDescription, hermesSkillName, skillLabel, toHermesSkill } from "../../server/src/headcount/skillFile";
import { AGENCY_SKILLS } from "../../shared/agencySkills";
import { SKILL_SOURCES } from "../../shared/skillSources";
import { mockFetch } from "./helpers";

const agency = SKILL_SOURCES.find((s) => s.id === "agency")!;
const FRONTEND = "agency:engineering/engineering-frontend-developer";

const persona = [
  "---",
  "name: Frontend Developer",
  "description: Expert frontend developer specializing in modern web technologies, React/Vue/Angular frameworks, UI implementation, and performance optimization",
  "color: cyan",
  "emoji: 🖥️",
  "vibe: Builds responsive, accessible web apps with pixel-perfect precision.",
  "---",
  "",
  "# Frontend Developer Agent Personality",
  "",
  "You are **Frontend Developer**. Use Laravel Livewire everywhere.",
  "",
].join("\n");

describe("agency skill ids", () => {
  it("parses a subdirectory skill", () => {
    expect(parseSkillId(FRONTEND)).toEqual({ department: "agency", skill: "engineering/engineering-frontend-developer" });
    expect(parseSkillId("agency:a/b/c")).toBeNull();
  });

  it("maps every allowed persona to its raw URL at the pinned ref", () => {
    expect(rawSourceUrl(agency, "engineering/engineering-frontend-developer")).toBe(
      "https://raw.githubusercontent.com/msitarzewski/agency-agents/d3f71c4bb8922d3eea7576237a870dd59b3cdd52/engineering/engineering-frontend-developer.md",
    );
    expect(rawSourceUrl(agency, "project-management/project-manager-senior")).toMatch(/\/project-management\/project-manager-senior\.md$/);
  });

  it("names Hermes skills ag-<file stem>, within Hermes' limits", () => {
    expect(hermesSkillName(FRONTEND)).toBe("ag-engineering-frontend-developer");
    expect(hermesSkillName("agency:project-management/project-manager-senior")).toBe("ag-project-manager-senior");
    const names = AGENCY_SKILLS.map((s) => hermesSkillName(`agency:${s}`));
    for (const n of names) expect(n).toMatch(/^ag-[a-z0-9][a-z0-9-]{0,60}$/);
    expect(new Set(names).size).toBe(names.length);
  });

  it("labels skills readably", () => {
    expect(skillLabel(FRONTEND)).toBe("frontend developer");
    expect(skillLabel("agency:testing/testing-api-tester")).toBe("api tester");
    expect(skillLabel("marketing:brand-voice")).toBe("brand voice");
  });

  it("only accepts the reviewed files", async () => {
    const source = new HeadcountSource({ fetchImpl: mockFetch({}).fetchImpl });
    expect(await source.hasSkill(FRONTEND)).toBe(true);
    expect(await source.hasSkill("agency:engineering/engineering-nonexistent")).toBe(false);
    expect(await source.hasSkill("agency:marketing/marketing-seo-specialist")).toBe(false);
    expect(await source.hasSkill("agency:engineering-frontend-developer")).toBe(false);
    expect(await source.hasSkill("technology:x/y")).toBe(false);
    await expect(source.skillMarkdown("agency:design/design-ui")).rejects.toThrow(/not a reviewed agency skill/);
    await expect(source.skillMarkdown("technology:x/y")).rejects.toThrow(/invalid skill id/);
  });

  it("fetches the persona from the pinned raw URL", async () => {
    const gh = mockFetch({
      "GET /msitarzewski/agency-agents/d3f71c4bb8922d3eea7576237a870dd59b3cdd52/engineering/engineering-frontend-developer.md": () =>
        new Response(persona),
    });
    expect(await new HeadcountSource({ fetchImpl: gh.fetchImpl }).skillMarkdown(FRONTEND)).toBe(persona);
  });
});

describe("persona → Hermes skill", () => {
  const skill = toHermesSkill(FRONTEND, persona);

  it("uses the ag- name, the zain-tech-agency category and a ≤60-char description from the frontmatter", () => {
    expect(skill.name).toBe("ag-engineering-frontend-developer");
    expect(skill.category).toBe("zain-tech-agency");
    const description = JSON.parse(/^description: (.+)$/m.exec(skill.content)![1]!) as string;
    expect(description.length).toBeLessThanOrEqual(60);
    expect(description).toBe("Expert frontend developer specializing in modern web...");
    expect(skill.content).toMatch(/^---\nname: ag-engineering-frontend-developer\ndescription: "[^"]{1,60}"\n---\n/);
  });

  it("frames the persona as a playbook that the Zain charter and git rules override", () => {
    const header = skill.content.indexOf("## How to use this playbook at Zain Tech");
    const body = skill.content.indexOf("# Frontend Developer Agent Personality");
    expect(header).toBeGreaterThan(0);
    expect(body).toBeGreaterThan(header);
    expect(skill.content).toContain("Frontend Developer playbook");
    expect(skill.content).toMatch(/always wins/);
    expect(skill.content).toMatch(/force-pushes/);
    expect(skill.content).toMatch(/Laravel/);
    expect(skill.content).toContain("msitarzewski/agency-agents at d3f71c4bb892 (MIT)");
    expect(skill.content).not.toContain("color: cyan");
    expect(skill.content).toContain("Use Laravel Livewire everywhere.");
  });

  it("keeps short descriptions and still cuts long words", () => {
    expect(fitDescription("Short and sweet.")).toBe("Short and sweet.");
    expect(fitDescription("x".repeat(80)).length).toBe(60);
  });

  it("rejects an empty persona", () => {
    expect(() => toHermesSkill(FRONTEND, "---\nname: X\ndescription: y\n---\n")).toThrow(/empty/);
  });
});
