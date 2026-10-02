import { TECH_TEAMS } from "../../shared/techTeams";
import { agentsInDivision } from "../../shared/roster";
import { floorPlan } from "../../src/world/plan";
import { fitBounds, planBounds, PERSON_H, MIN_PERSON_CSS } from "../../src/world/plan/boxes";
import { findPath, isWalkable, walkGrid } from "../../src/world/plan/grid";
import { podFor, teamZone } from "../../src/world/plan/pods";
import { POD_SLOTS } from "../../src/world/plan/tech";
import { assignSeats, podsForTeams, type SeatCandidate } from "../../src/world/seating";

const tech = floorPlan("tech");

/** A synthetic Tech roster: per team a Head Engineer, a PM and `n` specialists, plus the VP's platform specialists. */
function roster(extraTeams: string[] = [], perTeam = 4): SeatCandidate[] {
  const out: SeatCandidate[] = agentsInDivision("tech").map((a) => ({ profile: a.profile, rank: a.rank, title: a.title }));
  for (const team of [...TECH_TEAMS.map((t) => t.id), ...extraTeams]) {
    out.push({ profile: `zain-tech-${team}-pm`, rank: "lead", team, title: "Project Manager" });
    out.push({ profile: `zain-tech-${team}-head`, rank: "lead", team, title: "Head Engineer" });
    for (let i = 0; i < perTeam; i++) out.push({ profile: `zain-tech-${team}-dev${i}`, rank: "specialist", team, title: "Engineer" });
  }
  return out;
}

describe("Tech floor pods", () => {
  it("has a pod per named team plus at least one NEW TEAM slot", () => {
    for (const t of TECH_TEAMS) expect(tech.pods.find((p) => p.team === t.id), t.id).toBeDefined();
    const spare = tech.pods.filter((p) => p.team === null);
    expect(spare.length).toBeGreaterThanOrEqual(1);
    for (const p of spare) expect(p.label).toBe("NEW TEAM");
    expect(tech.pods).toHaveLength(POD_SLOTS);
    for (const p of tech.pods) expect(tech.plates.some((pl) => pl.pod === p.index && pl.text === p.label)).toBe(true);
  });

  it("gives every pod 6–8 desk seats with exactly two lead seats side by side, inside the pod", () => {
    for (const p of tech.pods) {
      const seats = tech.seats.filter((s) => s.pod === p.index);
      expect(seats.length).toBeGreaterThanOrEqual(6);
      expect(seats.length).toBeLessThanOrEqual(8);
      const leads = seats.filter((s) => s.lead);
      expect(leads).toHaveLength(2);
      expect(Math.abs(leads[0]!.x - leads[1]!.x) + Math.abs(leads[0]!.y - leads[1]!.y)).toBe(1);
      for (const s of seats) expect(s.x >= p.x && s.x < p.x + p.w && s.y >= p.y && s.y < p.y + p.d, s.id).toBe(true);
      if (p.team) for (const s of seats) expect(s.team).toBe(p.team);
    }
  });

  it("has a six-seat platform zone, a VP seat, unique reachable seats and room for ~45 people", () => {
    expect(tech.seats.filter((s) => s.team === "platform")).toHaveLength(6);
    expect(tech.seats.filter((s) => s.role === "manager")).toHaveLength(1);
    expect(new Set(tech.seats.map((s) => `${s.x},${s.y}`)).size).toBe(tech.seats.length);
    expect(tech.seats.length).toBeGreaterThanOrEqual(45);
    const grid = walkGrid(tech);
    const from = tech.idle[0]!;
    for (const s of tech.seats) {
      expect(isWalkable(grid, s.x, s.y)).toBe(true);
      expect(findPath(tech, from, s), s.id).not.toBeNull();
    }
  });

  it("keeps people readable: a crop is used when the whole floor would make them too small", () => {
    const area = { w: 1400, h: 836 };
    const b = fitBounds(planBounds(tech), area);
    const cssPerPx = Math.min(area.w / b.w, area.h / b.h) * 0.95;
    expect(PERSON_H * cssPerPx).toBeGreaterThanOrEqual(MIN_PERSON_CSS - 0.01);
  });
});

