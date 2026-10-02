import { mix, shade } from "./color";
import type { Paint } from "./raster";
import type { AvatarSpec, BodySpec } from "./types";

export type Dims = Required<BodySpec>;

const DEFAULT_BODY: Dims = {
  torsoW: 16,
  torsoD: 8,
  torsoH: 25,
  thighW: 7,
  hipX: 4.5,
  shinW: 7,
  legD: 6,
  thighLen: 16,
  shinLen: 17,
  armW: 3,
  armD: 7,
  upperArm: 15,
  foreArm: 17,
  headW: 16,
  headD: 12,
  headH: 17,
};

export const SHOE_H = 4;
export const HAND_H = 4;

export function bodyOf(spec: AvatarSpec): Dims {
  const d = { ...DEFAULT_BODY, ...spec.body };
  const joined = spec.bottom.kind === "skirt" || spec.bottom.kind === "robe";
  if (spec.body?.hipX === undefined) d.hipX = d.thighW / 2 + (joined ? 0 : 1);
  return d;
}

const SILVER = 0xc9cbcf;
const has = (spec: AvatarSpec, a: string) => spec.accessories.includes(a as never);

/** Torso box: a lateral from the character's right, b back to front, c bottom to top. */
export function torsoPaint(spec: AvatarSpec, d: Dims): Paint {
  const { torsoW: W, torsoD: D, torsoH: H } = d;
  const t = spec.top;
  const mid = (W - 1) / 2;
  const shirt = t.accent ?? 0xeeeae4;
  const vRows = Math.max(2, Math.round((t.vDepth ?? 0.6) * H));
  const belt = spec.bottom.belt;
  const buckle = spec.bottom.buckle ?? SILVER;
  const beltRow = (a: number, c: number, open: boolean): number => {
    if (belt === undefined || c > 1 || !open) return -1;
    if (Math.abs(a - mid) < 1.5) return Math.abs(a - mid) < 0.6 && c === 0 ? shade(belt, -0.2) : buckle;
    return belt;
  };
  return (a, b, c) => {
    const dx = Math.abs(a - mid);
    const r = H - 1 - c;
    const front = b === D - 1;
    const topFace = c === H - 1;
    if (b === 0 && t.kind !== "dress") {
      if (r === 0 && dx < 2.6 && (t.kind === "suit" || t.kind === "shirt" || t.kind === "blazer")) return t.kind === "shirt" ? shade(t.color, 0.15) : shirt;
      if (r < 2 && dx < 3.6) return shade(t.color, t.kind === "shirt" ? 0.08 : -0.1);
      if (dx < 0.6 && t.kind !== "turtleneck") return shade(t.color, -0.07);
    }
    switch (t.kind) {
      case "suit":
      case "blazer": {
        const hw = 3.1 - (1.2 * Math.min(r, vRows)) / vRows;
        if (topFace && dx < 2.5 && b >= D - 3) return shirt;
        if (!front) return t.color;
        if (r < vRows || (t.vDepth ?? 0) >= 1) {
          if (dx < hw) {
            const bc = beltRow(a, c, true);
            if (bc >= 0) return bc;
            if (t.tie !== undefined && dx < 1 && r >= 1) return r === 1 ? shade(t.tie, 0.08) : t.tie;
            if (r === 0 && dx > 1) return shade(shirt, -0.05);
            return shirt;
          }
          if (dx < hw + 1.5) return shade(t.color, 0.14);
          if (dx < hw + 2.2) return shade(t.color, -0.16);
        }
        if (dx < 0.6 && r >= vRows) return shade(t.color, -0.15);
        if (has(spec, "pocketSquare") && a >= W - 4 && a <= W - 3 && (r === 6 || r === 7) && b === D - 1) return 0xf4f2ee;
        return t.color;
      }
      case "shirt": {
        const bc = beltRow(a, c, true);
        if (bc >= 0) return bc;
        if (front && t.tie !== undefined && dx < 1 && r >= 1) return r === 1 ? shade(t.tie, 0.1) : t.tie;
        if (front && r <= 1 && dx < 3) return shade(t.color, r === 0 ? 0.25 : 0.15);
        if (topFace && dx < 3 && b >= D - 3) return shade(t.color, 0.2);
        if (front && dx < 0.6) return shade(t.color, -0.08);
        if (front && has(spec, "breastPocket") && a >= W - 5 && a <= W - 3 && r >= 5 && r <= 8) {
          return r === 5 ? shade(t.color, -0.12) : shade(t.color, 0.05);
        }
        return t.color;
      }
      case "jacketTee":
      case "overshirt": {
        const open = t.kind === "overshirt" ? 3.5 : 2.6;
        if (topFace && dx < open && b >= D - 3) return dx < 1.5 && b === D - 1 ? spec.skin : shirt;
        if (!front) return t.color;
        if (dx < open) {
          if (r === 0 && dx < 1.5) return spec.skin;
          if (has(spec, "logo") && logoAt(a - mid, r - 5)) return 0x2c3440;
          return shirt;
        }
        if (dx < open + 1) return shade(t.color, 0.12);
        return t.color;
      }
      case "turtleneck": {
        const bc = beltRow(a, c, true);
        if (bc >= 0) return bc;
        return t.color;
      }
      case "dress": {
        const strap = dx >= 3 && dx < 4.5;
        const skinRows = front ? 5 : b === 0 ? 6 : 3;
        if (topFace) return strap ? t.color : spec.skin;
        if (r < skinRows && !strap) return front && r === 4 && dx > 0.6 && dx < 3 ? t.color : spec.skin;
        if (c === 10 || c === 9) {
          if (front && dx < 1.5) return c === 10 && dx < 0.6 ? shade(t.color, -0.3) : SILVER;
          return shade(t.color, -0.18);
        }
        return t.color;
      }
      case "bisht": {
        const trim = t.trim ?? 0xc39a4a;
        if (topFace && dx < 2.5 && b >= D - 4) return shirt;
        if (topFace && dx < 3.5 && b >= D - 5) return trim;
        if (!front) return t.color;
        if (dx < 1.6) return r === 0 ? shade(shirt, -0.06) : shirt;
        if (dx < 2.7) return trim;
        return t.color;
      }
    }
  };
}

