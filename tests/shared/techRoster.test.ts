import { AGENCY_SKILLS } from "../../shared/agencySkills";
import { PROFILE_PATTERN, SKILL_ID_PATTERN, TITLE_MAX } from "../../shared/hireRules";
import { ROSTER, findAgent, managerOf } from "../../shared/roster";
import { SKILL_SOURCES, skillSourceFor } from "../../shared/skillSources";
import { TECH_TEAM_ROSTER, TECH_VP } from "../../shared/techRoster";
import { REPO_PATTERN, TECH_TEAMS, teamCharterTitle, teamCheckout } from "../../shared/techTeams";

const agency = SKILL_SOURCES.find((s) => s.id === "agency")!;

describe("agency skill source", () => {
  it("is pinned, MIT, prefixed ag and filed under zain-tech-agency", () => {
    expect(agency).toMatchObject({
      repo: "msitarzewski/agency-agents",
      ref: "d3f71c4bb8922d3eea7576237a870dd59b3cdd52",
      hermesPrefix: "ag",
      category: "zain-tech-agency",
      license: "MIT",
      format: "persona",
    });
  });

  it("allows exactly the engineering, project-management and testing personas", () => {
    expect(AGENCY_SKILLS).toHaveLength(81);
    expect(new Set(AGENCY_SKILLS).size).toBe(81);
    for (const s of AGENCY_SKILLS) expect(s).toMatch(/^(engineering|project-management|testing)\/[a-z0-9-]+$/);
    expect(AGENCY_SKILLS.filter((s) => s.startsWith("project-management/"))).toHaveLength(7);
    expect(AGENCY_SKILLS.filter((s) => s.startsWith("testing/"))).toHaveLength(9);
    expect(AGENCY_SKILLS).toContain("project-management/project-manager-senior");
  });

  it("maps subdirectory ids to the persona file", () => {
    expect(agency.skillPath("engineering/engineering-frontend-developer")).toBe("engineering/engineering-frontend-developer.md");
    expect(skillSourceFor("agency:testing/testing-api-tester")).toBe(agency);
  });

  it("accepts one subdirectory in skill ids and nothing deeper", () => {
    expect(SKILL_ID_PATTERN.test("agency:engineering/engineering-sre")).toBe(true);
    expect(SKILL_ID_PATTERN.test("marketing:brand-voice")).toBe(true);
    for (const bad of ["agency:a/b/c", "agency:../x", "agency:/x", "agency:x/", "agency:Engineering/x"]) {
      expect(SKILL_ID_PATTERN.test(bad)).toBe(false);
    }
  });
});

describe("Zain Tech repo teams", () => {
  it("is part of ROSTER, all in tech, with known agency skills", () => {
    for (const a of TECH_TEAM_ROSTER) {
      expect(findAgent(a.profile)).toBe(a);
      expect(a.division).toBe("tech");
      for (const id of a.skills) {
        expect(id.startsWith("agency:")).toBe(true);
        expect(AGENCY_SKILLS).toContain(id.slice("agency:".length));
      }
    }
  });

  it.each(TECH_TEAMS.map((t) => [t.id, t] as const))("%s has one Head Engineer, one PM and 3–5 specialists under the HE", (_id, team) => {
    const crew = ROSTER.filter((a) => a.team === team.id);
    const heads = crew.filter((a) => a.teamRole === "head-engineer");
    const pms = crew.filter((a) => a.teamRole === "project-manager");
    const specialists = crew.filter((a) => a.teamRole === "specialist");
    expect(heads).toHaveLength(1);
    expect(pms).toHaveLength(1);
    expect(specialists.length).toBeGreaterThanOrEqual(3);
    expect(specialists.length).toBeLessThanOrEqual(5);
    expect(crew).toHaveLength(2 + specialists.length);
    for (const lead of [...heads, ...pms]) {
      expect(lead).toMatchObject({ rank: "lead", reportsTo: TECH_VP });
    }
    for (const s of specialists) expect(s).toMatchObject({ rank: "specialist", reportsTo: heads[0]!.profile });
    expect(heads[0]!.title).toBe(`${team.name} · Head Engineer`);
    expect(pms[0]!.title).toBe(`${team.name} · Project Manager`);
    expect(REPO_PATTERN.test(team.repo)).toBe(true);
  });

  it("uses valid profiles, titles, focus lines and the agency playbooks for each lead", () => {
    for (const a of TECH_TEAM_ROSTER) {
      expect(a.profile).toMatch(PROFILE_PATTERN);
      expect(a.profile.startsWith(`zain-tech-${a.team}-`)).toBe(true);
      expect(a.title.length).toBeLessThanOrEqual(TITLE_MAX);
      expect(a.title.startsWith(`${TECH_TEAMS.find((t) => t.id === a.team)!.name} · `)).toBe(true);
      expect(a.focus?.length ?? 0).toBeGreaterThan(10);
    }
    const head = findAgent("zain-tech-storelens-head")!;
    expect(head.skills).toEqual(expect.arrayContaining([
      "agency:engineering/engineering-software-architect",
      "agency:engineering/engineering-code-reviewer",
      "agency:engineering/engineering-git-workflow-master",
    ]));
    expect(findAgent("zain-tech-storelens-pm")!.skills).toContain("agency:project-management/project-manager-senior");
  });

  it("keeps the shared platform specialists on the VP with no team, and one tech manager", () => {
    for (const p of ["zain-tech-fullstack", "zain-tech-ai", "zain-tech-devops", "zain-tech-qa", "zain-tech-security"]) {
      expect(findAgent(p)).toMatchObject({ reportsTo: TECH_VP, rank: "specialist" });
      expect(findAgent(p)!.team).toBeUndefined();
    }
    expect(managerOf("tech").profile).toBe(TECH_VP);
  });

  it("names charter tasks and checkouts", () => {
    expect(teamCharterTitle(TECH_TEAMS[0]!)).toBe("StoreLens · Team charter & status");
    expect(teamCheckout({ id: "ppl-lab", repo: "abdelhalimemara/ppl-lab" })).toBe("~/ZainTech/ppl-lab/ppl-lab");
  });
});
