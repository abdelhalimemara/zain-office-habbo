import {
  bodyOf,
  hasHem,
  HEM_H,
  hemPaint,
  foreArmPaint,
  HAND_H,
  neckPaint,
  shinPaint,
  shoePaint,
  SHOE_H,
  thighPaint,
  torsoPaint,
  upperArmPaint,
  type Dims,
} from "./body";
import { HEAD_MARGIN, headPaint } from "./head";
import { meshOf, type Mesh } from "./mesh";
import { identity, mul, pitch, rasterize, roll, translate, VoxelGrid, yaw, type Mat, type Part } from "./raster";
import type { AvatarSpec, Facing, Joint, Rig } from "./types";

export const REST_RIG: Rig = {
  hipR: 0,
  hipL: 0,
  kneeR: 0,
  kneeL: 0,
  shoulderR: { pitch: 0, roll: 0, yaw: 0 },
  shoulderL: { pitch: 0, roll: 0, yaw: 0 },
  elbowR: 0,
  elbowL: 0,
  headYaw: 0,
  headPitch: 0,
  drop: 0,
  thumbL: false,
};

/** Model-space rotation for each facing: local (i lateral from the right, j forward) onto world (x, y). */
export function facingMatrix(f: Facing): Mat {
  switch (f) {
    case "SW":
      return identity();
    case "SE":
      return Float64Array.of(0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0);
    case "NE":
      return Float64Array.of(-1, 0, 0, 0, -1, 0, 0, 0, 1, 0, 0, 0);
    case "NW":
      return Float64Array.of(0, -1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0);
  }
}

/** Which arm is farther from the viewer (drawn behind the torso) in each facing. */
export function farSide(f: Facing): "R" | "L" {
  return f === "SW" || f === "NW" ? "R" : "L";
}

export type PartName = "torso" | "hem" | "neck" | "thighR" | "thighL" | "shinR" | "shinL" | "shoeR" | "shoeL" | "upperR" | "upperL" | "foreR" | "foreL" | "thumb" | "head";

export interface NamedPart extends Part {
  name: PartName;
}

function jointMat(j: Joint, side: number): Mat {
  return mul(yaw(j.yaw), mul(roll(j.roll, side), pitch(j.pitch)));
}

/** Widen by one voxel when needed so a part centred at `centre` starts on a whole voxel. */
export function fit(w: number, centre: number): number {
  return Number.isInteger(centre - w / 2) ? w : w + 1;
}

export function legLength(d: Dims): number {
  return d.thighLen + d.shinLen;
}

