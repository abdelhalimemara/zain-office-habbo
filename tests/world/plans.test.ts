import { DIVISION_IDS } from "../../shared/divisions";
import { agentsInDivision } from "../../shared/roster";
import { tilesOf } from "../../src/world/plan/builder";
import { findPath, isWalkable, walkGrid } from "../../src/world/plan/grid";
import { DIR_VEC, floorPlan } from "../../src/world/plan";

describe.each(DIVISION_IDS.map((d) => [d]))("floor plan %s", (division) => {
  const plan = floorPlan(division);
  const grid = walkGrid(plan);
  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < plan.cols && y < plan.rows;

  it("keeps items, zones, walls and plates inside the grid", () => {
    for (const it of plan.items) expect(it.x >= 0 && it.y >= 0 && it.x + it.w <= plan.cols && it.y + it.d <= plan.rows, it.id).toBe(true);
    for (const z of plan.zones) expect(z.x >= 0 && z.y >= 0 && z.x + z.w <= plan.cols && z.y + z.d <= plan.rows).toBe(true);
    for (const w of plan.walls) {
      expect(w.from).toBeLessThan(w.to);
      expect(w.to).toBeLessThanOrEqual(w.axis === "x" ? plan.cols : plan.rows);
    }
    for (const p of plan.plates) expect(p.x >= 0 && p.y >= 0 && p.x <= plan.cols && p.y <= plan.rows).toBe(true);
  });

  it("never stacks solid furniture", () => {
    const seen = new Map<string, string>();
    for (const it of plan.items.filter((i) => i.solid)) {
      for (const t of tilesOf(it)) {
        expect(seen.get(t), `${it.id} on ${t}`).toBeUndefined();
        seen.set(t, it.id);
      }
    }
  });

  it("puts seats on free floor facing their desk", () => {
    const keys = plan.seats.map((s) => `${s.x},${s.y}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of plan.seats) {
      expect(inBounds(s.x, s.y)).toBe(true);
      expect(isWalkable(grid, s.x, s.y), `${s.id} walkable`).toBe(true);
      const desk = plan.items.find((i) => i.id === s.desk);
      expect(desk, s.id).toBeDefined();
      const v = DIR_VEC[s.facing];
      const tx = s.x + v.dx;
      const ty = s.y + v.dy;
      expect(tx >= desk!.x && tx < desk!.x + desk!.w && ty >= desk!.y && ty < desk!.y + desk!.d, `${s.id} faces ${desk!.id}`).toBe(true);
    }
  });

  it("has room for the roster plus four hires, a manager seat and idle spots", () => {
    const staff = agentsInDivision(division).filter((a) => a.rank !== "board");
    expect(plan.seats.filter((s) => s.role !== "board").length).toBeGreaterThanOrEqual(staff.length + 4);
    expect(plan.seats.filter((s) => s.role === "manager")).toHaveLength(1);
    expect(plan.idle.length).toBeGreaterThanOrEqual(4);
    const seatTiles = new Set(plan.seats.map((s) => `${s.x},${s.y}`));
    for (const r of plan.idle) {
      expect(isWalkable(grid, r.x, r.y), `${r.id} at ${r.x},${r.y}`).toBe(true);
      expect(seatTiles.has(`${r.x},${r.y}`)).toBe(false);
    }
  });

  it("can reach every seat and idle spot from every idle spot without crossing furniture", () => {
    const from = plan.idle[0]!;
    for (const target of [...plan.seats, ...plan.idle]) {
      const path = findPath(plan, from, target);
      expect(path, `${from.id} → ${target.id} (${target.x},${target.y})`).not.toBeNull();
      for (const p of path!.slice(1, -1)) expect(isWalkable(grid, p.x, p.y), `${p.x},${p.y}`).toBe(true);
    }
  });
});

describe("HQ plan", () => {
  const hq = floorPlan("hq");
  it("has five board seats at the board table and one CEO seat", () => {
    const board = hq.seats.filter((s) => s.role === "board");
    expect(board).toHaveLength(5);
    for (const s of board) expect(hq.items.find((i) => i.id === s.desk)?.kind).toBe("boardTable");
    expect(hq.seats.filter((s) => s.role === "ceo")).toHaveLength(1);
  });
});
