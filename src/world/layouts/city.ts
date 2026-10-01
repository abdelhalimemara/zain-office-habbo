import type { DivisionId } from "../../../shared/divisions";
import type { Pt } from "../iso";

export const CITY_SIZE = 36;

export type CityTile = "road" | "junction" | "crosswalk" | "sidewalk" | "plaza" | "grass" | "water" | "dock" | "sand";

export interface CityBuilding {
  division: DivisionId;
  name: string;
  x: number;
  y: number;
  w: number;
  d: number;
  height: number;
}

export type PropKind = "tree" | "palm" | "lamp" | "fountain" | "bench" | "bush" | "boat";

export interface CityProp {
  kind: PropKind;
  x: number;
  y: number;
  w: number;
  d: number;
}

export interface PedLoop {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const ROAD_LINES = [11, 12, 23, 24];
const BLOCKS: [number, number][] = [
  [0, 10],
  [13, 22],
  [25, 35],
];

export const CITY_BUILDINGS: readonly CityBuilding[] = [
  { division: "hq", name: "ZAIN GROUP", x: 15, y: 15, w: 5, d: 5, height: 236 },
  { division: "studio", name: "ZAIN STUDIO", x: 3, y: 15, w: 5, d: 5, height: 104 },
  { division: "growth", name: "ZAIN GROWTH", x: 15, y: 3, w: 5, d: 5, height: 112 },
  { division: "labs", name: "ZAIN LABS", x: 15, y: 27, w: 5, d: 5, height: 96 },
  { division: "tech", name: "ZAIN TECH", x: 27, y: 15, w: 5, d: 5, height: 120 },
];

function isRoad(n: number): boolean {
  return ROAD_LINES.includes(n);
}

function isWaterBlock(x: number, y: number): boolean {
  return x >= 28 && y >= 28;
}

function onBlockEdge(n: number): boolean {
  return BLOCKS.some(([a, b]) => n === a || n === b);
}

export function cityTileAt(x: number, y: number): CityTile {
  const rx = isRoad(x);
  const ry = isRoad(y);
  if (rx && ry) return "junction";
  if (rx || ry) {
    const along = rx ? y : x;
    return isRoad(along - 1) || isRoad(along + 1) ? "crosswalk" : "road";
  }
  if (isWaterBlock(x, y)) {
    if (x >= 30 && x <= 31 && y <= 32) return "dock";
    return "water";
  }
  if (x >= 25 && y >= 25 && (x === 27 || y === 27)) return "sand";
  if (onBlockEdge(x) || onBlockEdge(y)) return "sidewalk";
  if (x >= 13 && x <= 22 && y >= 13 && y <= 22) return "plaza";
  return "grass";
}

function propsList(): CityProp[] {
  const props: CityProp[] = [{ kind: "fountain", x: 20, y: 20, w: 2, d: 2 }];
  const one = (kind: PropKind, x: number, y: number) => props.push({ kind, x, y, w: 1, d: 1 });

  for (const [x, y] of [[2, 2], [5, 2], [8, 3], [3, 5], [7, 7], [2, 8], [5, 8]] as const) one("tree", x, y);
  for (const [x, y] of [[27, 2], [30, 3], [33, 2], [28, 6], [32, 7], [29, 9]] as const) one("tree", x, y);
  for (const [x, y] of [[2, 27], [5, 29], [8, 27], [3, 32], [7, 33], [9, 30]] as const) one("palm", x, y);
  for (const [x, y] of [[26, 26], [26, 30], [30, 26], [26, 33], [33, 26]] as const) one("palm", x, y);
  for (const [x, y] of [[4, 4], [33, 5], [5, 31]] as const) one("bench", x, y);
  for (const [x, y] of [[14, 14], [21, 14], [14, 21], [17, 21], [21, 17]] as const) one("bush", x, y);
  for (const [x, y] of [[1, 14], [9, 14], [1, 21], [9, 21], [26, 14], [34, 14], [26, 21], [34, 21]] as const) one("tree", x, y);
  for (const [x, y] of [[14, 1], [21, 1], [14, 9], [21, 9], [14, 26], [21, 26], [14, 34], [21, 34]] as const) one("tree", x, y);

  for (const n of [10, 13, 22, 25]) {
    for (const m of [2, 8, 16, 19, 28, 33]) {
      if (cityTileAt(n, m) === "sidewalk") one("lamp", n, m);
      if (cityTileAt(m, n) === "sidewalk") one("lamp", m, n);
    }
  }
  one("boat", 33, 31);
  return props;
}

export const CITY_PROPS: readonly CityProp[] = propsList();

export const PED_LOOPS: readonly PedLoop[] = [
  { x0: 13, y0: 13, x1: 22, y1: 22 },
  { x0: 0, y0: 13, x1: 10, y1: 22 },
  { x0: 13, y0: 0, x1: 22, y1: 10 },
  { x0: 13, y0: 25, x1: 22, y1: 35 },
  { x0: 25, y0: 13, x1: 35, y1: 22 },
];

/** Position (tile centre coordinates) along the sidewalk ring of a block, t in [0, 1). */
export function pointOnLoop(loop: PedLoop, t: number): Pt & { dir: "x" | "y"; sign: 1 | -1 } {
  const w = loop.x1 - loop.x0;
  const h = loop.y1 - loop.y0;
  const per = 2 * (w + h);
  let d = (((t % 1) + 1) % 1) * per;
  const cx = loop.x0 + 0.5;
  const cy = loop.y0 + 0.5;
  if (d < w) return { x: cx + d, y: cy, dir: "x", sign: 1 };
  d -= w;
  if (d < h) return { x: cx + w, y: cy + d, dir: "y", sign: 1 };
  d -= h;
  if (d < w) return { x: cx + w - d, y: cy + h, dir: "x", sign: -1 };
  d -= w;
  return { x: cx, y: cy + h - d, dir: "y", sign: -1 };
}

export function loopLength(loop: PedLoop): number {
  return 2 * (loop.x1 - loop.x0 + (loop.y1 - loop.y0));
}
