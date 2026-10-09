import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DIVISION_IDS } from "../../shared/divisions";
import { CEO_PROFILE, COO_PROFILE, ROSTER, agentsInDivision, managerOf } from "../../shared/roster";
import { BOARD_SPRITES, CEO_SPRITE, WORKER_SPRITES, spriteFor } from "../../src/world/characters";
import { compareBoxes, dynamicDepth } from "../../src/world/iso";
import { dirFacing, segmentFacing } from "../../src/world/behavior";
import { PersonBrain, restingSpot, seatedSortBox, sofaSortBox, wantsSeat } from "../../src/world/people";
import { HQ_TEAMS, floorPlan } from "../../src/world/plan";
import { MIN_PERSON_CSS, PERSON_H, fitBounds, itemBox, personBox, planBounds, rankStatics } from "../../src/world/plan/boxes";
import { isWalkable, standPoint, walkGrid } from "../../src/world/plan/grid";
import { assignSeats } from "../../src/world/seating";
import type { WorldAgent } from "../../src/world/types";

const ASSETS = fileURLToPath(new URL("../../src/world/assets/", import.meta.url));

const agent = (profile: string, over: Partial<WorldAgent> = {}): WorldAgent => {
  const r = ROSTER.find((a) => a.profile === profile);
  return { profile, title: r?.title ?? "New Hire", division: r?.division ?? "studio", rank: r?.rank ?? "specialist", activity: "idle", hired: true, ...over };
};

describe("depth sorting", () => {
  it.each(DIVISION_IDS.map((d) => [d]))("puts every seated person in %s behind their desk and in front of their chair", (division) => {
    const plan = floorPlan(division);
    const statics = rankStatics(plan);
    for (const seat of plan.seats) {
      const p = standPoint(seat);
      const z = dynamicDepth(statics, personBox(p.x, p.y));
      const desk = statics.find((s) => s.kind === "item" && s.item.id === seat.desk)!;
      expect(z, `${seat.id} before its desk`).toBeLessThan(desk.depth);
      const chair = statics.find((s) => s.kind === "item" && s.item.x === seat.x && s.item.y === seat.y && !s.item.solid);
      if (chair) expect(z, `${seat.id} after its chair`).toBeGreaterThan(chair.depth);
    }
  });

  it("sorts a person in front of a desk after it and one behind it before it", () => {
    const desk = itemBox({ id: "d", kind: "desk", x: 4, y: 4, w: 1, d: 1, facing: "-y", solid: true });
    expect(compareBoxes(personBox(4.5, 3.8), desk)).toBe(-1);
    expect(compareBoxes(personBox(4.5, 5.5), desk)).toBe(1);
    expect(compareBoxes(personBox(5.5, 4.5), desk)).toBe(1);
  });
});

describe("fit", () => {
  const hq = planBounds(floorPlan("hq"));

  it("keeps people at least 40 css px tall at 1400×900", () => {
    const area = { w: 1400, h: 836 };
    const b = fitBounds(hq, area);
    const cssPerPx = Math.min(area.w / b.w, area.h / b.h) * 0.95;
    expect(PERSON_H * cssPerPx).toBeGreaterThanOrEqual(MIN_PERSON_CSS - 0.01);
  });

  it("crops to a readable centre on phones and keeps the whole floor on big screens", () => {
    const phone = fitBounds(hq, { w: 390, h: 740 });
    expect(phone.w).toBeLessThan(hq.w);
    expect(phone.x + phone.w / 2).toBeCloseTo(hq.x + hq.w / 2, 6);
    expect(fitBounds(hq, { w: 3000, h: 2000 })).toEqual(hq);
  });
});