/** All body parts for a spec in a rig, in model space (before facing). Later parts win where they overlap. */
export function buildParts(spec: AvatarSpec, rig: Rig): NamedPart[] {
  const d = bodyOf(spec);
  const L = legLength(d);
  const body = translate(0, 0, -rig.drop);
  const parts: NamedPart[] = [];
  const add = (name: PartName, w: number, dd: number, h: number, m: Mat, paint: Part["paint"], seed: number, noise?: number) =>
    parts.push({ name, w, d: dd, h, m, paint, seed, noise, owner: spec, key: `${name}:${w}x${dd}x${h}` });

  add("torso", d.torsoW, d.torsoD, d.torsoH, mul(body, translate(-d.torsoW / 2, -d.torsoD / 2, L)), torsoPaint(spec, d), 1);
  if (hasHem(spec)) add("hem", d.torsoW, d.torsoD, HEM_H, mul(body, translate(-d.torsoW / 2, -d.torsoD / 2, L - HEM_H)), hemPaint(spec, d), 14);
  add("neck", 6, 4, 1, mul(body, translate(-3, -2, L + d.torsoH)), neckPaint(spec), 2);

  for (const side of [-1, 1] as const) {
    const sfx = side < 0 ? "R" : "L";
    const hip = side < 0 ? rig.hipR : rig.hipL;
    const knee = side < 0 ? rig.kneeR : rig.kneeL;
    const hipM = mul(body, mul(translate(side * d.hipX, 0, L), pitch(hip)));
    add(`thigh${sfx}`, d.thighW, d.legD, d.thighLen, mul(hipM, translate(-d.thighW / 2, -d.legD / 2, -d.thighLen)), thighPaint(spec, d, side), 3 + side);
    const kneeM = mul(hipM, mul(translate(0, 0, -d.thighLen), pitch(-knee)));
    const shinH = d.shinLen - SHOE_H;
    const shinW = fit(d.shinW, d.hipX);
    add(`shin${sfx}`, shinW, d.legD, shinH, mul(kneeM, translate(-shinW / 2, -d.legD / 2, -shinH)), shinPaint(spec, { ...d, shinW }, side), 5 + side);
    const shoeW = fit(spec.shoes.kind === "heels" ? d.shinW + 2 : Math.max(d.shinW, d.thighW - 1), d.hipX);
    const shoeD = d.legD + 4;
    add(`shoe${sfx}`, shoeW, shoeD, SHOE_H, mul(kneeM, translate(-shoeW / 2, -d.legD / 2, -d.shinLen)), shoePaint(spec, shoeW, shoeD), 7 + side);
  }

  for (const side of [-1, 1] as const) {
    const sfx = side < 0 ? "R" : "L";
    const sh = side < 0 ? rig.shoulderR : rig.shoulderL;
    const elbow = side < 0 ? rig.elbowR : rig.elbowL;
    const pivotDown = d.armW / 2;
    const shoulderM = mul(body, mul(translate(side * (d.torsoW / 2 + d.armW / 2), d.torsoD / 2 - d.armD / 2, L + d.torsoH - pivotDown), jointMat(sh, side)));
    const upperLen = d.upperArm - pivotDown;
    add(`upper${sfx}`, d.armW, d.armD, d.upperArm, mul(shoulderM, translate(-d.armW / 2, -d.armD / 2, -upperLen)), upperArmPaint(spec, d), 9 + side);
    const elbowM = mul(shoulderM, mul(translate(0, 0, -upperLen), pitch(elbow)));
    add(`fore${sfx}`, d.armW, d.armD, d.foreArm + 1, mul(elbowM, translate(-d.armW / 2, -d.armD / 2, -d.foreArm)), foreArmPaint(spec), 11 + side);
    if (side > 0 && rig.thumbL) {
      const skin = spec.skin;
      add("thumb", 2, 2, 3, mul(elbowM, translate(-d.armW / 2 + Math.floor((d.armW - 2) / 2), d.armD / 2, 1 - d.foreArm)), () => skin, 15);
    }
  }

  const neckTop = L + d.torsoH + 1;
  const headM = mul(body, mul(translate(0, 0, neckTop), mul(yaw(rig.headYaw), pitch(-rig.headPitch))));
  const hw = d.headW + HEAD_MARGIN.x * 2;
  const hd = d.headD + HEAD_MARGIN.back + HEAD_MARGIN.front;
  const hh = d.headH + HEAD_MARGIN.top + HEAD_MARGIN.below;
  add("head", hw, hd, hh, mul(headM, translate(-hw / 2, -d.headD / 2 - HEAD_MARGIN.back, -HEAD_MARGIN.below)), headPaint(spec, d), 13, 0.035);
  return parts;
}

export const HAND_ROWS = HAND_H;

const shared = new VoxelGrid();

/** Voxelise a spec in a rig and facing, returning the projected face mesh (voxel units, origin at the feet). */
export function buildMesh(spec: AvatarSpec, rig: Rig, facing: Facing, filter?: (p: NamedPart) => boolean): Mesh {
  shared.clear();
  const f = facingMatrix(facing);
  for (const p of buildParts(spec, rig)) {
    if (filter && !filter(p)) continue;
    rasterize(shared, { ...p, m: mul(f, p.m) });
  }
  return meshOf(shared);
}

/** Model-space height (voxels) of the seat contact under the hips when sitting. */
export function seatHeight(spec: AvatarSpec): number {
  const d = bodyOf(spec);
  return d.shinLen - d.legD / 2;
}

export function sitDrop(spec: AvatarSpec): number {
  return bodyOf(spec).thighLen;
}
