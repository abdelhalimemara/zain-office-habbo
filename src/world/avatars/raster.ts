import { noisy, shade } from "./color";

/** Rigid transform: rotation rows r00..r22 then translation (tx, ty, tz). Axes: i lateral, j forward, k up. */
export type Mat = Float64Array;

export function identity(): Mat {
  return Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0);
}

/** a∘b: apply b, then a. */
export function mul(a: Mat, b: Mat): Mat {
  const o = new Float64Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!;
    o[9 + r] = a[r * 3]! * b[9]! + a[r * 3 + 1]! * b[10]! + a[r * 3 + 2]! * b[11]! + a[9 + r]!;
  }
  return o;
}

export function translate(x: number, y: number, z: number): Mat {
  return Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1, x, y, z);
}

const RAD = Math.PI / 180;
const clean = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);

/** Positive pitch swings a hanging limb's far end forward (+j). */
export function pitch(deg: number): Mat {
  const c = clean(Math.cos(deg * RAD));
  const s = clean(Math.sin(deg * RAD));
  return Float64Array.of(1, 0, 0, 0, c, -s, 0, s, c, 0, 0, 0);
}

/** Positive roll swings a hanging limb's far end towards `side` (-1 right, +1 left). */
export function roll(deg: number, side: number): Mat {
  const c = clean(Math.cos(deg * RAD));
  const s = clean(Math.sin(deg * RAD)) * side;
  return Float64Array.of(c, 0, -s, 0, 1, 0, s, 0, c, 0, 0, 0);
}

/** Rotation about the vertical axis; positive turns forward (+j) towards -i. */
export function yaw(deg: number): Mat {
  const c = clean(Math.cos(deg * RAD));
  const s = clean(Math.sin(deg * RAD));
  return Float64Array.of(c, -s, 0, s, c, 0, 0, 0, 1, 0, 0, 0);
}

export type Paint = (a: number, b: number, c: number) => number;

export interface Part {
  w: number;
  d: number;
  h: number;
  /** Local box (0..w, 0..d, 0..h) to model space. */
  m: Mat;
  paint: Paint;
  seed: number;
  noise?: number;
  /** Cache the painted volume under this owner and key (paint must be pure for them). */
  owner?: object;
  key?: string;
}

const volumes = new WeakMap<object, Map<string, Int32Array>>();

/** The part's lit, noisy colours per local voxel (colour + 1, 0 when empty). */
export function volumeOf(p: Part): Int32Array {
  const cache = p.owner && p.key ? (volumes.get(p.owner) ?? volumes.set(p.owner, new Map()).get(p.owner)!) : null;
  const hit = cache?.get(p.key!);
  if (hit) return hit;
  const vol = new Int32Array(p.w * p.d * p.h);
  for (let c = 0; c < p.h; c++) {
    const light = p.h >= 6 ? ((c + 0.5) / p.h - 0.65) * 0.09 : 0;
    for (let b = 0; b < p.d; b++) {
      for (let a = 0; a < p.w; a++) {
        const col = p.paint(a, b, c);
        if (col < 0) continue;
        vol[(c * p.d + b) * p.w + a] = noisy(light ? shade(col, light) : col, a, b, c, p.seed, p.noise) + 1;
      }
    }
  }
  cache?.set(p.key!, vol);
  return vol;
}

export const GRID_XY = 112;
export const GRID_Z = 112;
export const OFF_XY = 56;
export const OFF_Z = 16;

/** Dense voxel grid in world-facing space; cell value is colour + 1, 0 when empty. */
export class VoxelGrid {
  readonly data = new Int32Array(GRID_XY * GRID_XY * GRID_Z);
  min = [0, 0, 0];
  max = [-1, -1, -1];

  clear(): void {
    this.data.fill(0);
    this.min = [GRID_XY, GRID_XY, GRID_Z];
    this.max = [-1, -1, -1];
  }

  index(x: number, y: number, z: number): number {
    return (z * GRID_XY + y) * GRID_XY + x;
  }

  get(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= GRID_XY || y >= GRID_XY || z >= GRID_Z) return 0;
    return this.data[this.index(x, y, z)]!;
  }

  set(x: number, y: number, z: number, color: number): void {
    this.setRaw(x, y, z, color + 1);
  }

  setRaw(x: number, y: number, z: number, v: number): void {
    if (x < 0 || y < 0 || z < 0 || x >= GRID_XY || y >= GRID_XY || z >= GRID_Z) return;
    this.data[this.index(x, y, z)] = v;
    const { min, max } = this;
    if (x < min[0]!) min[0] = x;
    if (x > max[0]!) max[0] = x;
    if (y < min[1]!) min[1] = y;
    if (y > max[1]!) max[1] = y;
    if (z < min[2]!) min[2] = z;
    if (z > max[2]!) max[2] = z;
  }
}

/** Voxelise a (possibly rotated) box part by sampling its local paint at every covered cell centre. */
export function rasterize(grid: VoxelGrid, p: Part): void {
  const m = p.m;
  const vol = volumeOf(p);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let n = 0; n < 8; n++) {
    const a = n & 1 ? p.w : 0;
    const b = n & 2 ? p.d : 0;
    const c = n & 4 ? p.h : 0;
    for (let r = 0; r < 3; r++) {
      const v = m[r * 3]! * a + m[r * 3 + 1]! * b + m[r * 3 + 2]! * c + m[9 + r]!;
      lo[r] = Math.min(lo[r]!, v);
      hi[r] = Math.max(hi[r]!, v);
    }
  }
  const eps = 1e-6;
  for (let z = Math.floor(lo[2]! + eps); z < Math.ceil(hi[2]! - eps); z++) {
    for (let y = Math.floor(lo[1]! + eps); y < Math.ceil(hi[1]! - eps); y++) {
      for (let x = Math.floor(lo[0]! + eps); x < Math.ceil(hi[0]! - eps); x++) {
        const dx = x + 0.5 - m[9]!;
        const dy = y + 0.5 - m[10]!;
        const dz = z + 0.5 - m[11]!;
        const la = m[0]! * dx + m[3]! * dy + m[6]! * dz;
        const lb = m[1]! * dx + m[4]! * dy + m[7]! * dz;
        const lc = m[2]! * dx + m[5]! * dy + m[8]! * dz;
        if (la < 0 || lb < 0 || lc < 0 || la >= p.w || lb >= p.d || lc >= p.h) continue;
        const v = vol[(Math.floor(lc) * p.d + Math.floor(lb)) * p.w + Math.floor(la)]!;
        if (v) grid.setRaw(x + OFF_XY, y + OFF_XY, z + OFF_Z, v);
      }
    }
  }
}