describe("seat assignment", () => {
  it.each(DIVISION_IDS.map((d) => [d]))("is deterministic and seats the %s manager in the manager seat", (division) => {
    const plan = floorPlan(division);
    const staff = agentsInDivision(division);
    const a = assignSeats(plan, staff);
    const b = assignSeats(plan, [...staff].reverse());
    for (const s of staff) expect(a.seats.get(s.profile)?.id).toBe(b.seats.get(s.profile)?.id);
    expect(a.seats.get(managerOf(division).profile)?.role).toBe("manager");
  });

  it("puts the CEO and COO in the executive lounge, leads in their rooms and the board at the table", () => {
    const hq = floorPlan("hq");
    const staff = agentsInDivision("hq");
    const { seats } = assignSeats(hq, staff);
    expect(seats.get(CEO_PROFILE)?.role).toBe("ceo");
    expect(seats.get(COO_PROFILE)?.role).toBe("manager");
    for (const [profile, team] of Object.entries(HQ_TEAMS)) expect(seats.get(profile)?.team, profile).toBe(team);
    for (const m of staff.filter((a) => a.rank === "board")) expect(seats.get(m.profile)?.role).toBe("board");
  });
});

describe("character sprites", () => {
  it("are deterministic, use the worker set and map the board to their portraits", () => {
    for (const r of ROSTER.filter((a) => a.rank !== "board" && a.rank !== "ceo" && !a.external)) {
      expect(spriteFor(r.profile, r.rank)).toBe(spriteFor(r.profile, r.rank));
      expect(WORKER_SPRITES.map((w) => `people/${w}`)).toContain(spriteFor(r.profile, r.rank));
    }
    expect(spriteFor("zain-board-hormozi", "board")).toBe("board/hormozi");
    expect(spriteFor("zain-board-jobs", "board")).toBe("board/jobs");
    expect(spriteFor(CEO_PROFILE, "ceo")).toBe(CEO_SPRITE);
  });

  it("give Claude, the external lane agent, his own voxel character that no one else has", () => {
    expect(spriteFor("zain-claude", "specialist")).toBe("voxel/claude");
    const others = ROSTER.filter((a) => a.profile !== "zain-claude").map((a) => spriteFor(a.profile, a.rank));
    expect(others).not.toContain("voxel/claude");
  });

  it("ships every sprite and no floor renders", () => {
    for (const key of [...WORKER_SPRITES.map((w) => `people/${w}`), ...BOARD_SPRITES.map((b) => `board/${b}`)]) {
      expect(statSync(`${ASSETS}${key}.webp`).size).toBeLessThanOrEqual(60 * 1024);
    }
    expect(existsSync(`${ASSETS}floors`)).toBe(false);
  });
});

