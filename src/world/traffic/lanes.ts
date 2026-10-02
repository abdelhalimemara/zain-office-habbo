import type { Pt } from "../iso";
import { curve } from "./path";

/**
 * Car routes over the city diorama, in image pixels. The car art has a single angle (front to the lower
 * left), so every route only ever heads towards the viewer: down-left as drawn, down-right mirrored.
 * Edge roads are one-way; the inner roads use their right-hand lane and turn onto an edge road.
 */
export interface RouteDef {
  id: string;
  points: readonly Pt[];
  /** Crosswalks the route passes over, as points on or next to it. */
  crosswalks: readonly Pt[];
  /** Relative spawn frequency. */
  weight: number;
}

/** Spots where two routes cross or merge: one car at a time. */
export interface ConflictZone {
  x: number;
  y: number;
  r: number;
}

const pts = (coords: readonly (readonly [number, number])[]): Pt[] => coords.map(([x, y]) => ({ x, y }));

/** Front-right edge road, far lane. */
const C1_LANE = pts([[1872, 1278], [1750, 1330], [1650, 1378], [1550, 1424], [1416, 1478], [1219, 1575], [1045, 1662]]);
/** Front-right edge road, near lane. */
const C2_LANE = pts([[1876, 1304], [1750, 1358], [1650, 1406], [1550, 1452], [1416, 1506], [1219, 1605], [1055, 1688]]);
/** Front-left edge road along the slab rim (one lane). */
const A_LANE = pts([[50, 1322], [150, 1355], [300, 1414], [500, 1496], [650, 1553], [770, 1603], [850, 1638], [960, 1680]]);

/** Inner road between the back row and Studio, passing behind Tech, then right onto C. */
const N1_HEAD = pts([[600, 1123], [767, 1186], [960, 1258], [1100, 1300], [1268, 1346], [1420, 1408]]);
const N1_TURN = curve({ x: 1420, y: 1408 }, { x: 1500, y: 1440 }, { x: 1440, y: 1468 });

/** Inner road from behind Labs, behind Tech, out past Studio, then left onto A. */
const N2_HEAD = pts([[1340, 1126], [1150, 1216], [975, 1368], [876, 1416], [720, 1492]]);
const N2_TURN = curve({ x: 720, y: 1492 }, { x: 624, y: 1539 }, { x: 770, y: 1603 });

const after = (lane: readonly Pt[], x: number, dir: 1 | -1): Pt[] => lane.filter((p) => (p.x - x) * dir > 0);

export const ROUTES: readonly RouteDef[] = [
  { id: "c-far", points: C1_LANE, crosswalks: pts([[1122, 1642]]), weight: 1 },
  { id: "c-near", points: C2_LANE, crosswalks: pts([[1122, 1642]]), weight: 1 },
  { id: "a", points: A_LANE, crosswalks: pts([[690, 1560]]), weight: 1.1 },
  {
    id: "inner-1",
    points: [...N1_HEAD, ...N1_TURN, ...after(C1_LANE, 1440, -1)],
    crosswalks: pts([[1455, 1420], [1122, 1642]]),
    weight: 0.8,
  },
  {
    id: "inner-2",
    points: [...N2_HEAD, ...N2_TURN, ...after(A_LANE, 770, 1)],
    crosswalks: pts([[1200, 1205], [680, 1525]]),
    weight: 0.8,
  },
];

export const CONFLICT_ZONES: readonly ConflictZone[] = [
  { x: 1065, y: 1290, r: 30 },
  { x: 1450, y: 1456, r: 32 },
  { x: 705, y: 1568, r: 46 },
];
