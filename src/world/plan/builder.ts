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
  type SitPoint,
  type SofaSeat,
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
  /** Tiles to the table; 2 when its chairs stand between the person and the table (board room). */
  reach?: 1 | 2;
}

/** Seat-top height of chairs and cushions, in tiles. */
export const CHAIR_SEAT_H = 0.33;
export const SOFA_SEAT_H = 0.25;
const CHAIR_KINDS: ReadonlySet<ItemKind> = new Set(["officeChair", "execChair", "chair"]);

export class PlanBuilder {
  private readonly zones: Zone[] = [];
  private readonly walls: Wall[] = [];
  private readonly items: Item[] = [];
  private readonly seats: Omit<PlanSeat, "sit">[] = [];
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
  seat(x: number, y: number, facing: "+x" | "+y", opts: SeatOptions = {}): Omit<PlanSeat, "sit"> {
    const v = DIR_VEC[facing];
    let desk = opts.table;
    if ((opts.desk ?? "desk") === "desk" && !desk) desk = this.item("desk", x + v.dx, y + v.dy, 1, 1, { facing: facing === "+y" ? "-y" : "-x" }).id;
    const chair = opts.chair ?? "officeChair";
    if (chair !== "none") this.item(chair, x, y, 1, 1, { facing, solid: false });
    const s: Omit<PlanSeat, "sit"> = {
      id: `seat-${this.seats.length}`,
      x,
      y,
      facing,
      desk: desk ?? "",
      reach: opts.reach ?? 1,
      ...(opts.role ? { role: opts.role } : {}),
      ...(opts.team ? { team: opts.team } : {}),
    };
    this.seats.push(s);
    return s;
  }

  /** A row of `n` workstations starting at (x, y), stepping along the axis perpendicular to `facing`. */
  deskRow(x: number, y: number, n: number, facing: "+x" | "+y", opts: SeatOptions = {}, gapEvery = 0): Omit<PlanSeat, "sit">[] {
    const out: Omit<PlanSeat, "sit">[] = [];
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
      seats: this.seats.map((s) => ({ ...s, sit: this.sitFor(s) })),
      idle: this.idle,
      plates: this.plates,
      sofaSeats: this.sofaSeats(),
    };
  }

  /** The chair a seat's person sits on: on their own tile, or the one between them and the table. */
  private sitFor(s: Omit<PlanSeat, "sit">): SitPoint {
    const v = DIR_VEC[s.facing];
    const tiles = s.reach === 2 ? [{ x: s.x + v.dx, y: s.y + v.dy }] : [{ x: s.x, y: s.y }];
    const chair = this.items.find((i) => CHAIR_KINDS.has(i.kind) && tiles.some((t) => t.x === i.x && t.y === i.y));
    const t = tiles[0]!;
    const back = 0.42;
    return {
      x: t.x + (v.dx !== 0 ? back : 0.5),
      y: t.y + (v.dy !== 0 ? back : 0.5),
      facing: s.facing,
      height: CHAIR_SEAT_H,
      item: chair?.id ?? "",
    };
  }

  /** One cushion per tile along every sofa and armchair, pushed towards its back, facing out. */
  private sofaSeats(): SofaSeat[] {
    const out: SofaSeat[] = [];
    for (const it of this.items.filter((i) => i.kind === "sofa" || i.kind === "armchair")) {
      const v = DIR_VEC[it.facing];
      for (const key of tilesOf(it)) {
        const [tx, ty] = key.split(",").map(Number) as [number, number];
        out.push({
          id: `cushion-${out.length}`,
          x: tx + 0.5 - v.dx * 0.12,
          y: ty + 0.5 - v.dy * 0.12,
          facing: it.facing,
          height: SOFA_SEAT_H,
          item: it.id,
        });
      }
    }
    return out;
  }
}

export function tilesOf(it: Pick<Item, "x" | "y" | "w" | "d">): string[] {
  const out: string[] = [];
  for (let y = Math.floor(it.y); y < it.y + it.d; y++) for (let x = Math.floor(it.x); x < it.x + it.w; x++) out.push(`${x},${y}`);
  return out;
}
