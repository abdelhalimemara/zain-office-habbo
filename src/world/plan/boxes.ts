import { Z_UNIT, screenBounds, sortDepth, type Box, type Rect } from "../iso";
import type { FloorPlan, Item, ItemKind, Wall } from "./types";

/** Height in tiles used for depth sorting and screen bounds. */
export const ITEM_HEIGHT: Record<ItemKind, number> = {
  desk: 0.9, execDesk: 0.9, officeChair: 0.6, execChair: 0.7, chair: 0.55, meetingTable: 0.5, boardTable: 0.5,
  sofa: 0.5, armchair: 0.55, coffeeTable: 0.25, roundTable: 0.5, stool: 0.42, bookcase: 1.9, credenza: 0.6,
  planter: 0.9, plant: 1.3, tv: 1.5, reception: 0.62, counter: 0.62, fridge: 1.6, whiteboard: 1.3, printer: 0.65,
  rack: 2.0, featureWall: 1.7, slatWall: 1.9, rug: 0, foosball: 0.55, stairs: 1.6, shelf: 1.6,
};

export const SEAT_KINDS: ReadonlySet<ItemKind> = new Set(["officeChair", "execChair"]);

/** Sort box: the footprint (pulled-out seat chairs sit on the back half of their tile, behind the person). */
export function itemBox(it: Item): Box {
  const h = ITEM_HEIGHT[it.kind];
  if (SEAT_KINDS.has(it.kind)) {
    return it.facing === "+x"
      ? { x0: it.x + 0.04, y0: it.y + 0.2, x1: it.x + 0.46, y1: it.y + 0.8, h }
      : { x0: it.x + 0.2, y0: it.y + 0.04, x1: it.x + 0.8, y1: it.y + 0.46, h };
  }
  const i = 0.03;
  return { x0: it.x + i, y0: it.y + i, x1: it.x + it.w - i, y1: it.y + it.d - i, h };
}

export const BACK_WALL_H = 2.3;
export const WALL_H = 1.25;
export const GLASS_H = 1.35;
export const PARAPET_H = 0.35;
const T = 0.08;

export function isBackWall(w: Wall): boolean {
  return w.at === 0 && w.kind === "solid";
}

/** Interior walls are split into one-tile pieces so people sort correctly beside them. */
export function wallPieces(walls: readonly Wall[]): Wall[] {
  const out: Wall[] = [];
  for (const w of walls) {
    if (isBackWall(w)) continue;
    for (let i = w.from; i < w.to; i++) out.push({ ...w, from: i, to: i + 1 });
  }
  return out;
}

function wallHeight(w: Wall): number {
  return w.kind === "glass" ? GLASS_H : w.kind === "parapet" ? PARAPET_H : WALL_H;
}

export function wallBox(w: Wall): Box {
  const h = wallHeight(w);
  return w.axis === "x"
    ? { x0: w.from, y0: w.at - T, x1: w.to, y1: w.at + T, h }
    : { x0: w.at - T, y0: w.from, x1: w.at + T, y1: w.to, h };
}

/** Standing height of a person in scene pixels (1.7 tiles). */
export const PERSON_H = 1.7 * Z_UNIT;
/** Smallest on-screen person height (css px) the auto-fit allows before cropping the floor and letting the user pan. */
export const MIN_PERSON_CSS = 40;
const FIT_FILL = 0.95;

/** Scene-pixel bounds of a plan (floor, slab and back walls). */
export function planBounds(plan: FloorPlan): Rect {
  const b = screenBounds({ x0: -0.2, y0: -0.2, x1: plan.cols, y1: plan.rows, h: BACK_WALL_H });
  return { x: b.x - 8, y: b.y - 8, w: b.w + 16, h: b.h + 20 };
}

/** Fit rectangle: the whole floor, or a centred crop when the whole floor would make people smaller than readable. */
export function fitBounds(full: Rect, area: { w: number; h: number } | undefined): Rect {
  if (!area) return full;
  const minScale = MIN_PERSON_CSS / PERSON_H;
  const w = Math.min(full.w, area.w / (minScale * FIT_FILL));
  const h = Math.min(full.h, area.h / (minScale * FIT_FILL));
  return { x: full.x + (full.w - w) / 2, y: full.y + (full.h - h) / 2, w, h };
}


/** A person's sort box around their feet (tile space). */
export function personBox(tx: number, ty: number): Box {
  return { x0: tx - 0.17, y0: ty - 0.12, x1: tx + 0.17, y1: ty + 0.12, h: 1.7 };
}


export type Static = { kind: "item"; item: Item; box: Box; depth: number } | { kind: "wall"; wall: Wall; box: Box; depth: number };

/** Every static object of a floor (furniture and interior wall pieces) with its draw-order rank. */
export function rankStatics(plan: FloorPlan): Static[] {
  const entries: (Omit<Extract<Static, { kind: "item" }>, "depth"> | Omit<Extract<Static, { kind: "wall" }>, "depth">)[] = [
    ...plan.items.filter((i) => i.kind !== "rug").map((item) => ({ kind: "item" as const, item, box: itemBox(item) })),
    ...wallPieces(plan.walls).map((wall) => ({ kind: "wall" as const, wall, box: wallBox(wall) })),
  ];
  const depths = sortDepth(entries.map((e) => e.box));
  return entries.map((e, i) => ({ ...e, depth: depths[i]! }) as Static);
}
