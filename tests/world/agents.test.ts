import { DIVISION_IDS } from "../../shared/divisions";
import { CEO_PROFILE, COO_PROFILE, ROSTER, agentsInDivision, managerOf } from "../../shared/roster";
import { appearanceFor } from "../../src/world/appearance";
import { diffAgents } from "../../src/world/diff";
import { floorLayout } from "../../src/world/layouts";
import { assignSeats } from "../../src/world/seating";
import type { WorldAgent } from "../../src/world/types";

const worldAgent = (profile: string, over: Partial<WorldAgent> = {}): WorldAgent => {
  const r = ROSTER.find((a) => a.profile === profile);
  return {
    profile,
    title: r?.title ?? "New Hire",
    division: r?.division ?? "studio",
    rank: r?.rank ?? "specialist",
    activity: "idle",
    hired: true,
    ...over,
  };
};

describe("seat assignment", () => {
  it.each(DIVISION_IDS.map((d) => [d]))("puts the %s manager in the manager seat and seats everyone", (division) => {
    const layout = floorLayout(division);
    const agents = agentsInDivision(division);
    const { seats, overflow } = assignSeats(layout, agents);
    expect(overflow).toEqual([]);
    expect(seats.get(managerOf(division).profile)?.role).toBe("manager");
    expect(new Set([...seats.values()].map((s) => s.id)).size).toBe(agents.length);
  });

  it("gives the CEO the CEO office and the COO the manager seat", () => {
    const { seats } = assignSeats(floorLayout("hq"), agentsInDivision("hq"));
    expect(seats.get(CEO_PROFILE)?.room).toBe("ceo");
    expect(seats.get(COO_PROFILE)?.room).toBe("coo");
    expect(seats.get("zain-hq-legal")?.room).toBe("legal");
    expect(seats.get("zain-hq-finance")?.room).toBe("finance");
  });

  it("is deterministic regardless of input order", () => {
    const layout = floorLayout("growth");
    const agents = agentsInDivision("growth");
    const a = assignSeats(layout, agents);
    const b = assignSeats(layout, [...agents].reverse());
    for (const ag of agents) expect(a.seats.get(ag.profile)?.id).toBe(b.seats.get(ag.profile)?.id);
  });

  it("sends agents beyond capacity to the lounge", () => {
    const layout = floorLayout("tech");
    const many = Array.from({ length: layout.seats.length + 3 }, (_, i) => ({
      profile: `hire-${String(i).padStart(2, "0")}`,
      rank: "specialist" as const,
    }));
    const { seats, overflow } = assignSeats(layout, many);
    expect(overflow).toHaveLength(4);
    expect(seats.size).toBe(layout.seats.length - 1);
  });
});

describe("appearance", () => {
  it("is deterministic per profile", () => {
    expect(appearanceFor("zain-tech-ai", "tech", "specialist")).toEqual(appearanceFor("zain-tech-ai", "tech", "specialist"));
  });

  it("varies across the roster", () => {
    const looks = new Set(ROSTER.map((a) => JSON.stringify(appearanceFor(a.profile, a.division, a.rank))));
    expect(looks.size).toBe(ROSTER.length);
    const styles = new Set(ROSTER.map((a) => appearanceFor(a.profile, a.division, a.rank).hairStyle));
    expect(styles.size).toBeGreaterThan(3);
  });

  it("dresses VPs in suits and the CEO in gold", () => {
    expect(appearanceFor("zain-labs-vp", "labs", "vp").outfit).toBe("suit");
    const ceo = appearanceFor(CEO_PROFILE, "hq", "ceo");
    expect(ceo.outfit).toBe("ceo");
    expect(ceo.tie).toBe(0xf2c230);
    expect(appearanceFor("zain-studio-copy", "studio", "specialist").shirt).toBe(0xe0567a);
  });
});

describe("agent diffing", () => {
  const prev = new Map([
    ["a", worldAgent("zain-tech-ai", { profile: "a" })],
    ["b", worldAgent("zain-tech-qa", { profile: "b" })],
    ["c", worldAgent("zain-tech-vp", { profile: "c" })],
  ]);

  it("reports added, updated and removed agents", () => {
    const next = [
      worldAgent("zain-tech-ai", { profile: "a" }),
      worldAgent("zain-tech-qa", { profile: "b", activity: "working" }),
      worldAgent("zain-tech-devops", { profile: "d" }),
    ];
    const d = diffAgents(prev, next);
    expect(d.added.map((a) => a.profile)).toEqual(["d"]);
    expect(d.updated.map((a) => a.profile)).toEqual(["b"]);
    expect(d.removed).toEqual(["c"]);
  });

  it("detects bubble and hired changes and ignores identical data", () => {
    expect(diffAgents(prev, [...prev.values()])).toEqual({ added: [], updated: [], removed: [] });
    const d = diffAgents(prev, [{ ...prev.get("a")!, bubble: "Draft brief" }, { ...prev.get("b")!, hired: false }, prev.get("c")!]);
    expect(d.updated.map((a) => a.profile)).toEqual(["a", "b"]);
  });

  it("drops invalid and duplicate entries", () => {
    const d = diffAgents(new Map(), [
      worldAgent("zain-tech-ai"),
      worldAgent("zain-tech-ai", { activity: "working" }),
      { profile: "x", division: "mars" },
      null,
    ]);
    expect(d.added).toHaveLength(1);
    expect(d.added[0]!.activity).toBe("idle");
  });
});