describe("people", () => {
  const studio = floorPlan("studio");
  const grid = walkGrid(studio);
  const seat = studio.seats.find((s) => !s.role)!;
  const rest = restingSpot(studio, 0)!;
  const walkUntilSettled = (brain: PersonBrain, check?: (p: ReturnType<PersonBrain["pose"]>) => void) => {
    for (let t = 0; t < 60_000 && brain.pose().mode === "walking"; t += 50) {
      brain.tick(50);
      check?.(brain.pose());
    }
  };

  it("keeps working, vacant and board agents at their seats", () => {
    expect(wantsSeat(agent("zain-studio-copy", { activity: "working" }), seat)).toBe(true);
    expect(wantsSeat(agent("zain-studio-copy"), seat)).toBe(false);
    expect(wantsSeat(agent("zain-studio-copy", { hired: false }), seat)).toBe(true);
    expect(wantsSeat(agent("zain-board-hormozi"), seat)).toBe(true);
  });

  it("walks to the desk along walkable tiles facing each step, then sits typing on the chair", () => {
    const brain = new PersonBrain(studio, agent("zain-studio-copy"), false);
    brain.assign(seat, rest);
    expect(brain.pose().pose).toBe("stand");
    brain.setAgent(agent("zain-studio-copy", { activity: "working" }));
    let last = brain.pose();
    walkUntilSettled(brain, (p) => {
      const tile = { x: Math.floor(p.tx), y: Math.floor(p.ty) };
      expect((tile.x === seat.x && tile.y === seat.y) || isWalkable(grid, tile.x, tile.y), `${tile.x},${tile.y}`).toBe(true);
      if (p.mode === "walking") {
        expect(p.pose).toBe("walk");
        const dx = p.tx - last.tx;
        const dy = p.ty - last.ty;
        if (Math.hypot(dx, dy) > 0.01) expect(p.facing).toBe(segmentFacing(dx, dy, last.facing));
      }
      last = p;
    });
    const seated = brain.pose();
    expect(seated.mode).toBe("seated");
    expect(seated.seated).toBe(true);
    expect(seated.pose).toBe("type");
    expect(seated.facing).toBe(dirFacing(seat.facing));
    expect({ x: seated.tx, y: seated.ty, z: seated.z }).toEqual({ x: seat.sit.x, y: seat.sit.y, z: seat.sit.height });
    brain.setAgent(agent("zain-studio-copy", { activity: "blocked" }));
    expect(brain.pose().pose).toBe("sit");
  });

  it("keeps a vacant agent standing at their desk", () => {
    const brain = new PersonBrain(studio, agent("zain-studio-copy", { hired: false }), false);
    brain.assign(seat, rest);
    const p = brain.pose();
    expect(p.pose).toBe("stand");
    expect({ x: p.tx, y: p.ty }).toEqual(standPoint(seat));
    expect(p.facing).toBe(dirFacing(seat.facing));
  });

  it("strolls deterministically between idle spots and sofa cushions", () => {
    const run = () => {
      const claims = new Set<string>();
      const brains = ["zain-studio-art", "zain-studio-brand", "zain-studio-ux"].map((p) => {
        const b = new PersonBrain(studio, agent(p), false, claims);
        b.assign(null, rest);
        return b;
      });
      const trace: string[] = [];
      let sofa = false;
      for (let t = 0; t < 120_000; t += 100) {
        for (const b of brains) {
          b.tick(100);
          const p = b.pose();
          if (p.mode === "sofa") {
            sofa = true;
            expect(p.pose).toBe("sit");
          }
          trace.push(`${p.tx.toFixed(2)},${p.ty.toFixed(2)},${p.mode}`);
        }
      }
      return { trace, sofa, claims: claims.size };
    };
    const a = run();
    expect(a).toEqual(run());
    expect(a.sofa).toBe(true);
    expect(a.claims).toBeLessThanOrEqual(3);
  });

  it("never walks or animates with reduced motion", () => {
    const brain = new PersonBrain(studio, agent("zain-studio-copy", { activity: "working" }), true);
    brain.assign(seat, rest);
    expect(brain.pose().pose).toBe("type");
    brain.setAgent(agent("zain-studio-copy"));
    const at = brain.pose();
    for (let t = 0; t < 30_000; t += 100) {
      brain.tick(100);
      const p = brain.pose();
      expect(p.mode).not.toBe("walking");
      expect({ x: p.tx, y: p.ty }).toEqual({ x: at.tx, y: at.ty });
    }
  });
});

describe("seated depth", () => {
  it.each(DIVISION_IDS.map((d) => [d]))("sorts everyone seated in %s after their chair and before their desk", (division) => {
    const plan = floorPlan(division);
    const statics = rankStatics(plan);
    for (const seat of plan.seats) {
      const z = dynamicDepth(statics, seatedSortBox(seat));
      const desk = statics.find((s) => s.kind === "item" && s.item.id === seat.desk)!;
      const chair = statics.find((s) => s.kind === "item" && s.item.id === seat.sit.item)!;
      expect(z, `${seat.id} before desk`).toBeLessThan(desk.depth);
      expect(z, `${seat.id} after chair`).toBeGreaterThan(chair.depth);
    }
  });

  it("puts people on viewer-facing sofas in front of them and on away-facing sofas behind the backrest", () => {
    const plan = floorPlan("hq");
    const statics = rankStatics(plan);
    for (const c of plan.sofaSeats) {
      const sofa = statics.find((s) => s.kind === "item" && s.item.id === c.item)!;
      const z = dynamicDepth(statics, sofaSortBox(plan, c));
      if (c.facing === "+x" || c.facing === "+y") expect(z, c.id).toBeGreaterThan(sofa.depth);
      else expect(z, c.id).toBeLessThan(sofa.depth);
    }
  });
});
