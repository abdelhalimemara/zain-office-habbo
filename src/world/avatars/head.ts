import { hash3, mix, shade } from "./color";
import { hairShape, type HairShape } from "./hair";
import type { Dims } from "./body";
import type { Paint } from "./raster";
import type { AvatarSpec } from "./types";

/** Margins of the head part box around the head core, room for hair, brims and drapes. */
export const HEAD_MARGIN = { x: 4, back: 6, front: 5, top: 7, below: 12 } as const;

const EYE = 0x161514;
const GOLD = 0xd6a73c;

/**
 * Head paint in head-core coordinates translated by HEAD_MARGIN:
 * x lateral from the character's right, y back to front, z bottom (chin) to top.
 */
export function headPaint(spec: AvatarSpec, d: Dims): Paint {
  const W = d.headW;
  const D = d.headD;
  const H = d.headH;
  const cx = (W - 1) / 2;
  const shape = hairShape(spec.hair.style, W, D, H);
  const brow = spec.brow ?? shade(spec.hair.color, -0.35);
  const facial = spec.facialHair ?? spec.hair.color;
  const acc = new Set(spec.accessories);
  const earY0 = Math.floor(D / 2) - 2;
  const shift = Math.round((H - 15) / 2);
  const eyeH = spec.eyeH ?? 3;
  const earsShow = !["bob", "wavyLong", "lowBun", "bun", "ghutra"].includes(spec.hair.style);
  const lift = (spec.browGap ?? 1) + (acc.has("glassesSquare") || acc.has("glassesRound") ? 1 : 0);
  return (a, b, c) => {
    const x = a - HEAD_MARGIN.x;
    const y = b - HEAD_MARGIN.back;
    const z = c - HEAD_MARGIN.below;
    const inCore = x >= 0 && x < W && y >= 0 && y < D && z >= 0 && z < H;
    const zf = z - shift;
    const dx = Math.abs(x - cx);
    const glasses = glassesAt(acc, x, y, zf, W, D, cx);
    if (glasses >= 0) return glasses;
    const ear = (x === -1 || x === W) && y >= earY0 && y < earY0 + 3 && zf >= 4 && zf < 8;
    if (ear && earsShow) return shade(spec.skin, y === earY0 ? -0.08 : 0);
    const earGap = earsShow && (x < 0 || x >= W) && y >= earY0 - 1 && y < earY0 + 4 && zf >= 3 && zf < 9;
    const hair = earGap ? -1 : hairColor(spec, shape, x, y, z, W, D, H);
    if (hair >= 0) return hair;
    if (!inCore) {
      if (ear) return shade(spec.skin, y === earY0 ? -0.08 : 0);
      if (acc.has("earrings") && (x === -1 || x === W) && y === earY0 + 1 && zf === 3) return GOLD;
      if (acc.has("nose") && y === D && dx < 1 && zf >= 3 && zf < 6) return shade(spec.skin, zf === 3 ? -0.06 : 0.03);
      if (y === D && browAt(dx, zf - lift)) return shade(brow, 0.06);
      if (acc.has("beard") && z === -1 && y >= D - 4 && y < D && dx < 4.5) return beardTone(facial, x, y);
      return -1;
    }
    if (acc.has("beard") && y >= D - 6) {
      const front = y === D - 1;
      const edge = x === 0 || x === W - 1;
      const beard = front
        ? zf <= 1 || (zf === 2 && dx >= 1.5) || (zf === 3 && (dx < 3.5 || dx > 4.5)) || (zf === 4 && edge)
        : edge && zf < 8;
      if (beard) return beardTone(facial, x + y, z);
      if (front && zf === 2) return shade(spec.skin, -0.22);
    }
    if (y === D - 1) {
      if (zf >= 7 - eyeH && zf < 7 && dx >= 3 && dx < 5) return EYE;
      if (browAt(dx, zf - lift)) return brow;
      if (acc.has("moustache") && zf >= 1 && zf <= 2 && dx < 2.6) return facial;
      if (acc.has("stubble") && (zf < 3 || (zf === 3 && (dx < 2.6 || dx > 5))) && hash3(x, z, 7) < 0.85) return mix(spec.skin, facial, 0.5 + hash3(z, x, 9) * 0.3);
    }
    if (acc.has("stubble") && (x === 0 || x === W - 1) && zf < 5 && y >= D - 6 && hash3(y, z, 3) < 0.8) return mix(spec.skin, facial, 0.65);
    return spec.skin;
  };
}

function browAt(dx: number, bz: number): boolean {
  return ((bz === 7 || bz === 8) && dx >= 2.5 && dx < 4) || ((bz === 8 || bz === 9) && dx >= 4 && dx < 6.6);
}

function beardTone(color: number, p: number, q: number): number {
  return shade(color, (hash3(p, q, 11) - 0.5) * 0.1);
}

function glassesAt(acc: Set<string>, x: number, y: number, z: number, W: number, D: number, cx: number): number {
  const square = acc.has("glassesSquare");
  const round = acc.has("glassesRound");
  if (!square && !round) return -1;
  const color = square ? 0x141414 : 0xbfc3c7;
  const top = 7;
  const bottom = 2;
  if (y === (round ? D - 1 : D)) {
    const dx = x - cx;
    const ax = Math.abs(dx);
    if (ax < 1 && z === 6) return color;
    if (ax > 6 && dx > 0 && z === 6) return color;
    if (ax < 1 || ax > 7 || z < bottom || z > top) return -1;
    const edgeX = ax < 2 || ax > 6;
    const edgeZ = z === top || z === bottom;
    if (round && edgeX && edgeZ) return -1;
    return edgeX || edgeZ ? color : -1;
  }
  if (x === W && z === 6 && y >= Math.floor(D / 2) + 1 && y < D) return color;
  return -1;
}

function hairColor(spec: AvatarSpec, s: HairShape, x: number, y: number, z: number, W: number, D: number, H: number): number {
  const hit = s.at(x, y, z);
  if (!hit) return -1;
  const h = spec.hair;
  if (hit === 2) return checkered(h.accent ?? 0xc65e5e, h.accent2 ?? 0xf3e6e3, x, y, z);
  if (hit === 3) return shade(h.color, ((x + y + z) & 1) * 0.08);
  if (hit === 4) return h.accent ?? 0x2b2b2e;
  if (hit === 5) return 0xf2f2f2;
  if (hit === 6) return shade(h.accent ?? 0x2b2b2e, 0.18);
  const streak = (hash3(x, y * 3 + Math.floor(z / 2), 5) - 0.5) * 0.04;
  const lift = z >= H ? 0.04 : y < 0 || x < 0 || x >= W || y >= D ? -0.03 : 0;
  return shade(h.color, streak + lift);
}

function checkered(red: number, white: number, x: number, y: number, z: number): number {
  return ((x + y + z) & 1) === 0 ? red : white;
}
