import type { Pt } from "./iso";
import { NON_BLOCKING, type FloorLayout, type Room } from "./layouts/types";
import { roomAt } from "./layouts";

export interface Grid {
  cols: number;
  rows: number;
  blocked: Uint8Array;
  wallX: Set<string>;
  wallY: Set<string>;
}

const gridCache = new WeakMap<FloorLayout, Grid>();

export function walkGrid(layout: FloorLayout): Grid {
  const cached = gridCache.get(layout);
  if (cached) return cached;
  const { cols, rows } = layout;
  const blocked = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) if (!roomAt(layout, x, y)) blocked[y * cols + x] = 1;
  }
  for (const f of layout.furniture) {
    if (NON_BLOCKING.has(f.kind)) continue;
    for (let y = f.y; y < f.y + f.d; y++) for (let x = f.x; x < f.x + f.w; x++) blocked[y * cols + x] = 1;
  }
  const wallX = new Set<string>();
  const wallY = new Set<string>();
  for (const w of layout.walls) {
    for (let i = w.from; i < w.to; i++) (w.axis === "x" ? wallX : wallY).add(`${i},${w.at}`);
  }
  const grid = { cols, rows, blocked, wallX, wallY };
  gridCache.set(layout, grid);
  return grid;
}

export function isFree(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.cols && y < grid.rows && !grid.blocked[y * grid.cols + x];
}

function crossesWall(grid: Grid, x: number, y: number, nx: number, ny: number): boolean {
  if (nx !== x) return grid.wallY.has(`${y},${Math.max(x, nx)}`);
  return grid.wallX.has(`${x},${Math.max(y, ny)}`);
}

const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Shortest 4-connected path of tiles from `from` to `to` (inclusive), or null. Endpoints may be seat tiles. */
export function findPath(layout: FloorLayout, from: Pt, to: Pt): Pt[] | null {
  const grid = walkGrid(layout);
  const { cols, rows } = grid;
  const start = from.y * cols + from.x;
  const goal = to.y * cols + to.x;
  if (from.x < 0 || from.y < 0 || from.x >= cols || from.y >= rows) return null;
  if (to.x < 0 || to.y < 0 || to.x >= cols || to.y >= rows) return null;
  const prev = new Int32Array(cols * rows).fill(-1);
  prev[start] = start;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!;
    if (cur === goal) break;
    const x = cur % cols;
    const y = (cur - x) / cols;
    for (const [dx, dy] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const n = ny * cols + nx;
      if (prev[n] !== -1) continue;
      if (n !== goal && grid.blocked[n]) continue;
      if (crossesWall(grid, x, y, nx, ny)) continue;
      prev[n] = cur;
      queue.push(n);
    }
  }
  if (prev[goal] === -1) return null;
  const path: Pt[] = [];
  for (let c = goal; ; c = prev[c]!) {
    path.push({ x: c % cols, y: Math.floor(c / cols) });
    if (c === start) break;
  }
  return path.reverse();
}

export function freeTilesIn(layout: FloorLayout, room: Room, reserved: ReadonlySet<string> = new Set()): Pt[] {
  const grid = walkGrid(layout);
  const out: Pt[] = [];
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (isFree(grid, x, y) && !reserved.has(`${x},${y}`)) out.push({ x, y });
    }
  }
  return out;
}

export function loungeTiles(layout: FloorLayout): Pt[] {
  const room = layout.rooms.find((r) => r.id === layout.lounge);
  if (!room) return [];
  const seats = new Set(layout.seats.map((s) => `${s.x},${s.y}`));
  return freeTilesIn(layout, room, seats);
}

export function wanderTarget(layout: FloorLayout, rand: () => number, avoid?: Pt): Pt | null {
  const tiles = loungeTiles(layout).filter((t) => !avoid || t.x !== avoid.x || t.y !== avoid.y);
  if (tiles.length === 0) return null;
  return tiles[Math.floor(rand() * tiles.length) % tiles.length]!;
}

/** Deterministic resting spot in the lounge for the n-th idle agent. */
export function loungeSpot(layout: FloorLayout, n: number): Pt | null {
  const tiles = loungeTiles(layout);
  if (tiles.length === 0) return null;
  const stride = 7;
  return tiles[(n * stride) % tiles.length]!;
}
