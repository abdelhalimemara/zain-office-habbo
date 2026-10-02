import { ROSTER } from "../../shared/roster";
import { diffAgents } from "../../src/world/diff";
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