const HEM_KINDS = new Set(["suit", "blazer", "jacketTee", "overshirt"]);
export const HEM_H = 4;

export function hasHem(spec: AvatarSpec): boolean {
  return HEM_KINDS.has(spec.top.kind);
}

/** Jacket skirt hanging below the waist, open at the front. */
export function hemPaint(spec: AvatarSpec, d: Dims): Paint {
  const t = spec.top;
  const mid = (d.torsoW - 1) / 2;
  const open = t.kind === "overshirt" ? 3.6 : t.kind === "jacketTee" ? 2.6 : 2.1;
  return (a, b, c) => {
    const dx = Math.abs(a - mid);
    if (dx < open && b >= d.torsoD - 2) return -1;
    if (b === d.torsoD - 1 && dx < open + 1) return shade(t.color, 0.12);
    return c === 0 ? shade(t.color, -0.1) : t.color;
  };
}

/** Small mountain glyph centred on (0, 0) at the top row. */
export function logoAt(x: number, row: number): boolean {
  if (row < 0 || row > 3) return false;
  const ax = Math.abs(x);
  if (row === 0) return ax < 0.6;
  if (row === 1) return ax < 1.6 && ax > 0.4;
  if (row === 2) return ax > 1.4 && ax < 2.6;
  return ax < 3.6;
}

export function neckPaint(spec: AvatarSpec): Paint {
  return () => (spec.top.kind === "turtleneck" ? spec.top.color : spec.skin);
}

export function upperArmPaint(spec: AvatarSpec, d: Dims): Paint {
  const t = spec.top;
  const sleeve = t.sleeve ?? (t.kind === "dress" ? "none" : t.kind === "overshirt" ? "short" : "long");
  return (_a, _b, c) => {
    if (sleeve === "none") return spec.skin;
    if (sleeve === "short" && c === 0) return shade(t.color, 0.12);
    if (sleeve === "short" && c < 2 && d.upperArm > 6) return shade(t.color, 0.05);
    return t.color;
  };
}

