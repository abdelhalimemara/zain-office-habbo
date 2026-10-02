import type { DivisionId } from "../../../shared/divisions";

export type Material = "oak" | "walnut" | "marble" | "stone" | "carpet" | "carpetDark";

/** Floor finish over a rectangle of tiles. */
export interface Zone {
  x: number;
  y: number;
  w: number;
  d: number;
  material: Material;
}

export type WallKind = "solid" | "glass" | "parapet";

/** axis "x": runs along x on the edge y = at; axis "y": runs along y on the edge x = at. */
export interface Wall {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
  kind: WallKind;
}

export type ItemKind =
  | "desk"
  | "execDesk"
  | "officeChair"
  | "execChair"
  | "chair"
  | "meetingTable"
  | "boardTable"
  | "sofa"
  | "armchair"
  | "coffeeTable"
  | "roundTable"
  | "stool"
  | "bookcase"
  | "credenza"
  | "planter"
  | "plant"
  | "tv"
  | "reception"
  | "counter"
  | "fridge"
  | "whiteboard"
  | "printer"
  | "rack"
  | "featureWall"
  | "slatWall"
  | "rug"
  | "foosball"
  | "stairs"
  | "shelf";

/** Direction an item faces (seating, screens) or its open side; "+y" faces the viewer's lower-left. */
export type Dir = "+x" | "-x" | "+y" | "-y";

export interface Item {
  id: string;
  kind: ItemKind;
  x: number;
  y: number;
  w: number;
  d: number;
  facing: Dir;
  /** Blocks walking; chairs pulled out behind a seat and rugs don't. */
  solid: boolean;
  color?: number;
  label?: string;
}

export type SeatRole = "ceo" | "manager" | "board";

/** Where a seated avatar's hips go: a tile-space point on a chair or sofa cushion, the way they face, the seat height. */
export interface SitPoint {
  x: number;
  y: number;
  facing: Dir;
  /** Seat top above the floor, in tiles of height. */
  height: number;
  /** The chair or sofa item. */
  item: string;
}

/**
 * A place a person works. They stand on tile (x, y) facing `facing`, with the desk or table on the next tile in that
 * direction, so its front hides their legs.
 */
export interface PlanSeat {
  id: string;
  x: number;
  y: number;
  facing: "+x" | "+y";
  role?: SeatRole;
  /** HQ department (see HQ_TEAMS), a Studio / Growth unit (shared/units.ts), or "platform" for the Tech VP's shared specialists. */
  team?: string;
  /** Index into `FloorPlan.pods` for team-pod seats. */
  pod?: number;
  /** One of the two lead seats at the head of a pod (Head Engineer, then Project Manager). */
  lead?: boolean;
  /** The desk or table in front of the seat (1 tile ahead, or 2 when a chair stands between). */
  desk: string;
  /** Tiles from the seat to the desk along `facing`. */
  reach: 1 | 2;
  /** The chair this person sits on when seated. */
  sit: SitPoint;
}

/** A bounded team zone on a floor, in tiles. */
export interface Pod {
  index: number;
  team: string | null;
  label: string;
  x: number;
  y: number;
  w: number;
  d: number;
}

/** A cushion on a sofa or armchair where an idle person can sit. */
export interface SofaSeat extends SitPoint {
  id: string;
}

export interface Spot {
  id: string;
  x: number;
  y: number;
}

export interface RoomPlate {
  text: string;
  x: number;
  y: number;
  /** Set on a team pod's name plate. */
  pod?: number;
}

export interface FloorPlan {
  division: DivisionId;
  cols: number;
  rows: number;
  zones: readonly Zone[];
  walls: readonly Wall[];
  items: readonly Item[];
  seats: readonly PlanSeat[];
  /** Free floor tiles next to sofas, café tables and counters where idle people rest. */
  idle: readonly Spot[];
  plates: readonly RoomPlate[];
  sofaSeats: readonly SofaSeat[];
  /** Team pods (Zain Tech); a pod with `team: null` is a spare slot for teams added at runtime. */
  pods: readonly Pod[];
}

export const DIR_VEC: Record<Dir, { dx: number; dy: number }> = {
  "+x": { dx: 1, dy: 0 },
  "-x": { dx: -1, dy: 0 },
  "+y": { dx: 0, dy: 1 },
  "-y": { dx: 0, dy: -1 },
};
