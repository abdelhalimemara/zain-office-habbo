import type { Pt } from "../iso";
import { tilesOf } from "./builder";
import type { FloorPlan, PlanSeat } from "./types";

export interface WalkGrid {
  cols: number;
  rows: number;
  blocked: Uint8Array;
  /** Edge keys `${x},${y}` → wall between tile (x, y-1)/(x, y) ("h") or (x-1, y)/(x, y) ("v"). */
  wallH: Set<string>;
  wallV: Set<string>;
}

const cache = new WeakMap<FloorPlan, WalkGrid>();

export function walkGrid(plan: FloorPlan): WalkGrid {
  const hit = cache.get(plan);
  if (hit) return hit;
  const { cols, rows } = plan;
  const blocked = new Uint8Array(cols * rows);
  for (const it of plan.items) {
    if (!it.solid) continue;
    for (const key of tilesOf(it)) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      if (x >= 0 && y >= 0 && x < cols && y < rows) blocked[y * cols + x] = 1;
    }
  }
  const wallH = new Set<string>();
  const wallV = new Set<string>();
  for (const w of plan.walls) {
    for (let i = w.from; i < w.to; i++) {
      if (w.axis === "x") wallH.add(`${i},${w.at}`);
      else wallV.add(`${w.at},${i}`);
    }
  }
  const grid = { cols, rows, blocked, wallH, wallV };
  cache.set(plan, grid);
  return grid;
}

export function isWalkable(grid: WalkGrid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.cols && y < grid.rows && !grid.blocked[y * grid.cols + x];
}

function crossesWall(grid: WalkGrid, x: number, y: number, nx: number, ny: number): boolean {
  if (nx !== x && ny !== y) {
    return crossesWall(grid, x, y, nx, y) || crossesWall(grid, nx, y, nx, ny) || crossesWall(grid, x, y, x, ny) || crossesWall(grid, x, ny, nx, ny);
  }
  if (nx !== x) return grid.wallV.has(`${Math.max(x, nx)},${y}`);
  return grid.wallH.has(`${x},${Math.max(y, ny)}`);
}

const STEPS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * A* over walkable tiles (8-connected, no corner cutting past furniture or walls). Returns the tiles from `from` to
 * `to` inclusive, or null. Endpoints may be non-walkable (a seat whose chair is pulled out still counts as floor).
 */
export function findPath(plan: FloorPlan, from: Pt, to: Pt): Pt[] | null {
  const g = walkGrid(plan);
  const { cols, rows } = g;
  const inside = (p: Pt) => p.x >= 0 && p.y >= 0 && p.x < cols && p.y < rows;
  if (!inside(from) || !inside(to)) return null;
  const start = from.y * cols + from.x;
  const goal = to.y * cols + to.x;
  const open = new Map<number, number>([[start, 0]]);
  const cost = new Float64Array(cols * rows).fill(Number.POSITIVE_INFINITY);
  const prev = new Int32Array(cols * rows).fill(-1);
  cost[start] = 0;
  const h = (i: number) => {
    const dx = Math.abs((i % cols) - to.x);
    const dy = Math.abs(Math.floor(i / cols) - to.y);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const pass = (x: number, y: number) => isWalkable(g, x, y) || y * cols + x === goal;
  while (open.size > 0) {
    let cur = -1;
    let best = Number.POSITIVE_INFINITY;
    for (const [i, f] of open) if (f < best) [cur, best] = [i, f];
    open.delete(cur);
    if (cur === goal) break;
    const x = cur % cols;
    const y = (cur - x) / cols;
    for (const [dx, dy, step] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !pass(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!pass(x + dx, y) || !pass(x, y + dy))) continue;
      if (crossesWall(g, x, y, nx, ny)) continue;
      const n = ny * cols + nx;
      const c = cost[cur]! + step;
      if (c < cost[n]!) {
        cost[n] = c;
        prev[n] = cur;
        open.set(n, c + h(n));
      }
    }
  }
  if (prev[goal] === -1 && goal !== start) return null;
  const path: Pt[] = [];
  for (let c = goal; ; c = prev[c]!) {
    path.push({ x: c % cols, y: Math.floor(c / cols) });
    if (c === start) break;
  }
  return path.reverse();
}

/** Where a person's feet go on their seat tile: pushed towards the desk so its front hides their legs. */
export function standPoint(seat: Pick<PlanSeat, "x" | "y" | "facing">): Pt {
  return seat.facing === "+y" ? { x: seat.x + 0.5, y: seat.y + 0.8 } : { x: seat.x + 0.8, y: seat.y + 0.5 };
}

export function tileCenter(p: Pt): Pt {
  return { x: p.x + 0.5, y: p.y + 0.5 };
}
