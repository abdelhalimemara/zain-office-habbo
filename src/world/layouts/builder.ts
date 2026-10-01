import type { DivisionId } from "../../../shared/divisions";
import {
  FACING_VEC,
  opposite,
  type Facing,
  type FloorKind,
  type FloorLayout,
  type Furniture,
  type FurnitureKind,
  type Room,
  type Seat,
  type WallKind,
  type WallSeg,
} from "./types";

export class LayoutBuilder {
  private readonly rooms: Room[] = [];
  private readonly walls: WallSeg[] = [];
  private readonly furniture: Furniture[] = [];
  private readonly seats: Seat[] = [];
  private seq = 0;

  constructor(
    private readonly division: DivisionId,
    private readonly cols: number,
    private readonly rows: number,
  ) {}

  room(id: string, name: string, x: number, y: number, w: number, h: number, floor: FloorKind): this {
    this.rooms.push({ id, name, x, y, w, h, floor });
    return this;
  }

  wall(axis: "x" | "y", at: number, from: number, to: number, kind: WallKind = "solid", gaps: [number, number][] = []): this {
    let cursor = from;
    for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0])) {
      if (g0 > cursor) this.walls.push({ axis, at, from: cursor, to: g0, kind });
      cursor = Math.max(cursor, g1);
    }
    if (cursor < to) this.walls.push({ axis, at, from: cursor, to, kind });
    return this;
  }

  add(kind: FurnitureKind, x: number, y: number, w = 1, d = 1, dir: Facing = "sw", color?: number): Furniture {
    const f: Furniture = { id: `${kind}-${this.seq++}`, kind, x, y, w, d, dir, color };
    this.furniture.push(f);
    return f;
  }

  /** A seat at (x, y) facing a 1×1 desk placed in front of it. */
  deskSeat(x: number, y: number, facing: Facing, room: string, role?: Seat["role"]): Seat {
    const v = FACING_VEC[facing];
    const desk = this.add("desk", x + v.dx, y + v.dy, 1, 1, opposite(facing));
    return this.seat(x, y, facing, room, desk.id, role);
  }

  /** A seat facing a 2-tile executive desk; the desk extends toward +x / +y of the seat column. */
  execSeat(x: number, y: number, facing: Facing, room: string, role: Seat["role"], color?: number): Seat {
    const v = FACING_VEC[facing];
    const alongX = v.dx === 0;
    const dx = x + v.dx - (alongX ? 1 : 0);
    const dy = y + v.dy - (alongX ? 0 : 1);
    const desk = this.add("execDesk", dx, dy, alongX ? 2 : 1, alongX ? 1 : 2, opposite(facing), color);
    return this.seat(x, y, facing, room, desk.id, role);
  }

  chairsAround(x: number, y: number, w: number, d: number, ends = true): this {
    for (let i = 0; i < w; i++) {
      this.add("chair", x + i, y - 1, 1, 1, "sw");
      this.add("chair", x + i, y + d, 1, 1, "ne");
    }
    for (let j = 0; ends && j < d; j++) {
      this.add("chair", x - 1, y + j, 1, 1, "se");
      this.add("chair", x + w, y + j, 1, 1, "nw");
    }
    return this;
  }

  build(lounge: string): FloorLayout {
    return {
      division: this.division,
      cols: this.cols,
      rows: this.rows,
      rooms: this.rooms,
      walls: this.walls,
      furniture: this.furniture,
      seats: this.seats,
      lounge,
    };
  }

  private seat(x: number, y: number, facing: Facing, room: string, desk: string, role?: Seat["role"]): Seat {
    const s: Seat = { id: `seat-${this.seats.length}`, x, y, facing, room, desk, ...(role ? { role } : {}) };
    this.seats.push(s);
    return s;
  }
}
