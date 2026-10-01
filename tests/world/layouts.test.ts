import { DIVISION_IDS } from "../../shared/divisions";
import { agentsInDivision } from "../../shared/roster";
import { CITY_BUILDINGS, CITY_PROPS, CITY_SIZE, PED_LOOPS, cityTileAt, pointOnLoop } from "../../src/world/layouts/city";
import { FACING_VEC, NON_BLOCKING, floorLayout, roomAt } from "../../src/world/layouts";
import { findPath, loungeTiles } from "../../src/world/pathing";

describe.each(DIVISION_IDS.map((d) => [d]))("floor layout %s", (division) => {
  const layout = floorLayout(division);
  const covered = new Set<string>();
  for (const f of layout.furniture) {
    if (NON_BLOCKING.has(f.kind)) continue;
    for (let y = f.y; y < f.y + f.d; y++) for (let x = f.x; x < f.x + f.w; x++) covered.add(`${x},${y}`);
  }

  it("keeps rooms, furniture and walls inside the grid", () => {
    for (const r of layout.rooms) {
      expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= layout.cols && r.y + r.h <= layout.rows).toBe(true);
    }
    for (const f of layout.furniture) {
      expect(f.x >= 0 && f.y >= 0 && f.x + f.w <= layout.cols && f.y + f.d <= layout.rows, f.id).toBe(true);
    }
    for (const w of layout.walls) expect(w.from).toBeLessThan(w.to);
  });

  it("does not stack furniture", () => {
    const seen = new Set<string>();
    for (const f of layout.furniture) {
      if (NON_BLOCKING.has(f.kind)) continue;
      for (let y = f.y; y < f.y + f.d; y++) {
        for (let x = f.x; x < f.x + f.w; x++) {
          expect(seen.has(`${x},${y}`), `${f.id} at ${x},${y}`).toBe(false);
          seen.add(`${x},${y}`);
        }
      }
    }
  });

  it("has unique seats inside rooms, off furniture, facing their desk", () => {
    const keys = layout.seats.map((s) => `${s.x},${s.y}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of layout.seats) {
      expect(s.x >= 0 && s.y >= 0 && s.x < layout.cols && s.y < layout.rows).toBe(true);
      expect(roomAt(layout, s.x, s.y)?.id).toBe(s.room);
      expect(covered.has(`${s.x},${s.y}`)).toBe(false);
      const desk = layout.furniture.find((f) => f.id === s.desk)!;
      const v = FACING_VEC[s.facing];
      const tx = s.x + v.dx;
      const ty = s.y + v.dy;
      expect(tx >= desk.x && tx < desk.x + desk.w && ty >= desk.y && ty < desk.y + desk.d).toBe(true);
    }
  });

  it("has a manager seat and room for the roster plus four hires", () => {
    expect(layout.seats.filter((s) => s.role === "manager")).toHaveLength(1);
    expect(layout.seats.length).toBeGreaterThanOrEqual(agentsInDivision(division).length + 4);
    if (division === "hq") expect(layout.seats.filter((s) => s.role === "ceo")).toHaveLength(1);
  });

  it("connects every seat to the lounge", () => {
    const lounge = loungeTiles(layout);
    expect(lounge.length).toBeGreaterThan(8);
    for (const s of layout.seats) expect(findPath(layout, s, lounge[0]!), s.id).not.toBeNull();
  });
});

describe("city layout", () => {
  it("places one building per division without overlap, on plaza or grass", () => {
    expect(new Set(CITY_BUILDINGS.map((b) => b.division))).toEqual(new Set(DIVISION_IDS));
    const seen = new Set<string>();
    for (const b of CITY_BUILDINGS) {
      for (let y = b.y; y < b.y + b.d; y++) {
        for (let x = b.x; x < b.x + b.w; x++) {
          expect(seen.has(`${x},${y}`)).toBe(false);
          seen.add(`${x},${y}`);
          expect(["plaza", "grass"]).toContain(cityTileAt(x, y));
        }
      }
    }
    for (const p of CITY_PROPS) {
      for (let y = p.y; y < p.y + p.d; y++) {
        for (let x = p.x; x < p.x + p.w; x++) {
          expect(seen.has(`${x},${y}`), `${p.kind} ${x},${y}`).toBe(false);
          seen.add(`${x},${y}`);
          expect(x < CITY_SIZE && y < CITY_SIZE).toBe(true);
        }
      }
    }
  });

  it("walks pedestrians on sidewalks", () => {
    for (const loop of PED_LOOPS) {
      for (let t = 0; t < 1; t += 0.01) {
        const p = pointOnLoop(loop, t);
        expect(cityTileAt(Math.floor(p.x), Math.floor(p.y))).toBe("sidewalk");
      }
    }
  });
});
