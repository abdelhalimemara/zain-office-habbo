import { DIVISION_IDS } from "../../shared/divisions";
import { agentsInDivision } from "../../shared/roster";
import { tilesOf } from "../../src/world/plan/builder";
import { findPath, isWalkable, walkGrid } from "../../src/world/plan/grid";
import { DIR_VEC, floorPlan } from "../../src/world/plan";
import { BOARD_ROOM, BOARD_TABLE } from "../../src/world/plan/hq";

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
      const tx = s.x + v.dx * s.reach;
      const ty = s.y + v.dy * s.reach;
      expect(tx >= desk!.x && tx < desk!.x + desk!.w && ty >= desk!.y && ty < desk!.y + desk!.d, `${s.id} faces ${desk!.id}`).toBe(true);
    }
  });

  it("gives every seat a chair to sit on, facing its desk", () => {
    for (const s of plan.seats) {
      const chair = plan.items.find((i) => i.id === s.sit.item);
      expect(chair, `${s.id} chair`).toBeDefined();
      expect(["officeChair", "execChair", "chair"]).toContain(chair!.kind);
      expect(s.sit.facing).toBe(s.facing);
      expect(s.sit.x >= chair!.x && s.sit.x <= chair!.x + 1 && s.sit.y >= chair!.y && s.sit.y <= chair!.y + 1).toBe(true);
      expect(s.sit.height).toBeGreaterThan(0.2);
    }
  });

  it("lists a cushion on every sofa and armchair tile", () => {
    const sofas = plan.items.filter((i) => i.kind === "sofa" || i.kind === "armchair");
    expect(plan.sofaSeats.length).toBe(sofas.reduce((n, i) => n + i.w * i.d, 0));
    for (const c of plan.sofaSeats) {
      const it = sofas.find((i) => i.id === c.item)!;
      expect(c.x > it.x && c.x < it.x + it.w && c.y > it.y && c.y < it.y + it.d).toBe(true);
      expect(c.facing).toBe(it.facing);
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
    const table = hq.items.find((i) => i.kind === "boardTable")!;
    expect(Math.min(table.w, table.d)).toBe(2);
    expect(Math.max(table.w, table.d)).toBeGreaterThanOrEqual(6);
    for (const s of board) {
      expect(s.desk).toBe(table.id);
      expect(hq.items.find((i) => i.id === s.sit.item)?.kind, "board stands at their own exec chair").toBe("execChair");
    }
    expect(hq.seats.filter((s) => s.role === "ceo")).toHaveLength(1);
  });

  it("seats the board at the table: two at the head, three down the back long side, legs behind the table edge", () => {
    const board = hq.seats.filter((s) => s.role === "board");
    const table = hq.items.find((i) => i.kind === "boardTable")!;
    const head = board.filter((s) => s.facing === "+x");
    const side = board.filter((s) => s.facing === "+y");
    expect(head.map((s) => [s.x, s.y])).toEqual([[table.x - 1, table.y], [table.x - 1, table.y + 1]]);
    expect(side.map((s) => [s.x, s.y])).toEqual([0, 1, 2].map((i) => [table.x + i, table.y - 1]));
    for (const s of board) {
      expect(s.reach).toBe(1);
      expect(hq.items.find((i) => i.id === s.sit.item)?.kind).toBe("execChair");
      const chair = hq.items.find((i) => i.id === s.sit.item)!;
      expect([chair.x, chair.y]).toEqual([s.x, s.y]);
    }
  });

  it("keeps the board table a real table centred in its room", () => {
    const table = hq.items.find((i) => i.kind === "boardTable")!;
    expect(table).toMatchObject(BOARD_TABLE);
    expect(Math.min(table.w, table.d)).toBe(2);
    expect(Math.max(table.w, table.d)).toBeGreaterThanOrEqual(6);
    expect((table.w * table.d) / (BOARD_ROOM.w * BOARD_ROOM.d)).toBeLessThan(0.25);
    expect(table.y - BOARD_ROOM.y).toBe(BOARD_ROOM.y + BOARD_ROOM.d - (table.y + table.d));
  });

  it("leaves a walkable ring between the board-room chairs and its walls", () => {
    const grid = walkGrid(hq);
    const { x, y, w, d } = BOARD_ROOM;
    for (let tx = x; tx < x + w; tx++) {
      expect(isWalkable(grid, tx, y), `${tx},${y}`).toBe(true);
      expect(isWalkable(grid, tx, y + d - 1), `${tx},${y + d - 1}`).toBe(true);
    }
    for (let ty = y; ty < y + d; ty++) {
      expect(isWalkable(grid, x, ty), `${x},${ty}`).toBe(true);
      expect(isWalkable(grid, x + w - 1, ty), `${x + w - 1},${ty}`).toBe(true);
    }
  });
});
