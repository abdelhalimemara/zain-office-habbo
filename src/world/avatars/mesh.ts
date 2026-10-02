import { lighten, shade } from "./color";
import { GRID_XY, OFF_XY, OFF_Z, type VoxelGrid } from "./raster";

/** Screen rise per voxel of height relative to one voxel step along x (matches the floors' Z_UNIT / half tile width). */
export const Z_SCALE = 38 / 32;

export const LIGHT = { top: 0.17, left: 0, right: -0.27 } as const;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Visible voxel faces as screen quads (in voxel units), back to front. */
export interface Mesh extends Bounds {
  count: number;
  pts: Float32Array;
  colors: Uint32Array;
  /** Painter's depth (x + y + z of the source voxel) per quad, non-decreasing. */
  depth: Int16Array;
}

export function project(x: number, y: number, z: number): { x: number; y: number } {
  return { x: x - y, y: (x + y) / 2 - z * Z_SCALE };
}

/**
 * Extract the faces a viewer looking from +x+y+z can see (top, +y "left" face, +x "right" face)
 * and order them by x+y+z so nearer voxels paint over farther ones.
 */
export function meshOf(grid: VoxelGrid): Mesh {
  const [x0, y0, z0] = grid.min as [number, number, number];
  const [x1, y1, z1] = grid.max as [number, number, number];
  const buckets: number[][] = [];
  for (let z = z0; z <= z1; z++) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const v = grid.data[(z * GRID_XY + y) * GRID_XY + x]!;
        if (!v) continue;
        const open = (grid.get(x, y, z + 1) ? 0 : 1) | (grid.get(x, y + 1, z) ? 0 : 2) | (grid.get(x + 1, y, z) ? 0 : 4);
        if (!open) continue;
        const s = x + y + z;
        (buckets[s] ??= []).push(x, y, z, open);
      }
    }
  }
  let count = 0;
  for (const b of buckets) if (b) for (let i = 3; i < b.length; i += 4) count += popcount(b[i]!);
  const pts = new Float32Array(count * 8);
  const colors = new Uint32Array(count);
  const depth = new Int16Array(count);
  let n = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const put = (col: number, c: readonly number[], s: number) => {
    depth[n] = s;
    for (let k = 0; k < 4; k++) {
      const wx = c[k * 3]! - OFF_XY;
      const wy = c[k * 3 + 1]! - OFF_XY;
      const wz = c[k * 3 + 2]! - OFF_Z;
      const sx = wx - wy;
      const sy = (wx + wy) / 2 - wz * Z_SCALE;
      pts[n * 8 + k * 2] = sx;
      pts[n * 8 + k * 2 + 1] = sy;
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }
    colors[n++] = col;
  };
  for (const b of buckets) {
    if (!b) continue;
    for (let i = 0; i < b.length; i += 4) {
      const x = b[i]!;
      const y = b[i + 1]!;
      const z = b[i + 2]!;
      const open = b[i + 3]!;
      const s = x + y + z - 2 * OFF_XY - OFF_Z;
      const col = grid.data[(z * GRID_XY + y) * GRID_XY + x]! - 1;
      if (open & 2) put(shade(col, LIGHT.left), [x, y + 1, z, x + 1, y + 1, z, x + 1, y + 1, z + 1, x, y + 1, z + 1], s);
      if (open & 4) put(shade(col, LIGHT.right), [x + 1, y, z, x + 1, y + 1, z, x + 1, y + 1, z + 1, x + 1, y, z + 1], s);
      if (open & 1) put(lighten(col, LIGHT.top), [x, y, z + 1, x + 1, y, z + 1, x + 1, y + 1, z + 1, x, y + 1, z + 1], s);
    }
  }
  return { count, pts, colors, depth, minX, minY, maxX, maxY };
}

function popcount(v: number): number {
  return (v & 1) + ((v >> 1) & 1) + ((v >> 2) & 1);
}
