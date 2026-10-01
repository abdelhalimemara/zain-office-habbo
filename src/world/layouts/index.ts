import type { DivisionId } from "../../../shared/divisions";
import { buildDivisionLayout } from "./division";
import { buildHqLayout } from "./hq";
import type { FloorLayout } from "./types";

const cache = new Map<DivisionId, FloorLayout>();

export function floorLayout(division: DivisionId): FloorLayout {
  let layout = cache.get(division);
  if (!layout) {
    layout = division === "hq" ? buildHqLayout() : buildDivisionLayout(division);
    cache.set(division, layout);
  }
  return layout;
}

export function roomAt(layout: FloorLayout, x: number, y: number) {
  return layout.rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
}

export * from "./types";
