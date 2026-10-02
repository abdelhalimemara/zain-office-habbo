import type { DivisionId } from "../../../shared/divisions";
import {
  DIR_VEC,
  type Dir,
  type FloorPlan,
  type Item,
  type ItemKind,
  type Material,
  type PlanSeat,
  type RoomPlate,
  type SeatRole,
  type Spot,
  type Wall,
  type WallKind,
  type Zone,
} from "./types";

const NON_SOLID: ReadonlySet<ItemKind> = new Set(["rug", "officeChair", "execChair"]);

export interface ItemOptions {
  facing?: Dir;
  color?: number;
  label?: string;
  solid?: boolean;
}

export interface SeatOptions {
  role?: SeatRole;
  team?: string;
  /** Desk kind; "none" when the seat faces an existing table. */
  desk?: "desk" | "none";
  /** Chair pulled out behind the person. */
  chair?: "officeChair" | "execChair" | "none";
  /** Existing table id when desk is "none". */
  table?: string;
}

export class PlanBuilder {
  private readonly zones: Zone[] = [];
  private readonly walls: Wall[] = [];
  private readonly items: Item[] = [];
  private readonly seats: PlanSeat[] = [];
  private readonly idle: Spot[] = [];
  private readonly plates: RoomPlate[] = [];
  private seq = 0;

  constructor(
    private readonly division: DivisionId,
    private readonly cols: number,
    private readonly rows: number,
  ) {}

  zone(x: number, y: number, w: number, d: number, material: Material): this {
    this.zones.push({ x, y, w, d, material });
    return this;
  }

  /** A wall on a tile edge, split around door gaps [from, to). */
  wall(axis: "x" | "y", at: number, from: number, to: number, kind: WallKind = "solid", gaps: [number, number][] = []): this {
    let cursor = from;
    for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0])) {
      if (g0 > cursor) this.walls.push({ axis, at, from: cursor, to: g0, kind });
      cursor = Math.max(cursor, g1);
    }
    if (cursor < to) this.walls.push({ axis, at, from: cursor, to, kind });
    return this;
  }

  item(kind: ItemKind, x: number, y: number, w = 1, d = 1, opts: ItemOptions = {}): Item {
    const it: Item = {
      id: `${kind}-${this.seq++}`,
      kind,
      x,
      y,
      w,
      d,
      facing: opts.facing ?? "+y",
      solid: opts.solid ?? !NON_SOLID.has(kind),
      ...(opts.color !== undefined ? { color: opts.color } : {}),
      ...(opts.label !== undefined ? { label: opts.label } : {}),
    };
    this.items.push(it);
    return it;
  }

  /** A person's place at (x, y) facing a 1×1 desk on the next tile, with their chair pulled out behind them. */
  seat(x: number, y: number, facing: "+x" | "+y", opts: SeatOptions = {}): PlanSeat {
    const v = DIR_VEC[facing];
    let desk = opts.table;
    if ((opts.desk ?? "desk") === "desk" && !desk) desk = this.item("desk", x + v.dx, y + v.dy, 1, 1, { facing: facing === "+y" ? "-y" : "-x" }).id;
    const chair = opts.chair ?? "officeChair";
    if (chair !== "none") this.item(chair, x, y, 1, 1, { facing, solid: false });
    const s: PlanSeat = {
      id: `seat-${this.seats.length}`,
      x,
      y,
      facing,
      desk: desk ?? "",
      ...(opts.role ? { role: opts.role } : {}),
      ...(opts.team ? { team: opts.team } : {}),
    };
    this.seats.push(s);
    return s;
  }

  /** A row of `n` workstations starting at (x, y), stepping along the axis perpendicular to `facing`. */
  deskRow(x: number, y: number, n: number, facing: "+x" | "+y", opts: SeatOptions = {}, gapEvery = 0): PlanSeat[] {
    const out: PlanSeat[] = [];
    let offset = 0;
    for (let i = 0; i < n; i++) {
      if (gapEvery > 0 && i > 0 && i % gapEvery === 0) offset++;
      const k = i + offset;
      out.push(facing === "+y" ? this.seat(x + k, y, facing, opts) : this.seat(x, y + k, facing, opts));
    }
    return out;
  }

  /** Loose chairs around a table, skipping tiles already used. */
  chairsAround(t: Item, sides: { back?: boolean; front?: boolean; left?: boolean; right?: boolean } = {}): this {
    const used = new Set([...this.items.filter((i) => i.solid || i.kind === "officeChair" || i.kind === "execChair").flatMap(tilesOf)]);
    const put = (x: number, y: number, facing: Dir) => {
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows || used.has(`${x},${y}`)) return;
      this.item("chair", x, y, 1, 1, { facing, color: t.kind === "boardTable" ? 0xb59a7c : undefined });
      used.add(`${x},${y}`);
    };
    const { back = true, front = true, left = true, right = true } = sides;
    for (let i = 0; i < t.w; i++) {
      if (back) put(t.x + i, t.y - 1, "+y");
      if (front) put(t.x + i, t.y + t.d, "-y");
    }
    for (let j = 0; j < t.d; j++) {
      if (left) put(t.x - 1, t.y + j, "+x");
      if (right) put(t.x + t.w, t.y + j, "-x");
    }
    return this;
  }

  rest(x: number, y: number): this {
    this.idle.push({ id: `idle-${this.idle.length}`, x, y });
    return this;
  }

  plate(text: string, x: number, y: number): this {
    this.plates.push({ text, x, y });
    return this;
  }

  build(): FloorPlan {
    return {
      division: this.division,
      cols: this.cols,
      rows: this.rows,
      zones: this.zones,
      walls: this.walls,
      items: this.items,
      seats: this.seats,
      idle: this.idle,
      plates: this.plates,
    };
  }
}

export function tilesOf(it: Pick<Item, "x" | "y" | "w" | "d">): string[] {
  const out: string[] = [];
  for (let y = Math.floor(it.y); y < it.y + it.d; y++) for (let x = Math.floor(it.x); x < it.x + it.w; x++) out.push(`${x},${y}`);
  return out;
}