describe("Tech seating by team", () => {
  it("seats leads at their pod's lead seats (Head Engineer first) and specialists in the pod", () => {
    const { seats, overflow } = assignSeats(tech, roster());
    expect(overflow).toEqual([]);
    for (const t of TECH_TEAMS) {
      const pod = tech.pods.find((p) => p.team === t.id)!;
      const head = seats.get(`zain-tech-${t.id}-head`)!;
      const pm = seats.get(`zain-tech-${t.id}-pm`)!;
      expect(head.pod).toBe(pod.index);
      expect(head.lead && pm.lead).toBe(true);
      expect(head.x).toBeLessThan(pm.x);
      for (let i = 0; i < 4; i++) {
        const s = seats.get(`zain-tech-${t.id}-dev${i}`)!;
        expect(s.pod).toBe(pod.index);
        expect(s.lead).toBeUndefined();
      }
    }
  });

  it("puts the VP in the office and team-less specialists in the platform zone", () => {
    const { seats } = assignSeats(tech, roster());
    for (const a of agentsInDivision("tech")) {
      const s = seats.get(a.profile)!;
      if (a.rank === "vp") expect(s.role).toBe("manager");
      else expect(s.team).toBe("platform");
    }
  });

  it("gives runtime teams the NEW TEAM pod, then overflows extra teams and extra people", () => {
    const pods = podsForTeams(tech, ["zz-late", "ai-lab"]);
    const spare = tech.pods.filter((p) => p.team === null);
    expect(pods.get("ai-lab")?.index).toBe(spare[0]!.index);
    if (spare.length === 1) expect(pods.get("zz-late")).toBeUndefined();

    const { seats, overflow } = assignSeats(tech, roster(["ai-lab", "zz-late"]));
    expect(seats.get("zain-tech-ai-lab-head")?.pod).toBe(spare[0]!.index);
    const late = ["zain-tech-zz-late-head", "zain-tech-zz-late-pm", ...[0, 1, 2, 3].map((i) => `zain-tech-zz-late-dev${i}`)];
    for (const p of late) expect(overflow, p).toContain(p);

    const big = assignSeats(tech, roster([], 9));
    const storelens = tech.pods.find((p) => p.team === "storelens")!;
    const spill = [...big.seats.entries()].filter(([p, s]) => p.startsWith("zain-tech-storelens") && s.pod !== storelens.index);
    for (const [, s] of spill) expect(s.pod, "overflow goes to a spare pod").toBe(spare[0]!.index);
  });

  it("seats leads by teamRole when present, even with a specialist rank or a vague title", () => {
    const people: SeatCandidate[] = [
      { profile: "zain-tech-bookme-pm2", rank: "specialist", team: "bookme", title: "Delivery", teamRole: "project-manager" },
      { profile: "zain-tech-bookme-he2", rank: "specialist", team: "bookme", title: "Builder", teamRole: "head-engineer" },
      { profile: "zain-tech-bookme-a", rank: "lead", team: "bookme", title: "Engineer", teamRole: "specialist" },
    ];
    const { seats } = assignSeats(tech, people);
    const head = seats.get("zain-tech-bookme-he2")!;
    const pm = seats.get("zain-tech-bookme-pm2")!;
    expect(head.lead && pm.lead).toBe(true);
    expect(head.x).toBeLessThan(pm.x);
    expect(seats.get("zain-tech-bookme-a")!.lead).toBeUndefined();
  });

  it("has room for the full Tech roster (38 agents) plus four hires outside the board", () => {
    expect(tech.seats.filter((s) => s.role !== "board").length).toBeGreaterThanOrEqual(42);
  });

  it("is deterministic", () => {
    const a = assignSeats(tech, roster(["ai-lab"]));
    const b = assignSeats(tech, [...roster(["ai-lab"])].reverse());
    for (const [p, s] of a.seats) expect(b.seats.get(p)?.id, p).toBe(s.id);
  });

  it("exposes a pod's scene rectangle for focusing a team", () => {
    const r = teamZone(tech, "storelens")!;
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
    expect(teamZone(tech, "nope", ["nope"])).not.toBeNull();
    expect(podFor(tech, "nope", ["nope"])?.team).toBeNull();
    expect(teamZone(floorPlan("studio"), "storelens")).toBeNull();
  });
});
