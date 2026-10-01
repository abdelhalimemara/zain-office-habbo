import { DIVISIONS, DIVISION_IDS } from "../../shared/divisions";
import { CEO_PROFILE, ROSTER, agentsInDivision, findAgent, managerOf } from "../../shared/roster";

describe("roster", () => {
  it("has unique profile names", () => {
    const names = ROSTER.map((a) => a.profile);
    expect(new Set(names).size).toBe(names.length);
  });

  it("uses Hermes-safe profile names", () => {
    for (const a of ROSTER) expect(a.profile).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("has exactly one CEO, the main Hermes default profile", () => {
    const ceos = ROSTER.filter((a) => a.rank === "ceo");
    expect(ceos.map((a) => a.profile)).toEqual([CEO_PROFILE]);
  });

  it("gives every division exactly one manager", () => {
    for (const id of DIVISION_IDS) {
      expect(agentsInDivision(id).filter((a) => a.rank === "vp")).toHaveLength(1);
      expect(managerOf(id).division).toBe(id);
    }
  });

  it("reports every non-CEO agent to an existing agent", () => {
    for (const a of ROSTER) {
      if (a.rank === "ceo" || a.rank === "board") {
        expect(a.reportsTo).toBeNull();
        continue;
      }
      expect(a.reportsTo && findAgent(a.reportsTo)).toBeTruthy();
    }
  });

  it("formats skills as department:skill", () => {
    for (const a of ROSTER) for (const s of a.skills) expect(s).toMatch(/^[a-z-]+:[a-z-]+$/);
  });

  it("covers every division with a distinct tenant", () => {
    expect(new Set(DIVISIONS.map((d) => d.tenant)).size).toBe(DIVISIONS.length);
  });
});
