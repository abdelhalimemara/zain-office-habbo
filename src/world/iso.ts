export const TILE_W = 32;
export const TILE_H = 16;
const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Footprint in tile space [x0,x1]×[y0,y1] with a height in pixels. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  h: number;
}

export function toScreen(tx: number, ty: number, z = 0): Pt {
  return { x: (tx - ty) * HALF_W, y: (tx + ty) * HALF_H - z };
}

export function toTile(sx: number, sy: number): Pt {
  const a = sx / HALF_W;
  const b = sy / HALF_H;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

export function tileCenter(tx: number, ty: number): Pt {
  return toScreen(tx + 0.5, ty + 0.5);
}

export function depthKey(tx: number, ty: number): number {
  return tx + ty;
}

export function screenBounds(b: Box): Rect {
  const minX = (b.x0 - b.y1) * HALF_W;
  const maxX = (b.x1 - b.y0) * HALF_W;
  const minY = (b.x0 + b.y0) * HALF_H - b.h;
  const maxY = (b.x1 + b.y1) * HALF_H;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const EPS = 1e-6;

/** -1 when a must be drawn before b, 1 when after, 0 when unrelated. */
export function compareBoxes(a: Box, b: Box): number {
  if (!rectsOverlap(screenBounds(a), screenBounds(b))) return 0;
  if (a.x1 <= b.x0 + EPS || a.y1 <= b.y0 + EPS) return -1;
  if (b.x1 <= a.x0 + EPS || b.y1 <= a.y0 + EPS) return 1;
  const ca = a.x0 + a.x1 + a.y0 + a.y1;
  const cb = b.x0 + b.x1 + b.y0 + b.y1;
  if (Math.abs(ca - cb) > EPS) return ca < cb ? -1 : 1;
  return 0;
}

/** Topological draw order: returns a depth rank per box (0 = drawn first). */
export function sortDepth(boxes: readonly Box[]): number[] {
  const n = boxes.length;
  const behind: number[][] = boxes.map(() => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = compareBoxes(boxes[i]!, boxes[j]!);
      if (c < 0) behind[j]!.push(i);
      else if (c > 0) behind[i]!.push(j);
    }
  }
  const order = boxes
    .map((b, i) => ({ i, k: b.x1 + b.y1 }))
    .sort((p, q) => p.k - q.k || p.i - q.i)
    .map((p) => p.i);
  const depth = new Array<number>(n).fill(-1);
  const visiting = new Uint8Array(n);
  let next = 0;
  const visit = (i: number): void => {
    if (depth[i]! >= 0 || visiting[i]) return;
    visiting[i] = 1;
    for (const j of behind[i]!) visit(j);
    depth[i] = next++;
  };
  for (const i of order) visit(i);
  return depth;
}

export interface Ranked {
  box: Box;
  depth: number;
}

/** zIndex for a moving object placed among statically ranked boxes. */
export function dynamicDepth(statics: readonly Ranked[], box: Box): number {
  let lo = -1;
  let hi = Number.POSITIVE_INFINITY;
  for (const s of statics) {
    const c = compareBoxes(s.box, box);
    if (c < 0) lo = Math.max(lo, s.depth);
    else if (c > 0) hi = Math.min(hi, s.depth);
  }
  const tie = ((box.x1 + box.y1) % 200) / 1000;
  const z = lo + 0.3 + tie;
  return z < hi ? z : hi - 0.5 + tie / 4;
}

export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Screen-space silhouette of an extruded footprint (6 points). */
export function boxHull(b: Box): Pt[] {
  const top = toScreen(b.x0, b.y0, b.h);
  const right = toScreen(b.x1, b.y0);
  const rightUp = toScreen(b.x1, b.y0, b.h);
  const bottom = toScreen(b.x1, b.y1);
  const left = toScreen(b.x0, b.y1);
  const leftUp = toScreen(b.x0, b.y1, b.h);
  return [top, rightUp, right, bottom, left, leftUp];
}
