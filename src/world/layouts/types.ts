import type { DivisionId } from "../../../shared/divisions";

export type Facing = "ne" | "nw" | "se" | "sw";
export type FloorKind = "tile" | "wood" | "carpet" | "gold" | "dark";
export type WallKind = "solid" | "glass";

export interface Room {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  floor: FloorKind;
}

/** axis "x": runs along x at y = at; axis "y": runs along y at x = at. */
export interface WallSeg {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
  kind: WallKind;
}

export type FurnitureKind =
  | "desk"
  | "execDesk"
  | "chair"
  | "meetingTable"
  | "sofa"
  | "armchair"
  | "coffeeTable"
  | "plant"
  | "bigPlant"
  | "waterCooler"
  | "whiteboard"
  | "bookcase"
  | "counter"
  | "fridge"
  | "vending"
  | "printer"
  | "filing"
  | "receptionDesk"
  | "gameTable"
  | "safe"
  | "tv"
  | "rug"
  | "bistroTable";

export interface Furniture {
  id: string;
  kind: FurnitureKind;
  x: number;
  y: number;
  w: number;
  d: number;
  /** For desks: the side the seat is on. For seating furniture: the way it faces. */
  dir: Facing;
  color?: number;
}

export interface Seat {
  id: string;
  x: number;
  y: number;
  facing: Facing;
  room: string;
  role?: "ceo" | "manager";
  desk: string;
}

export interface FloorLayout {
  division: DivisionId;
  cols: number;
  rows: number;
  rooms: Room[];
  walls: WallSeg[];
  furniture: Furniture[];
  seats: Seat[];
  lounge: string;
}

export const FACING_VEC: Record<Facing, { dx: number; dy: number }> = {
  se: { dx: 1, dy: 0 },
  nw: { dx: -1, dy: 0 },
  sw: { dx: 0, dy: 1 },
  ne: { dx: 0, dy: -1 },
};

export function opposite(f: Facing): Facing {
  return f === "se" ? "nw" : f === "nw" ? "se" : f === "sw" ? "ne" : "sw";
}

export const NON_BLOCKING: ReadonlySet<FurnitureKind> = new Set(["rug"]);
