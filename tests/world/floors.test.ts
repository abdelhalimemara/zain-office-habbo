import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DIVISION_IDS } from "../../shared/divisions";
import { CEO_PROFILE, COO_PROFILE, ROSTER, agentsInDivision, managerOf } from "../../shared/roster";
import { BOARD_SPRITES, CEO_SPRITE, WORKER_SPRITES, spriteFor } from "../../src/world/characters";
import { FLOOR_IMAGES, HQ_TEAMS, floorImage } from "../../src/world/layouts/floorImages";
import { PersonBrain, wantsSeat } from "../../src/world/people";
import { restingSpot, route, waypointPath } from "../../src/world/routes";
import { assignSeats } from "../../src/world/seating";
import type { WorldAgent } from "../../src/world/types";

const ASSETS = fileURLToPath(new URL("../../src/world/assets/", import.meta.url));

const agent = (profile: string, over: Partial<WorldAgent> = {}): WorldAgent => {
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

describe.each(DIVISION_IDS.map((d) => [d]))("floor image %s", (division) => {
  const floor = floorImage(division);
  const spots = [...floor.seats, ...floor.idle];
  const waypointIds = new Set(floor.waypoints.map((w) => w.id));

  it("ships a trimmed WebP floor under 700 KB", () => {
    const file = `${ASSETS}floors/${division}.webp`;
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeLessThanOrEqual(700 * 1024);
  });

  it("keeps every spot and waypoint inside the image", () => {
    for (const p of [...spots, ...floor.waypoints]) {
      expect(p.x > 0 && p.x < floor.width && p.y > floor.personHeight && p.y < floor.height, `${p.id}`).toBe(true);
    }
  });

  it("has unique, non-overlapping seats", () => {
    expect(new Set(floor.seats.map((s) => s.id)).size).toBe(floor.seats.length);
    for (let i = 0; i < floor.seats.length; i++) {
      for (let j = i + 1; j < floor.seats.length; j++) {
        const a = floor.seats[i]!;
        const b = floor.seats[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.id}/${b.id}`).toBeGreaterThan(floor.personHeight * 0.3);
      }
    }
  });

  it("has room for its roster plus four hires and one manager seat", () => {
    const staff = agentsInDivision(division).filter((a) => a.rank !== "board");
    expect(floor.seats.filter((s) => s.role !== "board").length).toBeGreaterThanOrEqual(staff.length + 4);
    expect(floor.seats.filter((s) => s.role === "manager")).toHaveLength(1);
    expect(floor.idle.length).toBeGreaterThanOrEqual(4);
  });

  it("links every spot into one connected walking graph", () => {
    for (const s of spots) expect(waypointIds.has(s.via), `${s.id} via ${s.via}`).toBe(true);
    for (const w of floor.waypoints) for (const l of w.links) expect(waypointIds.has(l)).toBe(true);
    const first = floor.waypoints[0]!.id;
    for (const w of floor.waypoints) expect(waypointPath(floor, first, w.id), `${first}→${w.id}`).not.toBeNull();
    for (const s of floor.seats) {
      const path = route(floor, floor.idle[0]!, floor.idle[0]!.via, s);
      expect(path[path.length - 1]).toEqual({ x: s.x, y: s.y });
    }
  });
});

describe("HQ floor", () => {
  const hq = FLOOR_IMAGES.hq;

  it("has exactly five board seats and one CEO seat", () => {
    expect(hq.seats.filter((s) => s.role === "board")).toHaveLength(5);
    expect(hq.seats.filter((s) => s.role === "ceo")).toHaveLength(1);
  });

  it("seats the CEO and COO in the executive lounge and leads in their departments", () => {
    const { seats, overflow } = assignSeats(hq, agentsInDivision("hq"));
    expect(overflow).toEqual([]);
    expect(seats.get(CEO_PROFILE)?.role).toBe("ceo");
    expect(seats.get(COO_PROFILE)?.role).toBe("manager");
    for (const [profile, team] of Object.entries(HQ_TEAMS)) expect(seats.get(profile)?.team, profile).toBe(team);
  });

  it("puts board members at the board table in roster order and never at a desk", () => {
    const boardSeats = hq.seats.filter((s) => s.role === "board");
    const members = agentsInDivision("hq").filter((a) => a.rank === "board");
    const extra = Array.from({ length: boardSeats.length - members.length + 1 }, (_, i) => ({
      profile: `zain-board-zz-${i}`,
      rank: "board" as const,
    }));
    const { seats, overflow } = assignSeats(hq, [...agentsInDivision("hq"), ...extra]);
    members.forEach((m, i) => expect(seats.get(m.profile)?.id).toBe(boardSeats[i]!.id));
    for (const e of extra.slice(0, -1)) expect(seats.get(e.profile)?.role).toBe("board");
    expect(overflow).toEqual([extra.at(-1)!.profile]);
  });
});

describe("seat assignment", () => {
  it.each(DIVISION_IDS.map((d) => [d]))("is deterministic and seats the %s manager in the manager seat", (division) => {
    const floor = floorImage(division);
    const staff = agentsInDivision(division);
    const a = assignSeats(floor, staff);
    const b = assignSeats(floor, [...staff].reverse());
    for (const s of staff) expect(a.seats.get(s.profile)?.id).toBe(b.seats.get(s.profile)?.id);
    expect(a.seats.get(managerOf(division).profile)?.role).toBe("manager");
    expect(new Set([...a.seats.values()].map((s) => s.id)).size).toBe(a.seats.size);
  });

  it("sends people beyond capacity to the idle areas", () => {
    const floor = floorImage("tech");
    const many = Array.from({ length: floor.seats.length + 2 }, (_, i) => ({ profile: `hire-${String(i).padStart(2, "0")}`, rank: "specialist" as const }));
    const { seats, overflow } = assignSeats(floor, many);
    expect(seats.size).toBe(floor.seats.length - 1);
    expect(overflow).toHaveLength(3);
  });
});

describe("character sprites", () => {
  it("are deterministic and drawn from the 14 worker sprites", () => {
    for (const r of ROSTER.filter((a) => a.rank !== "board" && a.rank !== "ceo")) {
      const key = spriteFor(r.profile, r.rank);
      expect(key).toBe(spriteFor(r.profile, r.rank));
      expect(WORKER_SPRITES.map((w) => `people/${w}`)).toContain(key);
    }
    const used = new Set(ROSTER.map((r) => spriteFor(r.profile, r.rank)));
    expect([...used].some((k) => k.includes("female"))).toBe(true);
    expect([...used].some((k) => k.includes("male-"))).toBe(true);
  });

  it("maps the board to their own portraits and gives the CEO the sharp suit", () => {
    expect(spriteFor("zain-board-hormozi", "board")).toBe("board/hormozi");
    expect(spriteFor("zain-board-alwaleed", "board")).toBe("board/alwaleed");
    expect(spriteFor("zain-board-bezos", "board")).toBe("board/bezos");
    expect(spriteFor("zain-board-buffett", "board")).toBe("board/buffett");
    expect(spriteFor("zain-board-jobs", "board")).toBe("board/jobs");
    expect(spriteFor(CEO_PROFILE, "ceo")).toBe(CEO_SPRITE);
  });

  it("ships every sprite as a small WebP", () => {
    for (const key of [...WORKER_SPRITES.map((w) => `people/${w}`), ...BOARD_SPRITES.map((b) => `board/${b}`)]) {
      const file = `${ASSETS}${key}.webp`;
      expect(existsSync(file), key).toBe(true);
      expect(statSync(file).size).toBeLessThanOrEqual(60 * 1024);
    }
  });
});

describe("people", () => {
  const studio = floorImage("studio");
  const seat = studio.seats.find((s) => !s.role)!;
  const rest = restingSpot(studio, 0)!;

  it("keeps working, blocked and vacant agents at their seat; the board stays seated when idle", () => {
    expect(wantsSeat(agent("zain-studio-copy", { activity: "working" }), seat)).toBe(true);
    expect(wantsSeat(agent("zain-studio-copy", { activity: "idle" }), seat)).toBe(false);
    expect(wantsSeat(agent("zain-studio-copy", { activity: "idle", hired: false }), seat)).toBe(true);
    expect(wantsSeat(agent("zain-board-hormozi", { activity: "idle" }), seat)).toBe(true);
    expect(wantsSeat(agent("zain-studio-copy", { activity: "working" }), null)).toBe(false);
  });

  it("walks between idle spots and back to the desk when work starts", () => {
    const brain = new PersonBrain(studio, agent("zain-studio-copy"), false);
    brain.assign(seat, rest);
    const start = brain.pose(0);
    expect(start.mode).toBe("standing");
    brain.setAgent(agent("zain-studio-copy", { activity: "working" }));
    brain.tick(16);
    expect(brain.pose(16).mode).toBe("walking");
    for (let t = 0; t < 60_000 && brain.pose(t).mode === "walking"; t += 50) brain.tick(50);
    const seated = brain.pose(1000);
    expect(seated.mode).toBe("seated");
    expect({ x: seated.x, y: seated.y }).toEqual({ x: seat.x, y: seat.y });
    const bobs = [100, 200, 300, 400].map((t) => brain.pose(t).bob);
    expect(bobs.some((b) => b !== 0)).toBe(true);
  });

  it("never walks or bobs with reduced motion", () => {
    const brain = new PersonBrain(studio, agent("zain-studio-copy", { activity: "working" }), true);
    brain.assign(seat, rest);
    for (let t = 0; t < 20_000; t += 100) {
      brain.tick(100);
      expect(brain.pose(t).bob).toBe(0);
      expect(brain.pose(t).mode).not.toBe("walking");
    }
    brain.setAgent(agent("zain-studio-copy", { activity: "idle" }));
    expect(brain.pose(0).mode).toBe("standing");
    const idleAt = brain.pose(0);
    for (let t = 0; t < 30_000; t += 100) brain.tick(100);
    expect({ x: brain.pose(0).x, y: brain.pose(0).y }).toEqual({ x: idleAt.x, y: idleAt.y });
  });

  it("strolls to another idle spot after resting", () => {
    const brain = new PersonBrain(studio, agent("zain-studio-art"), false);
    brain.assign(seat, rest);
    const first = brain.pose(0);
    let moved = false;
    for (let t = 0; t < 30_000; t += 100) {
      brain.tick(100);
      if (brain.pose(t).mode === "walking") moved = true;
    }
    expect(moved).toBe(true);
    expect(brain.pose(0).x !== first.x || brain.pose(0).y !== first.y).toBe(true);
  });
});