export function foreArmPaint(spec: AvatarSpec): Paint {
  const t = spec.top;
  const sleeve = t.sleeve ?? (t.kind === "dress" ? "none" : t.kind === "overshirt" ? "short" : "long");
  const shirt = t.accent ?? 0xeeeae4;
  return (_a, _b, c) => {
    if (c < HAND_H) return spec.skin;
    if (sleeve !== "long") return spec.skin;
    switch (t.kind) {
      case "suit":
      case "blazer":
        return c === HAND_H ? shirt : t.color;
      case "jacketTee":
        return c <= HAND_H + 1 ? shade(t.color, 0.14) : t.color;
      case "bisht":
        return c === HAND_H ? shirt : c === HAND_H + 1 ? (t.trim ?? 0xc39a4a) : t.color;
      case "shirt":
        return c === HAND_H ? shade(t.color, 0.12) : t.color;
      default:
        return t.color;
    }
  };
}

/** side: -1 for the character's right leg, +1 for the left. */
export function thighPaint(spec: AvatarSpec, d: Dims, side: number): Paint {
  const bt = spec.bottom;
  const inner = side < 0 ? d.thighW - 1 : 0;
  return (a, b, c) => {
    if (bt.kind === "robe") return robe(spec, d.thighW, a, b, side, d.legD, false);
    if (bt.kind === "skirt") return c === 0 ? shade(bt.color, -0.1) : bt.color;
    if (a === inner && b === d.legD - 1 && c < d.thighLen - 1) return shade(bt.color, -0.14);
    return bt.color;
  };
}

export function shinPaint(spec: AvatarSpec, d: Dims, side: number): Paint {
  const bt = spec.bottom;
  const inner = side < 0 ? d.shinW - 1 : 0;
  const h = d.shinLen - SHOE_H;
  return (a, b, c) => {
    switch (bt.kind) {
      case "robe":
        return robe(spec, d.shinW, a, b, side, d.legD, c === 0);
      case "skirt":
        return spec.skin;
      case "shorts":
        return c >= h - 1 ? bt.color : spec.skin;
      case "jeans":
        if (c < 2) return shade(bt.cuff ?? shade(bt.color, 0.22), c === 1 ? 0.06 : 0);
        break;
    }
    if (a === inner && b === d.legD - 1) return shade(bt.color, -0.14);
    return bt.color;
  };
}

function robe(spec: AvatarSpec, w: number, a: number, b: number, side: number, depth: number, hem: boolean): number {
  const t = spec.top;
  const trim = t.trim ?? 0xc39a4a;
  const fromInner = side < 0 ? w - 1 - a : a;
  if (hem) return b === depth - 1 && fromInner < 2 ? shade(t.accent ?? 0xeeeae4, -0.05) : trim;
  if (b === depth - 1 && fromInner < 1) return t.accent ?? 0xeeeae4;
  if (b === depth - 1 && fromInner < 2) return trim;
  return t.color;
}

export function shoePaint(spec: AvatarSpec, w: number, depth: number): Paint {
  const s = spec.shoes;
  const sole = s.sole ?? shade(s.color, -0.35);
  return (a, b, c) => {
    switch (s.kind) {
      case "heels":
        if (c === 0) return b < 2 || b >= depth - 3 ? sole : -1;
        if (c === 2 && b >= depth - 3 && b < depth - 1) return spec.skin;
        return s.color;
      case "sneakers":
        if (c === 0) return sole;
        if (c === 2 && b >= depth - 4 && b < depth - 1 && a > 0 && a < w - 1) return (b & 1) === 0 ? shade(s.color, -0.12) : s.color;
        return b === depth - 1 && c === 1 ? shade(s.color, -0.05) : s.color;
      case "dress":
        if (c === 0) return sole;
        return b >= depth - 2 && c === 2 ? shade(s.color, 0.08) : s.color;
    }
  };
}

export function skinTone(spec: AvatarSpec, f: number): number {
  return mix(spec.skin, 0x000000, f);
}
