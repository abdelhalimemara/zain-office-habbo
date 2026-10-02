import { rosterOrFallback, toWorldAgents } from "../../src/app/worldModel";
import { NAMED_SPRITE_BY_PROFILE, spriteFor } from "../../src/world/characters";
import { diffAgents } from "../../src/world/diff";
import { floorPlan } from "../../src/world/plan";
import { assignSeats } from "../../src/world/seating";
import { agentsInDivision } from "../../shared/roster";
import { unitsOf } from "../../shared/units";

describe("Studio and Growth floors", () => {
  it.each([["growth"], ["studio"]] as const)("gives every %s specialist a desk in their unit's cluster", (division) => {
    const plan = floorPlan(division);
    const agents = toWorldAgents(rosterOrFallback(undefined), undefined).filter((a) => a.division === division);
    const { seats, overflow } = assignSeats(plan, agents);
    expect(overflow).toEqual([]);
    for (const a of agents.filter((x) => x.rank === "specialist")) {
      expect(a.unit, a.profile).toBeDefined();
      expect(seats.get(a.profile)?.team, a.profile).toBe(a.unit);
    }
  });

  it.each([["growth"], ["studio"]] as const)("labels each %s unit's cluster with a floor plate", (division) => {
    const plates = floorPlan(division).plates.map((p) => p.text);
    for (const u of unitsOf(division)) expect(plates).toContain(u.name.toUpperCase());
    const seatUnits = new Set(floorPlan(division).seats.flatMap((s) => (s.team ? [s.team] : [])));
    expect([...seatUnits].sort()).toEqual(unitsOf(division).map((u) => u.id).sort());
  });

  it("has room for each unit", () => {
    for (const division of ["growth", "studio"] as const) {
      const plan = floorPlan(division);
      for (const u of unitsOf(division)) {
        const members = agentsInDivision(division).filter((a) => a.unit === u.id).length;
        expect(plan.seats.filter((s) => s.team === u.id).length, u.id).toBeGreaterThanOrEqual(members);
      }
    }
  });

  it("carries the unit through to the world and treats a unit change as an update", () => {
    const world = toWorldAgents(rosterOrFallback(undefined), undefined);
    const rami = world.find((a) => a.profile === "zain-growth-audit")!;
    expect(rami).toMatchObject({ title: "Rami Saleh", unit: "growth" });
    const diff = diffAgents(new Map([[rami.profile, rami]]), [{ ...rami, unit: "performance" }]);
    expect(diff.updated.map((a) => a.unit)).toEqual(["performance"]);
    expect(diffAgents(new Map(), [{ ...rami, unit: 3 }]).added).toEqual([]);
  });
});

describe("new marketing hires' sprites", () => {
  const EXECS = ["default", "zain-hq-coo", "zain-hq-accounts", "zain-studio-vp", "zain-growth-vp", "zain-labs-vp", "zain-tech-vp"];

  it("are fixed, gender-consistent and distinct from the execs and Ahmad", () => {
    expect(spriteFor("zain-studio-social", "specialist")).toMatch(/^people\/female-/);
    for (const p of ["zain-studio-content", "zain-growth-audit", "zain-growth-outbound"]) expect(spriteFor(p, "specialist")).toMatch(/^people\/male-/);
    const execSprites = new Set(EXECS.map((p) => NAMED_SPRITE_BY_PROFILE[p]));
    const mine = ["zain-studio-social", "zain-studio-content", "zain-growth-audit", "zain-growth-outbound"].map((p) => NAMED_SPRITE_BY_PROFILE[p]);
    expect(new Set(mine).size).toBe(4);
    for (const s of mine) expect(execSprites.has(s)).toBe(false);
  });
});
